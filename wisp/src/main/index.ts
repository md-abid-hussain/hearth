import { app, BrowserWindow, globalShortcut, ipcMain, screen, session, shell } from 'electron'
import { join } from 'path'
import { monitorEventLoopDelay } from 'perf_hooks'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main'
import icon from '../../resources/icon.png?asset'
import type { Settings, WindowRole } from '../shared/types'
import { apps } from './composio'
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
import { HANDS_FREE_LABEL, HOTKEYS, hotkeys } from './hotkey'
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
const LAG_WARN_MS = 100

/** Development aid: reports when the main process is blocked long enough to freeze the windows. */
function watchEventLoop(): void {
  const delay = monitorEventLoopDelay({ resolution: 20 })
  delay.enable()
  setInterval(() => {
    const p99 = delay.percentile(99) / 1e6
    if (p99 > LAG_WARN_MS)
      console.warn(
        `[wisp] main event loop p99 ${p99.toFixed(0)} ms, max ${(delay.max / 1e6).toFixed(0)} ms`
      )
    delay.reset()
  }, 5_000).unref()
}
const PILL_SIZE = { width: 440, height: 210 }
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

function createDashboard(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'Wisp',
    backgroundColor: hub.settings.theme === 'light' ? '#f6f3ec' : '#131313',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences
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
    shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRole(win, 'dashboard')
  return win
}

function createPill(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    ...PILL_SIZE,
    x: Math.round(workArea.x + (workArea.width - PILL_SIZE.width) / 2),
    y: workArea.y + workArea.height - PILL_SIZE.height - 12,
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
    title: 'Wisp companion',
    webPreferences
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true)
  hub.attach('pill', win)
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
    callback(permission === 'media' && trusted(wc.getURL()))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => {
    return permission === 'media' && trusted(origin)
  })
}

function registerIpc(): void {
  const cfg = loadConfig()

  ipcMain.handle('wisp:getState', () => hub.snapshot())
  ipcMain.handle('wisp:getHistory', () => vitals.history)
  ipcMain.handle('wisp:getSmartSpectraKey', () => cfg.smartspectraKey)

  ipcMain.on('wisp:sensing', (_e, on: boolean) => (on ? vitals.start() : vitals.stop()))
  ipcMain.on('wisp:metrics', (_e, buf: Uint8Array) => vitals.ingest(buf))
  ipcMain.on('wisp:validation', (_e, hint: string | null) => vitals.setValidationHint(hint))
  ipcMain.on('wisp:insight', (_e, buf: Uint8Array, requestId: number) =>
    insights.ingest(buf, requestId)
  )
  ipcMain.on('wisp:insightBound', (_e, token: string, requestId: number) =>
    insights.bindRequest(token, requestId)
  )
  ipcMain.on('wisp:insightFailed', (_e, token: string) => insights.failRequest(token))
  ipcMain.on('wisp:sdkError', (_e, message: string, fatal: boolean) =>
    fatal ? hub.notify(message) : hub.record('error', `SmartSpectra: ${message}`)
  )

  ipcMain.on('wisp:pttStart', () => {
    hotkeys.reset()
    pttStart('hold')
  })
  ipcMain.on('wisp:pttAudio', (_e, chunk: Uint8Array) => pttAudio(chunk))
  ipcMain.on('wisp:pttStop', () => {
    hotkeys.reset()
    void pttStop()
  })
  ipcMain.on('wisp:typed', (_e, text: string) => void handleUserText(text, 'typed'))
  ipcMain.on('wisp:playbackIdle', () => playbackIdle())
  ipcMain.on('wisp:openDashboard', () => showDashboard())
  ipcMain.on('wisp:quit', () => app.quit())

  ipcMain.handle('wisp:updateSettings', (_e, patch: Partial<Settings>) => applySettings(patch))
  ipcMain.handle('wisp:unpin', (_e, index: number) => memory.unpin(index))
  ipcMain.handle('wisp:cancelReminder', (_e, id: string) => reminders.cancel(id))
  ipcMain.handle('wisp:reloadMcp', async () => {
    await mcp.load(loadConfig().mcpConfigPath)
    return hub.mcp
  })
  ipcMain.handle('wisp:connectApp', (_e, slug: string) => apps.connect(slug))
  ipcMain.handle('wisp:disconnectApp', (_e, slug: string) => apps.disconnect(slug))
  ipcMain.handle('wisp:refreshApps', () => apps.refresh())
  ipcMain.handle('wisp:wipeData', () => {
    wipeData()
    memory.clear()
    hub.insights = []
    hub.reminders = []
    hub.clearLog()
    hub.record('session', 'All local Wisp data was deleted')
  })
}

function startTalkKeys(): void {
  const problem = hotkeys.start(hub.settings.hotkey, {
    start: (handsFree) => {
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
    hub.status = { ...hub.status, pttShortcut: hotkeys.label }
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
  electronApp.setAppUserModelId('com.wisp.companion')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const cfg = loadConfig()
  initStore(cfg.dataDir)
  hub.init({
    llmProvider: cfg.llmProvider,
    llmModel: cfg.llmModel,
    envReasoningEffort: cfg.reasoningEffort,
    ttsVoice: cfg.ttsVoice,
    pttShortcut: HOTKEYS[hub.settings.hotkey]?.label ?? HOTKEYS['ctrl-win'].label,
    handsFreeShortcut: HANDS_FREE_LABEL,
    llmReady: llmKeyPresent(cfg),
    assemblyReady: Boolean(cfg.assemblyKey),
    smartspectraReady: Boolean(cfg.smartspectraKey),
    mcpConfigPath: cfg.mcpConfigPath,
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
  hub.setMood('idle')
  observer.start(say)
  void mcp.load(cfg.mcpConfigPath)
  void apps.load()
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
