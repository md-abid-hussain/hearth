export type HearthMood = 'sleeping' | 'idle' | 'listening' | 'thinking' | 'speaking'

export interface VitalsPoint {
  t: number
  pulse: number | null
  breathing: number | null
  hrv: number | null
  /** Blinks in the minute before t; null until a full minute has been measured. */
  blinks?: number | null
  /** Most likely facial expression at t; null when expressions are off or none is current. */
  expression?: string | null
}

export interface VitalsSnapshot {
  sensing: boolean
  present: boolean
  sessionStartedAt: number | null
  sittingSince: number | null
  pulse: number | null
  pulseConfidence: number | null
  breathing: number | null
  breathingConfidence: number | null
  hrvRmssd: number | null
  talking: boolean
  blinksPerMinute: number | null
  /**
   * The most likely facial expression, only when Settings.measureExpressions is on. Drives the orb
   * and the dashboard; the label (never frames) also goes to the language model, with a summary of
   * recent labels, as a rough hint.
   */
  expression: { label: string; confidence: number } | null
  validationHint: string | null
  /** Sensing paused itself because the user left; it resumes on their next key press or mouse move. */
  pausedAway: boolean
  updatedAt: number
}

export interface InsightEntry {
  id: string
  requestId: number
  at: number
  text: string
  isError: boolean
  onDemand: boolean
  structured?: InsightStructured
}

export type InsightMetricStatus = 'good' | 'watch' | 'low' | 'high' | 'unknown'

export interface InsightMetric {
  name: string
  value: string
  status: InsightMetricStatus
  note?: string
}

/** An LLM-extracted view of an insight's markdown; never adds facts the text lacks. */
export interface InsightStructured {
  headline: string
  metrics: InsightMetric[]
  observations: string[]
  suggestions: string[]
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  at: number
}

export interface MemoryState {
  summary: string
  pins: string[]
  turns: ChatTurn[]
  compactions: number
}

export type CheckFocus = 'eyes' | 'breathing' | 'pulse' | 'overall'

/**
 * A reminder Hearth sets for itself: when due it re-reads the signals, stays silent and
 * reschedules while they look fine, speaks up when they don't, and ends when the camera
 * loses the user.
 */
export interface CheckIn {
  focus: CheckFocus
  everyMin: number
  runsLeft: number
  /** Times it was pushed back a minute because the signal was still settling. */
  waits: number
}

export interface Reminder {
  id: string
  text: string
  dueAt: number
  createdAt: number
  check?: CheckIn
  /** A repeating reminder: said every `everyMin` minutes, `left` more times including the next. */
  repeat?: { everyMin: number; left: number }
}

export type LogKind =
  | 'session'
  | 'insight'
  | 'ptt'
  | 'reply'
  | 'tool'
  | 'nudge'
  | 'suppressed'
  | 'reminder'
  | 'mcp'
  | 'memory'
  | 'error'

export interface LogEntry {
  id: string
  at: number
  kind: LogKind
  message: string
  data?: Record<string, unknown>
}

export interface McpToolInfo {
  server: string
  name: string
  exposedAs: string
  allowed: boolean
  reason: string
}

/**
 * - none: the server needs no sign-in, or its credentials come from mcp.json
 * - signedOut: it answered 401 and is waiting for the user to sign in
 * - signingIn: the browser sign-in is open
 * - signedIn: OAuth tokens or a pasted key are stored
 */
export type McpAuthState = 'none' | 'signedOut' | 'signingIn' | 'signedIn'

export type McpGroup = 'work' | 'code' | 'search' | 'composio' | 'custom'

export interface McpServerStatus {
  /** Stable key used for sign-in calls: a preset id, a custom id, the mcp.json name or a Composio app. */
  id: string
  name: string
  /** composio: the Composio session and the Google accounts linked through it, not an MCP server. */
  source: 'preset' | 'custom' | 'mcp.json' | 'composio'
  url: string | null
  auth: McpAuthState
  /** Why a preset cannot be used yet, such as a missing OAuth client in .env. */
  unavailable: string | null
  group: McpGroup
  /** Set when the server takes a pasted key instead of OAuth, naming what to paste. */
  keyLabel: string | null
  /** Off keeps the credentials but hides the server's tools from the model. */
  enabled: boolean
  connected: boolean
  error: string | null
  tools: McpToolInfo[]
}

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ThemeChoice = 'dark' | 'light' | 'auto'
export type HotkeyId = 'ctrl-win' | 'right-alt' | 'right-ctrl'
export type ListenMode = 'hold' | 'handsFree'

export interface Exchange {
  at: number
  userText: string
  via: 'voice' | 'typed'
  tools: string[]
  reply: string
  latencyMs: number
  /** Missing on exchanges saved by earlier versions. */
  timings?: ExchangeTimings
}

/** Where the wait went, in milliseconds; null when a stage did not happen. */
export interface ExchangeTimings {
  /** From key release to the final transcript. */
  transcribeMs: number | null
  /** From the transcript to the first reply text. */
  firstTextMs: number | null
  /** From the transcript to the first audio from text-to-speech. */
  firstAudioMs: number | null
  reasoningTokens: number | null
}

export interface AppStatus {
  llmProvider: string
  llmModel: string
  envReasoningEffort: ReasoningEffort | null
  ttsVoice: string
  pttShortcut: string
  handsFreeShortcut: string
  llmReady: boolean
  assemblyReady: boolean
  smartspectraReady: boolean
  mcpConfigPath: string | null
  dataDir: string
  /** Where Hearth reads its keys: the .env next to package.json, or where it should go. */
  envPath: string
}

export interface Settings {
  quietMode: boolean
  nudgesEnabled: boolean
  telemetry: boolean
  theme: ThemeChoice
  hotkey: HotkeyId
  /** Runtime override of OPENAI_MODEL_REASONING; null uses the .env value. */
  reasoningEffort: ReasoningEffort | null
  /** When the user accepted the first-run consent; null until then, and the camera and mic stay off. */
  consentAt: number | null
  /**
   * Which camera readings to ask SmartSpectra for; at least one stays on. Each applies the next
   * time sensing starts.
   */
  measurePulse: boolean
  measureBreathing: boolean
  measureHrv: boolean
  /** Ask SmartSpectra for blink and talking detection. Applies the next time sensing starts. */
  measureBlinks: boolean
  /** Ask SmartSpectra for facial expression estimates. Off by default; applies the next time sensing starts. */
  measureExpressions: boolean
  /** Where the user dragged the widget's window, or null for bottom center. */
  pillPosition: { x: number; y: number } | null
}

export interface HearthState {
  mood: HearthMood
  vitals: VitalsSnapshot
  insights: InsightEntry[]
  memory: MemoryState
  reminders: Reminder[]
  log: LogEntry[]
  mcp: McpServerStatus[]
  settings: Settings
  status: AppStatus
  partialTranscript: string
  lastReply: string
  lastExchange: Exchange | null
  activity: string | null
  listenMode: ListenMode | null
  /** A short problem the user should see on the pill, cleared after a few seconds. */
  notice: string | null
}

export type WindowRole = 'pill' | 'dashboard'

export type MainToRenderer =
  | { type: 'state'; state: HearthState }
  | { type: 'vitalsPoint'; point: VitalsPoint }
  | { type: 'ttsStart' }
  | { type: 'ttsAudio'; pcm: Uint8Array }
  | { type: 'ttsEnd' }
  | { type: 'ttsCancel' }
  | { type: 'requestInsight'; token: string; prompt: string }
  /** Start or stop the camera session, which lives in the dashboard window. */
  | { type: 'sensingCommand'; on: boolean }
  /** Open a dashboard page, such as Reminders when a reminder notification is clicked. */
  | { type: 'showPage'; page: string }
  /** A brief reaction on Hearth's face, such as dizzy after the widget is shaken. */
  | { type: 'react'; kind: 'dizzy' }
  | { type: 'pttRemote'; on: boolean; discard?: boolean }
