import type { BrowserWindow } from 'electron'
import type {
  AppsState,
  AppStatus,
  Exchange,
  InsightEntry,
  LogEntry,
  ListenMode,
  LogKind,
  MainToRenderer,
  McpServerStatus,
  MemoryState,
  Reminder,
  Settings,
  VitalsSnapshot,
  WindowRole,
  WispMood,
  WispState
} from '../shared/types'
import { appendJsonl, newId, readJson, readJsonl, writeJson } from './store'

const LOG_FILE = 'events.jsonl'
const SETTINGS_FILE = 'settings.json'
const EXCHANGE_FILE = 'last-exchange.json'
const UI_LOG_LIMIT = 300
const NOTICE_MS = 8_000
/** The same error inside this window is one fault, not a new event. */
const REPEAT_ERROR_MS = 60_000

/** Audio plays in the pill; the SmartSpectra session lives in the dashboard. */
const ROUTES: Partial<Record<MainToRenderer['type'], WindowRole>> = {
  ttsStart: 'pill',
  ttsAudio: 'pill',
  ttsEnd: 'pill',
  ttsCancel: 'pill',
  pttRemote: 'pill',
  requestInsight: 'dashboard'
}

export const emptyVitals = (): VitalsSnapshot => ({
  sensing: false,
  present: false,
  sessionStartedAt: null,
  sittingSince: null,
  pulse: null,
  pulseConfidence: null,
  breathing: null,
  breathingConfidence: null,
  hrvRmssd: null,
  talking: false,
  blinksPerMinute: null,
  validationHint: null,
  updatedAt: 0
})

class Hub {
  private windows = new Map<WindowRole, BrowserWindow>()
  private pushTimer: NodeJS.Timeout | null = null

  mood: WispMood = 'sleeping'
  vitals: VitalsSnapshot = emptyVitals()
  insights: InsightEntry[] = []
  memory: MemoryState = { summary: '', pins: [], turns: [], compactions: 0 }
  reminders: Reminder[] = []
  log: LogEntry[] = []
  mcp: McpServerStatus[] = []
  apps: AppsState = { configured: false, apps: [], error: null }
  settings: Settings = {
    quietMode: false,
    nudgesEnabled: true,
    telemetry: false,
    theme: 'dark',
    hotkey: 'ctrl-win',
    reasoningEffort: null
  }
  status!: AppStatus
  partialTranscript = ''
  lastReply = ''
  lastExchange: Exchange | null = null
  activity: string | null = null
  listenMode: ListenMode | null = null
  notice: string | null = null
  private noticeTimer: NodeJS.Timeout | null = null
  private lastError = { message: '', at: 0 }

  init(status: AppStatus): void {
    this.status = status
    this.settings = { ...this.settings, ...readJson<Partial<Settings>>(SETTINGS_FILE, {}) }
    this.log = readJsonl<LogEntry>(LOG_FILE).slice(-UI_LOG_LIMIT)
    this.lastExchange = readJson<Exchange | null>(EXCHANGE_FILE, null)
  }

  attach(role: WindowRole, win: BrowserWindow): void {
    this.windows.set(role, win)
    win.on('closed', () => {
      if (this.windows.get(role) === win) this.windows.delete(role)
    })
  }

  window(role: WindowRole): BrowserWindow | undefined {
    const win = this.windows.get(role)
    return win && !win.isDestroyed() ? win : undefined
  }

  send(msg: MainToRenderer): void {
    const target = ROUTES[msg.type]
    for (const [role, win] of this.windows) {
      if (win.isDestroyed() || (target && role !== target)) continue
      win.webContents.send('wisp:event', msg)
    }
  }

  snapshot(): WispState {
    return {
      mood: this.mood,
      vitals: this.vitals,
      insights: this.insights.slice(-50),
      memory: this.memory,
      reminders: this.reminders,
      log: this.log,
      mcp: this.mcp,
      apps: this.apps,
      settings: this.settings,
      status: this.status,
      partialTranscript: this.partialTranscript,
      lastReply: this.lastReply,
      lastExchange: this.lastExchange,
      activity: this.activity,
      listenMode: this.listenMode,
      notice: this.notice
    }
  }

  /** Shows a problem on the pill for a few seconds and records it once in the timeline. */
  notify(message: string): void {
    this.record('error', message)
    this.notice = message
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.noticeTimer = setTimeout(() => {
      this.notice = null
      this.changed()
    }, NOTICE_MS)
    this.changed()
  }

  /** Coalesces bursts of state changes into one push. */
  changed(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      this.send({ type: 'state', state: this.snapshot() })
    }, 80)
  }

  setMood(mood: WispMood): void {
    if (this.mood === mood) return
    this.mood = mood
    if (mood !== 'thinking') this.activity = null
    this.changed()
  }

  setActivity(activity: string | null): void {
    this.activity = activity
    this.changed()
  }

  setExchange(exchange: Exchange): void {
    this.lastExchange = exchange
    writeJson(EXCHANGE_FILE, exchange)
    this.changed()
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch }
    writeJson(SETTINGS_FILE, this.settings)
    this.changed()
    return this.settings
  }

  record(kind: LogKind, message: string, data?: Record<string, unknown>): LogEntry | null {
    if (kind === 'error') {
      const now = Date.now()
      if (message === this.lastError.message && now - this.lastError.at < REPEAT_ERROR_MS) return null
      this.lastError = { message, at: now }
    }
    const entry: LogEntry = { id: newId(), at: Date.now(), kind, message, data }
    appendJsonl(LOG_FILE, entry)
    this.log.push(entry)
    if (this.log.length > UI_LOG_LIMIT) this.log.splice(0, this.log.length - UI_LOG_LIMIT)
    this.changed()
    return entry
  }

  clearLog(): void {
    this.log = []
    this.lastExchange = null
    this.changed()
  }
}

export const hub = new Hub()
