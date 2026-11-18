import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences
} from 'electron'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { monitorEventLoopDelay } from 'perf_hooks'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main'
import { uIOhook } from 'uiohook-napi'
import icon from '../../resources/icon.png?asset'
import iconIco from '../../resources/icon.ico?asset'
import shakeClip1 from '../../resources/voice/shake-1.wav?asset'
import shakeClip2 from '../../resources/voice/shake-2.wav?asset'
import shakeClip3 from '../../resources/voice/shake-3.wav?asset'
import type { Settings, WindowRole } from '../shared/types'
import { away } from './away'
import { composio } from './composio'
import { isDemo, timing } from './demo'
import { startDemoControl } from './demoControl'
import { llmKeyPresent, loadConfig } from './config'
import {
  handleUserText,
  playbackIdle,
  pttActive,
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
import { initStore, reportStoreProblems, wipeData } from './store'
import { vitals } from './vitals'
import { closeAllSessions } from './voice/stt'
import { closeSpeech, playClip } from './voice/tts'

const SHUTDOWN_TIMEOUT_MS = 3_000
/** Hearth falls asleep after this long without being talked to or speaking. */
/** Asleep after this long without talking to Hearth; HEARTH_DEMO=1 shortens it. */
const sleepAfterMs = (): number => timing(5 * 60_000, 90_000)
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
/** Set once both windows exist; a second launch before then has nothing to show yet. */
let started = false
/** Set once the data folder is ready, so a startup failure can be written to the timeline. */
let storeReady = false

/** Both windows load one page: the dev server in development, else the bundled index.html. */
const rendererUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] || null : null
const rendererFile = join(__dirname, '../renderer/index.html')
const devOrigin = ((): string | null => {
  try {
    return rendererUrl ? new URL(rendererUrl).origin : null
  } catch {
    return null
  }
})()

function loadRole(win: BrowserWindow, role: WindowRole): void {
  if (rendererUrl) win.loadURL(`${rendererUrl}#${role}`)
  else win.loadFile(rendererFile, { hash: role })
}

/**
 * True only for Hearth's own page: the dev server's origin in development, else the exact
 * index.html this build ships. Any other file:// page, such as an HTML file dropped on a window,
 * is not Hearth and must not get the camera, the microphone or the preload API.
 */
function isAppPage(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (rendererUrl) return devOrigin !== null && parsed.origin === devOrigin
    if (parsed.protocol !== 'file:') return false
    // fileURLToPath decodes %20 and the like and ignores the #pill or #dashboard part.
    const path = resolve(fileURLToPath(parsed))
    // Windows paths are case-insensitive, and Chromium may spell the drive letter differently.
    return process.platform === 'win32'
      ? path.toLowerCase() === rendererFile.toLowerCase()
      : path === rendererFile
  } catch {
    return false
  }
}

/**
 * Keeps a window on Hearth's own page. Without this, a dropped file or a stray link would load in
 * a window that still has the preload API. Web links open in the browser instead, never here.
 */
function lockToAppPage(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppPage(url)) return
    e.preventDefault()
    console.warn(`[hearth] blocked navigation away from Hearth's page to ${url}`)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
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
    // Hearth draws its own header. Windows and Linux keep their minimize, maximize and close
    // buttons, colored to match the theme; macOS keeps its traffic lights, centered in the header.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarColors(hub.settings.theme === 'light' ? 'light' : 'dark'),
    trafficLightPosition: { x: 14, y: 13 },
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
  lockToAppPage(win)
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
 * Shaking the widget: this fast on average, with this many changes of direction, within the
 * window. Tuned on simulated motion: a gentle wiggle (±60 px at 2.5 Hz) counts; a fling, a
 * normal drag, a slow wobble or one back-and-forth reposition does not.
 */
const SHAKE_WINDOW_MS = 800
const SHAKE_SPEED = 550
const SHAKE_TURNS = 3
const SHAKE_COOLDOWN_MS = 20_000
/**
 * What Hearth says when shaken: recorded once in its own voice (resources/voice), so a shake
 * plays instantly, offline, with no text-to-speech request.
 */
const SHAKE_LINES = [
  { text: 'Whoa! Slow down, buddy.', file: shakeClip1 },
  { text: "Easy, easy. I'm getting dizzy!", file: shakeClip2 },
  { text: "Hey, gently! I'm right here.", file: shakeClip3 }
]
let lastShakeAt = 0

/**
 * True when the recent cursor path (DIPs, newest last) is a shake: fast, and reversing
 * direction several times, not one long fling across the screen.
 */
function isShake(samples: { t: number; x: number; y: number }[]): boolean {
  if (samples.length < 6) return false
  let distance = 0
  let turns = 0
  let lastDir = 0
  for (let i = 1; i < samples.length; i++) {
    const dx = samples[i].x - samples[i - 1].x
    const dy = samples[i].y - samples[i - 1].y
    distance += Math.hypot(dx, dy)
    const main = Math.abs(dx) >= Math.abs(dy) ? dx : dy
    if (Math.abs(main) < 3) continue
    const dir = Math.sign(main)
    if (lastDir && dir !== lastDir) turns++
    lastDir = dir
  }
  const seconds = (samples[samples.length - 1].t - samples[0].t) / 1000
  return seconds > 0 && distance / seconds >= SHAKE_SPEED && turns >= SHAKE_TURNS
}

/** The widget was shaken: its face goes dizzy, and it says so unless it is busy or in quiet mode. */
function onShake(): void {
  const now = Date.now()
  if (now - lastShakeAt < SHAKE_COOLDOWN_MS) return
  lastShakeAt = now
  hub.send({ type: 'react', kind: 'dizzy' })
  hub.record('session', 'Shaken while being dragged: dizzy for a moment')
  if (hub.settings.quietMode || (hub.mood !== 'idle' && hub.mood !== 'sleeping')) return
  const line = SHAKE_LINES[Math.floor(Math.random() * SHAKE_LINES.length)]
  playClip(line.file, line.text)
}

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
  const samples: { t: number; x: number; y: number }[] = []
  const timer = setInterval(() => {
    const now = Date.now()
    if (pill.isDestroyed() || now - startedAt > DRAG_MAX_MS) return stopPillDrag()
    const p = screen.getCursorScreenPoint()
    samples.push({ t: now, x: p.x, y: p.y })
    while (samples.length && now - samples[0].t > SHAKE_WINDOW_MS) samples.shift()
    if (isShake(samples)) {
      samples.length = 0
      onShake()
    }
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
  // Windows drops a window out of the always-on-top band when another topmost window (the
  // taskbar, another app's overlay) comes forward, so Hearth puts itself back on top, without
  // taking focus, whenever that happens and every few seconds.
  const keepOnTop = (): void => {
    if (win.isDestroyed() || !win.isVisible()) return
    if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, 'screen-saver')
    win.moveTop()
  }
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true)
  win.on('always-on-top-changed', (_e, onTop) => {
    if (!onTop) keepOnTop()
  })
  const topTimer = setInterval(keepOnTop, 2_500)
  win.on('closed', () => clearInterval(topTimer))
  hub.attach('pill', win)
  win.setIgnoreMouseEvents(true, { forward: true })
  if (process.platform === 'linux') passPointerOnLinux(win)
  win.on('ready-to-show', () => win.showInactive())
  lockToAppPage(win)
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

/**
 * The camera and microphone go only to Hearth's own page, and only after consent. Checks use the
 * requesting frame's full URL: a file:// origin is just "file:///", which would match any file.
 */
function allowMediaOnlyForAppPages(): void {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = details.requestingUrl || wc.getURL()
    callback(permission === 'media' && consented() && isAppPage(url))
  })
  session.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) => {
    const url = details.requestingUrl || wc?.getURL() || ''
    return permission === 'media' && consented() && isAppPage(url)
  })
}

/**
 * Consent was withdrawn or the data wiped: the microphone and camera stop now, not at the next
 * press. The dashboard owns the camera session, so it is told to stop it too; vitals stop here
 * as well in case that window never answers.
 */
function stopSensingAndListening(): void {
  hotkeys.reset()
  hub.send({ type: 'pttRemote', on: false, discard: true })
  // Only a turn that is still listening is dropped; this must not wake a sleeping Hearth.
  if (pttActive()) pttCancel()
  hub.send({ type: 'sensingCommand', on: false })
  vitals.stop()
  away.stopped()
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
  // The dashboard reports its resolved light or dark scheme ('auto' follows the system).
  ipcMain.on('hearth:titlebarScheme', (e, scheme: unknown) => {
    const win = hub.window('dashboard')
    if (win && e.sender === win.webContents && process.platform !== 'darwin')
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

  // The patch comes from a renderer, so unknown or malformed keys are dropped before it is saved.
  ipcMain.handle('hearth:updateSettings', (_e, patch: unknown) =>
    applySettings(hub.validSettings(patch, 'a Hearth window'))
  )
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
    // Consent goes first, so nothing can sense, listen or resume while Composio is contacted.
    applySettings({ consentAt: null })
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
  // macOS shows a global key hook nothing until Hearth is allowed under Accessibility. Asking
  // opens System Settings at that page; clicking the face works in the meantime.
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(true)) {
    hub.record(
      'error',
      "To use the talk key from other apps, allow Hearth under System Settings > Privacy & Security > Accessibility, then restart it. Clicking Hearth's face works meanwhile."
    )
    return
  }
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

/**
 * macOS asks once, in its own dialog, before an app may use the camera or microphone. Hearth asks
 * right after consent so the dialog does not interrupt the first sensing or talking.
 */
function askMacMediaAccess(): void {
  if (process.platform !== 'darwin') return
  for (const media of ['camera', 'microphone'] as const)
    if (systemPreferences.getMediaAccessStatus(media) === 'not-determined')
      void systemPreferences.askForMediaAccess(media)
}

/**
 * Linux does not forward mouse moves to a click-through window, so the widget would never learn
 * the pointer is over it. While the cursor is over its window, pass the position along instead.
 */
function passPointerOnLinux(win: BrowserWindow): void {
  let wasInside = false
  const timer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return
    const p = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const inside = p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height
    if (inside || wasInside)
      win.webContents.send('hearth:pointer', inside ? { x: p.x - b.x, y: p.y - b.y } : null)
    wasInside = inside
  }, 50)
  win.on('closed', () => clearInterval(timer))
}

function applySettings(patch: Partial<Settings>): Settings {
  const settings = hub.updateSettings(patch)
  if (patch.consentAt) askMacMediaAccess()
  // Saved first, so the permission handlers already refuse while everything is stopped.
  if ('consentAt' in patch && patch.consentAt === null) stopSensingAndListening()
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

function startup(): void {
  electronApp.setAppUserModelId('com.hearth.companion')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const cfg = loadConfig()
  initStore(cfg.dataDir)
  storeReady = true
  // A data file that could not be read was moved aside; say so in the timeline.
  reportStoreProblems((message) => hub.record('error', message))
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
  startDemoControl({
    say: (text) => {
      if (requireConsent()) void handleUserText(text, 'typed')
    },
    showDashboard,
    requestSensing
  })
  if (isDemo()) hub.record('session', 'Demo mode: short timers, separate data folder')
  if (consented()) askMacMediaAccess()
  // Without GNOME Keyring or KWallet, Electron falls back to a fixed key on Linux.
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    hub.record(
      'error',
      'No system keyring was found, so app sign-ins are saved without proper encryption. Install GNOME Keyring or KWallet to fix this.'
    )
  createDashboard()
  createPill()
  started = true
  startTalkKeys()
  // The talk-key hook also sees every mouse release, so a widget drag always ends.
  uIOhook.on('mouseup', () => stopPillDrag())
  // Sensing paused while the user was away starts again at their first key press or mouse move.
  away.init(requestSensing)
  uIOhook.on('input', () => away.input())
  hub.setMood('idle')
  // Asleep after a few quiet minutes; talking, a click on the face or Hearth speaking wakes it.
  setInterval(() => hub.sleepIfIdle(sleepAfterMs()), timing(30_000, 5_000)).unref()
  observer.start(say)
  void mcp.load(cfg.mcpConfigPath)
  void composio.load()
  warmVoice()
  if (is.dev) watchEventLoop()

  app.on('activate', () => showDashboard())
}

/** A failed startup is shown, never left as a half-started app with nothing on screen. */
function startupFailed(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[hearth] startup failed:', err)
  if (storeReady) {
    try {
      hub.record('error', `Hearth did not finish starting: ${message}`)
    } catch {
      // The data folder itself may be what failed; the console has it.
    }
  }
  // With a window up, the timeline shows the problem; without one, nothing would.
  if (hub.window('dashboard')) return
  dialog.showErrorBox('Hearth could not start', message)
  app.quit()
}

// One Hearth per user data folder: a second launch would add a second widget and a second key
// hook. Electron scopes the lock to the user data folder, so a run with its own --user-data-dir,
// like the smoke test, still starts. `npm run dev` goes without it: electron-vite starts the
// rebuilt app while the old one is still quitting, and the new one would find the lock taken.
if (!rendererUrl && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Opening Hearth again brings its dashboard forward instead.
  app.on('second-instance', () => {
    if (started) showDashboard()
  })

  app.whenReady().then(startup).catch(startupFailed)

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
}
