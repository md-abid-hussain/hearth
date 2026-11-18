import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import type {
  AppStatus,
  Exchange,
  HotkeyId,
  InsightEntry,
  LogEntry,
  ListenMode,
  LogKind,
  MainToRenderer,
  McpServerStatus,
  MemoryState,
  ReasoningEffort,
  Reminder,
  Settings,
  ThemeChoice,
  VitalsSnapshot,
  WindowRole,
  HearthMood,
  HearthState
} from '../shared/types'
import { defaultHotkey } from '../shared/keys'
import { READINGS, readingsOn } from '../shared/readings'
import { tapSpeech } from './demoAudio'
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
  requestInsight: 'dashboard',
  sensingCommand: 'dashboard',
  showPage: 'dashboard',
  react: 'pill'
}

/**
 * A z.enum of every value of a string union. Taking a record keyed by the union makes the compiler
 * flag a value added to the type but not here, which would otherwise be refused at run time.
 */
const oneOf = <T extends string>(values: Record<T, true>): z.ZodType<T> =>
  z.enum(Object.keys(values) as [T, ...T[]])

/** What each setting may hold. z.number() refuses NaN and Infinity. */
const SETTING_SCHEMAS: { [K in keyof Settings]-?: z.ZodType<Settings[K]> } = {
  quietMode: z.boolean(),
  nudgesEnabled: z.boolean(),
  telemetry: z.boolean(),
  theme: oneOf<ThemeChoice>({ dark: true, light: true, auto: true }),
  hotkey: oneOf<HotkeyId>({ 'ctrl-win': true, 'right-alt': true, 'right-ctrl': true }),
  reasoningEffort: oneOf<ReasoningEffort>({
    none: true,
    low: true,
    medium: true,
    high: true,
    xhigh: true,
    max: true
  }).nullable(),
  consentAt: z.number().nonnegative().nullable(),
  measurePulse: z.boolean(),
  measureBreathing: z.boolean(),
  measureHrv: z.boolean(),
  measureBlinks: z.boolean(),
  measureExpressions: z.boolean(),
  pillPosition: z.object({ x: z.number(), y: z.number() }).nullable()
}

/**
 * The known, well-formed settings in a patch, and the keys left out: `unknown` names no setting,
 * `invalid` holds the wrong type or an out-of-range value.
 */
export function parseSettings(patch: unknown): {
  settings: Partial<Settings>
  unknown: string[]
  invalid: string[]
} {
  const settings: Record<string, unknown> = {}
  const unknown: string[] = []
  const invalid: string[] = []
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch))
    return { settings, unknown, invalid: patch === undefined ? [] : ['(not an object)'] }
  for (const [key, value] of Object.entries(patch)) {
    // Own keys only, so "constructor" or "__proto__" never count as settings.
    if (!Object.hasOwn(SETTING_SCHEMAS, key)) {
      unknown.push(key)
      continue
    }
    const parsed = SETTING_SCHEMAS[key as keyof Settings].safeParse(value)
    if (parsed.success) settings[key] = parsed.data
    else invalid.push(key)
  }
  return { settings: settings as Partial<Settings>, unknown, invalid }
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
  expression: null,
  validationHint: null,
  pausedAway: false,
  updatedAt: 0
})

class Hub {
  private windows = new Map<WindowRole, BrowserWindow>()
  private pushTimer: NodeJS.Timeout | null = null

  mood: HearthMood = 'sleeping'
  /** Last time Hearth listened, thought, spoke or went idle after doing so; sleep counts from here. */
  lastActiveAt = Date.now()
  vitals: VitalsSnapshot = emptyVitals()
  insights: InsightEntry[] = []
  memory: MemoryState = { summary: '', pins: [], turns: [], compactions: 0 }
  reminders: Reminder[] = []
  log: LogEntry[] = []
  mcp: McpServerStatus[] = []
  /** Composio and the Google accounts linked through it; shown alongside the MCP servers. */
  composio: McpServerStatus[] = []
  settings: Settings = {
    quietMode: false,
    nudgesEnabled: true,
    telemetry: false,
    theme: 'dark',
    hotkey: defaultHotkey(process.platform),
    reasoningEffort: null,
    consentAt: null,
    measurePulse: true,
    measureBreathing: true,
    measureHrv: true,
    measureBlinks: true,
    measureExpressions: false,
    pillPosition: null
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
    // A setting an older version saved and this one dropped is left out quietly; a malformed
    // value (a hand edit, say) falls back to its default and is noted.
    const saved = parseSettings(readJson<unknown>(SETTINGS_FILE, {}))
    if (saved.invalid.length)
      this.record(
        'error',
        `Ignored settings in ${SETTINGS_FILE} that were not valid: ${saved.invalid.join(', ')}`
      )
    this.settings = { ...this.settings, ...saved.settings }
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
    tapSpeech(msg)
    const target = ROUTES[msg.type]
    for (const [role, win] of this.windows) {
      if (win.isDestroyed() || (target && role !== target)) continue
      win.webContents.send('hearth:event', msg)
    }
  }

  snapshot(): HearthState {
    return {
      mood: this.mood,
      vitals: this.vitals,
      insights: this.insights.slice(-50),
      memory: this.memory,
      reminders: this.reminders,
      log: this.log,
      mcp: this.connectors(),
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

  connectors(): McpServerStatus[] {
    return [...this.mcp, ...this.composio]
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

  setMood(mood: HearthMood): void {
    if (this.mood === mood) return
    if (mood !== 'sleeping') this.lastActiveAt = Date.now()
    this.mood = mood
    if (mood !== 'thinking') this.activity = null
    this.changed()
  }

  /** Nobody has talked with Hearth for a while: it closes its eyes until the next interaction. */
  sleepIfIdle(afterMs: number): void {
    if (this.mood === 'idle' && Date.now() - this.lastActiveAt >= afterMs) this.setMood('sleeping')
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

  /**
   * The part of a settings patch from outside the main process that can be saved. Unknown or
   * malformed keys are dropped and noted in the timeline, never thrown: the rest still applies.
   */
  validSettings(patch: unknown, from: string): Partial<Settings> {
    const { settings, unknown, invalid } = parseSettings(patch)
    const dropped = [...unknown.map((k) => `${k} (unknown)`), ...invalid]
    if (dropped.length)
      this.record(
        'error',
        `Ignored settings from ${from} that were not valid: ${dropped.join(', ')}`
      )
    return settings
  }

  updateSettings(patch: Partial<Settings>): Settings {
    // The camera needs at least one reading to ask for; switching off the last one is refused.
    if (readingsOn({ ...this.settings, ...patch }).length === 0) {
      patch = Object.fromEntries(
        Object.entries(patch).filter(([key]) => !READINGS.some((r) => r.key === key))
      )
    }
    this.settings = { ...this.settings, ...patch }
    writeJson(SETTINGS_FILE, this.settings)
    this.changed()
    return this.settings
  }

  record(kind: LogKind, message: string, data?: Record<string, unknown>): LogEntry | null {
    if (kind === 'error') {
      const now = Date.now()
      if (message === this.lastError.message && now - this.lastError.at < REPEAT_ERROR_MS)
        return null
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
