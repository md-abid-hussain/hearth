import type {
  StreamingMode,
  StreamingSpeechModel,
  StreamingTranscriber,
  TurnEvent
} from 'assemblyai'
import { loadConfig } from '../config'
import { hub } from '../hub'
import { QUIET_CLOSE_CODES, assembly, describeStreamingClose, describeVoiceError } from './assembly'

/**
 * AssemblyAI's model for voice agents. In `manual` mode the server never ends a turn on its own:
 * each ForceEndpoint (sent on key release) is answered with exactly one formatted final, empty
 * if nothing was said. That is push-to-talk. Manual mode exists only on this model, and the
 * SDK's types predate both values, so they are cast.
 */
const SPEECH_MODEL = 'assemblyai-stt-3-7-realtime-agent' as StreamingSpeechModel
const PUSH_TO_TALK_MODE = 'manual' as StreamingMode

/** The server closes a session that is left open by accident after this many idle seconds. */
const INACTIVITY_TIMEOUT_S = 30
/** The handshake usually takes about a second, but the first DNS lookup on some networks takes over ten. */
const CONNECT_TIMEOUT_MS = 15_000
const READY_WAIT_MS = 16_000
const FINAL_TURN_TIMEOUT_MS = 2_500
/** Audio sent faster than real time is processed at about 1.25x, so a backlog delays the final. */
const CATCH_UP_SPEED = 1.25
const CHUNK_MS = 50
const TERMINATION_TIMEOUT_MS = 2_000
/** About 20 seconds of 50 ms chunks, held while the session handshake completes. */
const MAX_QUEUED_CHUNKS = 400
/**
 * One session serves a whole conversation: presses reuse it, so they skip the handshake, do
 * not count against the new-sessions-per-minute limit, and keep context from earlier turns.
 * It is billed while open, so it closes after this long without a press.
 */
const IDLE_CLOSE_MS = 2 * 60_000
const KEEPALIVE_MS = 5_000
const AGENT_CONTEXT_MAX = 1_750
const KEYTERMS = ['Hearth', 'Presage', 'SmartSpectra']

/** The latest reply, so short answers like "yes" or "7pm" transcribe in context. */
const agentContext = (): string => hub.lastReply.trim().slice(-AGENT_CONTEXT_MAX)

/** Product names plus the apps the user linked, so they are spelled right. */
function keyterms(): string[] {
  const linked = hub
    .connectors()
    .filter((s) => s.connected)
    .map((s) => s.name)
  return [...new Set([...KEYTERMS, ...linked])].slice(0, 100)
}

interface PendingFinal {
  settle(text: string): void
  settled: boolean
}

const live = new Set<VoiceSession>()
let shared: VoiceSession | null = null

const toArrayBuffer = (chunk: Buffer): ArrayBuffer =>
  chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer

/**
 * A streaming speech-to-text session for push-to-talk. Audio is held until the session opens;
 * each release forces the endpoint, and finals are matched to releases in order.
 */
export class VoiceSession {
  private transcriber: StreamingTranscriber
  private ready: Promise<boolean>
  private queue: ArrayBuffer[] = []
  private open = false
  private ended = false
  private closing: Promise<void> | null = null
  private partial = ''
  private pending: PendingFinal[] = []
  private backlogMs = 0
  private sentContext: string
  private keepAliveTimer: NodeJS.Timeout | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private onPartial: (text: string) => void = () => undefined
  error: string | null = null

  constructor() {
    this.sentContext = agentContext()
    this.transcriber = assembly().streaming.transcriber({
      speechModel: SPEECH_MODEL,
      mode: PUSH_TO_TALK_MODE,
      sampleRate: 16_000,
      encoding: 'pcm_s16le',
      inactivityTimeout: INACTIVITY_TIMEOUT_S,
      connectTimeout: CONNECT_TIMEOUT_MS,
      // AssemblyAI counts every attempt against the new-sessions-per-minute limit.
      maxConnectionRetries: 1,
      keytermsPrompt: keyterms(),
      ...(this.sentContext ? { agentContext: this.sentContext } : {})
    })
    this.transcriber.on('turn', (turn) => this.onTurn(turn))
    this.transcriber.on('error', (err) => {
      this.error ??= describeVoiceError(err)
      this.settleAll()
    })
    this.transcriber.on('close', (code, reason) => {
      this.ended = true
      this.stopTimers()
      live.delete(this)
      if (shared === this) shared = null
      if (!QUIET_CLOSE_CODES.has(code)) this.error ??= describeStreamingClose(code, reason)
      this.settleAll()
    })
    live.add(this)
    this.ready = this.transcriber
      .connect()
      .then(() => {
        this.open = true
        this.backlogMs = this.queue.length * CHUNK_MS
        for (const chunk of this.queue)
          if (!this.send(() => this.transcriber.sendAudio(chunk))) break
        this.queue = []
        return !this.ended
      })
      .catch((err) => {
        this.error ??= describeVoiceError(err)
        this.ended = true
        live.delete(this)
        if (shared === this) shared = null
        this.settleAll()
        return false
      })
  }

  get usable(): boolean {
    return !this.ended && !this.closing && !this.error
  }

  /** A press begins: stop idling and refresh the context if Hearth has spoken since. */
  begin(onPartial: (text: string) => void): void {
    this.stopTimers()
    this.onPartial = onPartial
    this.partial = ''
    this.backlogMs = 0
    const context = agentContext()
    if (this.open && context && context !== this.sentContext) {
      this.sentContext = context
      this.send(() => this.transcriber.updateConfiguration({ agent_context: context }))
    }
  }

  push(chunk: Buffer): void {
    if (this.ended || this.closing) return
    const audio = toArrayBuffer(chunk)
    if (this.open) this.send(() => this.transcriber.sendAudio(audio))
    else if (this.queue.length < MAX_QUEUED_CHUNKS) this.queue.push(audio)
  }

  /** Forces the endpoint and resolves with this press's final transcript. */
  async finish(): Promise<string> {
    const ready = await Promise.race([
      this.ready,
      new Promise<false>((resolve) => setTimeout(() => resolve(false), READY_WAIT_MS))
    ])
    if (!ready || this.ended) {
      this.error ??= 'The voice session did not open in time.'
      return this.partial
    }
    const text = await new Promise<string>((resolve) => {
      const timer = setTimeout(
        () => entry.settle(this.partial),
        FINAL_TURN_TIMEOUT_MS + this.backlogMs / CATCH_UP_SPEED
      )
      const entry: PendingFinal = {
        settled: false,
        settle: (value) => {
          if (entry.settled) return
          entry.settled = true
          clearTimeout(timer)
          resolve(value)
        }
      }
      this.pending.push(entry)
      if (!this.send(() => this.transcriber.forceEndpoint())) entry.settle(this.partial)
    })
    this.idle()
    return text.trim()
  }

  /** Ends the press without a transcript; the final it produces is dropped. */
  discard(): void {
    this.queue = []
    if (this.open && !this.ended) {
      this.pending.push({ settled: true, settle: () => undefined })
      this.send(() => this.transcriber.forceEndpoint())
    }
    this.idle()
  }

  close(): Promise<void> {
    this.stopTimers()
    live.delete(this)
    if (shared === this) shared = null
    this.closing ??= this.ended
      ? Promise.resolve()
      : this.ready.then((opened) =>
          opened
            ? this.transcriber.close(true, TERMINATION_TIMEOUT_MS).catch(() => undefined)
            : undefined
        )
    return this.closing
  }

  /** Between presses: keep the session alive, and close it once the conversation goes quiet. */
  idle(): void {
    this.stopTimers()
    if (this.ended || this.closing) return
    this.keepAliveTimer = setInterval(() => {
      if (this.open) this.send(() => this.transcriber.keepAlive())
    }, KEEPALIVE_MS)
    this.idleTimer = setTimeout(() => void this.close(), IDLE_CLOSE_MS)
  }

  private onTurn(turn: TurnEvent): void {
    if (turn.end_of_turn) {
      this.partial = ''
      this.pending.shift()?.settle(turn.transcript)
      return
    }
    this.partial = turn.transcript
    this.onPartial(turn.transcript)
  }

  /** The SDK throws if the socket closed a moment ago; that ends the session instead of the app. */
  private send(action: () => void): boolean {
    if (this.ended) return false
    try {
      action()
      return true
    } catch (err) {
      this.error ??= describeVoiceError(err)
      this.ended = true
      if (shared === this) shared = null
      this.settleAll()
      return false
    }
  }

  private settleAll(): void {
    for (const entry of this.pending.splice(0)) entry.settle(this.partial)
  }

  private stopTimers(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer)
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.keepAliveTimer = null
    this.idleTimer = null
  }
}

/** Starts a press on the conversation's session, opening one if none is usable. */
export function beginUtterance(onPartial: (text: string) => void): VoiceSession {
  if (!shared?.usable) shared = new VoiceSession()
  shared.begin(onPartial)
  return shared
}

/** Opens the session ahead of the first press, so it does not wait on the handshake. */
export function warmVoiceSession(): void {
  if (!loadConfig().assemblyKey || shared?.usable) return
  shared = new VoiceSession()
  shared.idle()
}

/** Terminates every open session, so none outlive the app. */
export async function closeAllSessions(): Promise<void> {
  shared = null
  await Promise.all([...live].map((s) => s.close()))
}
