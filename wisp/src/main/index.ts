import { app, BrowserWindow, globalShortcut, ipcMain, screen, session, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { monitorEventLoopDelay } from 'perf_hooks'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main'
import { uIOhook } from 'uiohook-napi'
import icon from '../../resources/icon.png?asset'
import iconIco from '../../resources/icon.ico?asset'
import type { Settings, WindowRole } from '../shared/types'
import { away } from './away'
import { composio } from './composio'
import { llmKeyPresent, loadConfig } from './config'
import {
  handleUserText,
  playbackIdle,
  pttAudio,
  pttCancel,
  pttLock,
  pttStart,
  pttStop,
  say,
  warmVoice
} from './conversation'
import { DEFAULT_HOTKEY, HOTKEYS, handsFreeLabel, hotkeys } from './hotkey'
import { hub } from './hub'
import { insights } from './insights'
import { mcp } from './mcp'
import { memory } from './memory'
import { observer } from './observer'
import { reminders } from './reminders'
import { initStore, wipeData } from './store'
import { vitals } from './vitals'
import { closeAllSessions } from './voice/stt'
import { closeSpeech } from './voice/tts'

const SHUTDOWN_TIMEOUT_MS = 3_000
/** Hearth falls asleep after this long without being talked to or speaking. */
const SLEEP_AFTER_MS = 5 * 60_000
const LAG_WARN_MS = 100

/** Development aid: reports when the main process is blocked long enough to freeze the windows. */
function watchEventLoop(): void {
  const delay = monitorEventLoopDelay({ resolution: 20 })
  delay.enable()
  setInterval(() => {
    const p99 = delay.percentile(99) / 1e6
    if (p99 > LAG_WARN_MS)
      console.warn(
        `[hearth] main event loop p99 ${p99.toFixed(0)} ms, max ${(delay.max / 1e6).toFixed(0)} ms`
      )
    delay.reset()
  }, 5_000).unref()
}
/**
 * Room for the camera preview above the bar. Only the widget itself takes the mouse; the rest
 * of this transparent window passes clicks through to whatever is underneath.
 */
const PILL_SIZE = { width: 460, height: 520 }
let quitting = false

function loadRole(win: BrowserWindow, role: WindowRole): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${role}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: role })
  }
}

const webPreferences = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  // The SmartSpectra preload bridge is required from our preload, which needs Node's require.
  sandbox: false,
  // Camera processing and audio must keep running while the window is hidden or behind others.
  backgroundThrottling: false
}

/** Matches the dashboard header (--surface and --text in each theme). */
const TITLEBAR_HEIGHT = 40
function titleBarColors(scheme: 'light' | 'dark'): {
  color: string
  symbolColor: string
  height: number
} {
  return scheme === 'light'
    ? { color: '#ffffff', symbolColor: '#161616', height: TITLEBAR_HEIGHT }
    : { color: '#1a1a1a', symbolColor: '#f3efe6', height: TITLEBAR_HEIGHT }
}

function createDashboard(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'Hearth',
    backgroundColor: hub.settings.theme === 'light' ? '#f6f3ec' : '#131313',
    autoHideMenuBar: true,
    icon: process.platform === 'win32' ? iconIco : icon,
    // Hearth draws its own header; Windows keeps its minimize, maximize and close buttons
    // (with snap layouts), colored to match the theme.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarColors(hub.settings.theme === 'light' ? 'light' : 'dark'),
    webPreferences
  })

  // The taskbar button takes its icon from the window's app identity. Without this, a dev run is
  // grouped under electron.exe and shows Electron's icon; an installed build matches anyway.
  if (process.platform === 'win32')
    win.setAppDetails({
      appId: 'com.hearth.companion',
      appIconPath: iconIco,
      appIconIndex: 0,
      relaunchDisplayName: 'Hearth'
    })

  bindSmartSpectraIpc(win, {
    logger: (level, msg) => {
      if (level !== 'info') hub.record('error', `SmartSpectra ${level}: ${msg}`)
    }
  })
  hub.attach('dashboard', win)

  win.on('ready-to-show', () => win.show())
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRole(win, 'dashboard')
  return win
}

/** Keeps the widget, which sits at the bottom center of the pill window, on a screen. */
function clampPill(x: number, y: number): { x: number; y: number } {
  const anchor = {
    x: Math.round(x + PILL_SIZE.width / 2),
    y: Math.round(y + PILL_SIZE.height - 30)
  }
  const { workArea: a } = screen.getDisplayNearestPoint(anchor)
  const half = PILL_SIZE.width / 2
  return {
    x: Math.round(Math.min(Math.max(x, a.x - half + 40), a.x + a.width - half - 40)),
    y: Math.round(
      Math.min(Math.max(y, a.y + 90 - PILL_SIZE.height), a.y + a.height - PILL_SIZE.height + 6)
    )
  }
}

const DRAG_FRAME_MS = 16
/** A drag whose mouse-up was missed stops on its own after this long. */
const DRAG_MAX_MS = 60_000
let pillDrag: { timer: NodeJS.Timeout; startedAt: number } | null = null

/**
 * Moves the pill window with the cursor until the drag stops. Bounds are set with the fixed
 * size each frame: repeated setPosition calls can grow a transparent window on scaled Windows
 * displays, which would push the widget off screen.
 */
function startPillDrag(pill: BrowserWindow): void {
  stopPillDrag(false)
  const cursor = screen.getCursorScreenPoint()
  const [wx, wy] = pill.getPosition()
  const offset = { x: cursor.x - wx, y: cursor.y - wy }
  const startedAt = Date.now()
  const timer = setInterval(() => {
    if (pill.isDestroyed() || Date.now() - startedAt > DRAG_MAX_MS) return stopPillDrag()
    const p = screen.getCursorScreenPoint()
    const next = clampPill(p.x - offset.x, p.y - offset.y)
    const [cx, cy] = pill.getPosition()
    if (next.x !== cx || next.y !== cy) pill.setBounds({ ...next, ...PILL_SIZE })
  }, DRAG_FRAME_MS)
  pillDrag = { timer, startedAt }
}

function stopPillDrag(save = true): void {
  if (!pillDrag) return
  clearInterval(pillDrag.timer)
  pillDrag = null
  const pill = hub.window('pill')
  if (!pill || !save) return
  const [x, y] = pill.getPosition()
  pill.setBounds({ x, y, ...PILL_SIZE })
  hub.updateSettings({ pillPosition: { x, y } })
}

/** Puts the widget back at the bottom center of the primary screen. */
function resetPill(): void {
  stopPillDrag(false)
  const { workArea } = screen.getPrimaryDisplay()
  hub.updateSettings({ pillPosition: null })
  hub.window('pill')?.setBounds({
    x: Math.round(workArea.x + (workArea.width - PILL_SIZE.width) / 2),
    y: workArea.y + workArea.height - PILL_SIZE.height - 12,
    ...PILL_SIZE
  })
}

function createPill(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const saved = hub.settings.pillPosition
  const start = saved
    ? clampPill(saved.x, saved.y)
    : {
        x: Math.round(workArea.x + (workArea.width - PILL_SIZE.width) / 2),
        y: workArea.y + workArea.height - PILL_SIZE.height - 12
      }
  const win = new BrowserWindow({
    ...PILL_SIZE,
    ...start,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: 'Hearth companion',
    icon,
    webPreferences
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true)
  hub.attach('pill', win)
  win.setIgnoreMouseEvents(true, { forward: true })
  win.on('ready-to-show', () => win.showInactive())
  loadRole(win, 'pill')
  return win
}

function showDashboard(): void {
  const win = hub.window('dashboard') ?? createDashboard()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

const consented = (): boolean => hub.settings.consentAt != null

/** The camera, microphone and model stay off until the first-run consent is accepted. */
function requireConsent(): boolean {
  if (consented()) return true
  hub.notify('Accept the consent screen in the dashboard before Hearth can sense or listen.')
  showDashboard()
  return false
}

function allowMediaOnlyForAppPages(): void {
  const devOrigin =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? new URL(process.env['ELECTRON_RENDERER_URL']).origin
      : null
  const trusted = (url: string): boolean => {
    if (url.startsWith('file://')) return true
    try {
      return devOrigin !== null && new URL(url).origin === devOrigin
    } catch {
      return false
    }
  }
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media' && consented() && trusted(wc.getURL()))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => {
    return permission === 'media' && consented() && trusted(origin)
  })
}

/** Starts or stops sensing in the dashboard window, where the camera session lives. */
function requestSensing(on: boolean): void {
  if (on && !requireConsent()) return
  if (on && !loadConfig().smartspectraKey) {
    hub.notify('Add SMARTSPECTRA_API_KEY to .env to start sensing.')
    return
  }
  const send = (): void => hub.send({ type: 'sensingCommand', on })
  if (hub.window('dashboard')) send()
  else createDashboard().webContents.once('did-finish-load', () => setTimeout(send, 500))
}

function registerIpc(): void {
  const cfg = loadConfig()

  ipcMain.handle('hearth:getState', () => hub.snapshot())
  ipcMain.handle('hearth:getHistory', () => vitals.history)
  ipcMain.handle('hearth:getSmartSpectraKey', () => cfg.smartspectraKey)

  ipcMain.on('hearth:sensing', (_e, on: boolean) => {
    if (!on) {
      vitals.stop()
      away.stopped()
    } else if (requireConsent()) vitals.start(away.started())
  })
  // From the pill: the camera session lives in the dashboard window, even while it is hidden.
  ipcMain.on('hearth:requestSensing', (_e, on: unknown) => requestSensing(on === true))
  ipcMain.on('hearth:metrics', (_e, buf: Uint8Array) => vitals.ingest(buf))
  ipcMain.on('hearth:validation', (_e, hint: string | null, faceSeen?: boolean) => {
    vitals.setValidationHint(hint)
    if (typeof faceSeen === 'boolean') away.faceSeen(faceSeen)
  })
  ipcMain.on('hearth:insight', (_e, buf: Uint8Array, requestId: number) =>
    insights.ingest(buf, requestId)
  )
  ipcMain.on('hearth:insightBound', (_e, token: string, requestId: number) =>
    insights.bindRequest(token, requestId)
  )
  ipcMain.on('hearth:insightFailed', (_e, token: string) => insights.failRequest(token))
  ipcMain.on('hearth:sdkError', (_e, message: string, fatal: boolean) =>
    fatal ? hub.notify(message) : hub.record('error', `SmartSpectra: ${message}`)
  )

  // From the pill: a click on Hearth's face listens until the next click (hands-free).
  ipcMain.on('hearth:pttStart', (_e, mode: unknown) => {
    hotkeys.reset()
    if (requireConsent()) pttStart(mode === 'handsFree' ? 'handsFree' : 'hold')
  })
  ipcMain.on('hearth:pttAudio', (_e, chunk: Uint8Array) => pttAudio(chunk))
  ipcMain.on('hearth:pttStop', () => {
    hotkeys.reset()
    void pttStop()
  })
  ipcMain.on('hearth:typed', (_e, text: string) => {
    if (requireConsent()) void handleUserText(text, 'typed')
  })
  ipcMain.on('hearth:playbackIdle', () => playbackIdle())
  ipcMain.on('hearth:openDashboard', () => showDashboard())
  // Dragging the widget: the renderer only says when a drag starts and ends. The window follows
  // the real cursor from here, because the renderer's own screen coordinates lag while its
  // window moves and would make it run away.
  ipcMain.on('hearth:pillDrag', (e, phase: unknown) => {
    const pill = hub.window('pill')
    if (!pill || e.sender !== pill.webContents) return
    if (phase === 'start') startPillDrag(pill)
    else stopPillDrag()
  })
  ipcMain.on('hearth:resetPill', () => resetPill())
  // The dashboard reports its resolved light or dark scheme ('auto' follows Windows).
  ipcMain.on('hearth:titlebarScheme', (e, scheme: unknown) => {
    const win = hub.window('dashboard')
    if (win && e.sender === win.webContents && process.platform === 'win32')
      win.setTitleBarOverlay(titleBarColors(scheme === 'light' ? 'light' : 'dark'))
  })
  // Shows .env in Explorer, or .env.example when it has not been created yet.
  ipcMain.on('hearth:openEnvFolder', () => {
    const root = loadConfig().projectRoot
    const file = [join(root, '.env'), join(root, '.env.example')].find((p) => existsSync(p))
    if (file) shell.showItemInFolder(file)
    else void shell.openPath(root)
  })
  // The pill renderer hit-tests forwarded mouse moves and asks for clicks only over its widget.
  ipcMain.on('hearth:pillInteractive', (e, on: unknown) => {
    const pill = hub.window('pill')
    if (pill && e.sender === pill.webContents)
      pill.setIgnoreMouseEvents(on !== true, { forward: true })
  })
  ipcMain.on('hearth:quit', () => app.quit())

  ipcMain.handle('hearth:updateSettings', (_e, patch: Partial<Settings>) => applySettings(patch))
  ipcMain.handle('hearth:unpin', (_e, index: number) => memory.unpin(index))
  ipcMain.handle('hearth:cancelReminder', (_e, id: string) => reminders.cancel(id))
  ipcMain.handle('hearth:reloadMcp', async () => {
    await Promise.all([mcp.load(loadConfig().mcpConfigPath), composio.load()])
    return hub.connectors()
  })
  // Connector ids starting with "composio" belong to the Composio session; the rest are MCP servers.
  ipcMain.handle('hearth:mcpSignIn', (_e, id: string) =>
    composio.owns(id) ? composio.signIn(id) : mcp.signIn(id)
  )
  ipcMain.handle('hearth:mcpCancelSignIn', (_e, id: string) =>
    composio.owns(id) ? composio.cancelSignIn(id) : mcp.cancelSignIn(id)
  )
  ipcMain.handle('hearth:mcpSignOut', (_e, id: string) =>
    composio.owns(id) ? composio.signOut(id) : mcp.signOut(id)
  )
  ipcMain.handle('hearth:mcpAddServer', (_e, name: string, url: string, apiKey?: unknown) =>
    mcp.addServer(name, url, typeof apiKey === 'string' ? apiKey : undefined)
  )
  ipcMain.handle('hearth:mcpSetKey', (_e, id: string, key: unknown) =>
    mcp.setKey(id, typeof key === 'string' ? key : '')
  )
  ipcMain.handle('hearth:mcpSetEnabled', (_e, id: string, enabled: unknown) =>
    composio.owns(id)
      ? composio.setEnabled(id, enabled === true)
      : mcp.setEnabled(id, enabled === true)
  )
  ipcMain.handle('hearth:wipeData', async () => {
    // Composio keeps the Google connections on its servers, so remove them before the local id goes.
    const composioProblem = await composio.forgetAll()
    wipeData()
    memory.clear()
    hub.insights = []
    hub.reminders = []
    hub.clearLog()
    hub.updateSettings({ consentAt: null })
    hub.record('session', 'All local Hearth data was deleted')
    if (composioProblem) hub.record('error', composioProblem)
    void mcp.load(loadConfig().mcpConfigPath)
    void composio.load()
  })
}

function startTalkKeys(): void {
  const problem = hotkeys.start(hub.settings.hotkey, {
    start: (handsFree) => {
      if (!requireConsent()) {
        hotkeys.reset()
        return
      }
      const pill = hub.window('pill')
      if (pill && !pill.isVisible()) pill.showInactive()
      pttStart(handsFree ? 'handsFree' : 'hold')
      hub.send({ type: 'pttRemote', on: true })
    },
    lock: () => pttLock(),
    stop: () => {
      hub.send({ type: 'pttRemote', on: false })
      void pttStop()
    },
    cancel: () => {
      hub.send({ type: 'pttRemote', on: false, discard: true })
      pttCancel()
    }
  })
  if (problem) hub.record('error', problem)
}

function applySettings(patch: Partial<Settings>): Settings {
  const settings = hub.updateSettings(patch)
  if (patch.hotkey) {
    hotkeys.use(patch.hotkey)
    hub.status = {
      ...hub.status,
      pttShortcut: hotkeys.label,
      handsFreeShortcut: handsFreeLabel(patch.hotkey)
    }
    hub.changed()
  }
  return settings
}

let cleanedUp = false

/** Ends voice sessions with AssemblyAI before exit, so none are left counting against the account. */
async function shutdown(): Promise<void> {
  hotkeys.stop()
  observer.stop()
  await Promise.race([
    Promise.all([closeAllSessions(), closeSpeech(), mcp.close()]),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))
  ])
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.hearth.companion')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const cfg = loadConfig()
  initStore(cfg.dataDir)
  hub.init({
    llmProvider: cfg.llmProvider,
    llmModel: cfg.llmModel,
    envReasoningEffort: cfg.reasoningEffort,
    ttsVoice: cfg.ttsVoice,
    pttShortcut: (HOTKEYS[hub.settings.hotkey] ?? HOTKEYS[DEFAULT_HOTKEY]).label,
    handsFreeShortcut: handsFreeLabel(hub.settings.hotkey),
    llmReady: llmKeyPresent(cfg),
    assemblyReady: Boolean(cfg.assemblyKey),
    smartspectraReady: Boolean(cfg.smartspectraKey),
    mcpConfigPath: cfg.mcpConfigPath,
    envPath: join(cfg.projectRoot, '.env'),
    dataDir: cfg.dataDir
  })
  memory.load()
  insights.load()
  reminders.load()

  allowMediaOnlyForAppPages()
  registerIpc()
  createDashboard()
  createPill()
  startTalkKeys()
  // The talk-key hook also sees every mouse release, so a widget drag always ends.
  uIOhook.on('mouseup', () => stopPillDrag())
  // Sensing paused while the user was away starts again at their first key press or mouse move.
  away.init(requestSensing)
  uIOhook.on('input', () => away.input())
  hub.setMood('idle')
  // Asleep after a few quiet minutes; talking, a click on the face or Hearth speaking wakes it.
  setInterval(() => hub.sleepIfIdle(SLEEP_AFTER_MS), 30_000).unref()
  observer.start(say)
  void mcp.load(cfg.mcpConfigPath)
  void composio.load()
  warmVoice()
  if (is.dev) watchEventLoop()

  app.on('activate', () => showDashboard())
})

app.on('before-quit', (event) => {
  quitting = true
  if (cleanedUp) return
  event.preventDefault()
  cleanedUp = true
  void shutdown().finally(() => app.quit())
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
