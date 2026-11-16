export type WispMood = 'sleeping' | 'idle' | 'listening' | 'thinking' | 'speaking'

export interface VitalsPoint {
  t: number
  pulse: number | null
  breathing: number | null
  hrv: number | null
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
  validationHint: string | null
  updatedAt: number
}

export interface InsightEntry {
  id: string
  requestId: number
  at: number
  text: string
  isError: boolean
  onDemand: boolean
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

export interface Reminder {
  id: string
  text: string
  dueAt: number
  createdAt: number
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

export interface McpServerStatus {
  name: string
  connected: boolean
  error: string | null
  tools: McpToolInfo[]
}

/** An app the user can link through Composio's hosted sign-in. */
export interface ConnectedApp {
  slug: string
  name: string
  connected: boolean
  /** True while a sign-in started from Wisp is waiting for the browser. */
  pending: boolean
}

export interface AppsState {
  /** False when COMPOSIO_API_KEY is missing from .env. */
  configured: boolean
  apps: ConnectedApp[]
  error: string | null
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
}

export interface Settings {
  quietMode: boolean
  nudgesEnabled: boolean
  telemetry: boolean
  theme: ThemeChoice
  hotkey: HotkeyId
  /** Runtime override of OPENAI_MODEL_REASONING; null uses the .env value. */
  reasoningEffort: ReasoningEffort | null
}

export interface WispState {
  mood: WispMood
  vitals: VitalsSnapshot
  insights: InsightEntry[]
  memory: MemoryState
  reminders: Reminder[]
  log: LogEntry[]
  mcp: McpServerStatus[]
  apps: AppsState
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
  | { type: 'state'; state: WispState }
  | { type: 'vitalsPoint'; point: VitalsPoint }
  | { type: 'ttsStart' }
  | { type: 'ttsAudio'; pcm: Uint8Array }
  | { type: 'ttsEnd' }
  | { type: 'ttsCancel' }
  | { type: 'requestInsight'; token: string; prompt: string }
  | { type: 'pttRemote'; on: boolean; discard?: boolean }
