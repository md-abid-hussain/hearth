import type { StreamingTranscriber, TurnEvent } from 'assemblyai'
import { loadConfig } from '../config'
import { QUIET_CLOSE_CODES, assembly, describeStreamingCode, describeVoiceError } from './assembly'

/** The server closes a session that is left open by accident after this many idle seconds. */
const INACTIVITY_TIMEOUT_S = 15
/** The handshake usually takes about a second but has been measured past ten. */
const CONNECT_TIMEOUT_MS = 15_000
const FINAL_TURN_TIMEOUT_MS = 2_500
const NOTHING_SAID_WAIT_MS = 600
const TERMINATION_TIMEOUT_MS = 2_000
/** About 20 seconds of 50 ms chunks, held while the session handshake completes. */
const MAX_QUEUED_CHUNKS = 400
/** A standby session is billed while open, so it only outlives a conversation briefly. */
const STANDBY_MS = 90_000
const KEEPALIVE_MS = 5_000

const live = new Set<PttSession>()
let standby: PttSession | null = null
let standbyTimer: NodeJS.Timeout | null = null

const toArrayBuffer = (chunk: Buffer): ArrayBuffer =>
  chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer

/**
 * One push-to-talk utterance on the AssemblyAI streaming SDK. Audio is held until the
 * session opens, and release forces the endpoint so the final turn arrives without
 * waiting for silence.
 */
export class PttSession {
  private transcriber: StreamingTranscriber
  private ready: Promise<boolean>
  private queue: ArrayBuffer[] = []
  private open = false
  private ended = false
  private closing: Promise<void> | null = null
  private finals = new Map<number, string>()
  private partial = ''
  private turnWaiter: (() => void) | null = null
  private keepAliveTimer: NodeJS.Timeout | null = null
  onPartial: (text: string) => void = () => undefined
  error: string | null = null

  constructor() {
    this.transcriber = assembly().streaming.transcriber({
      speechModel: 'universal-3-6-pro',
      sampleRate: 16_000,
      encoding: 'pcm_s16le',
      inactivityTimeout: INACTIVITY_TIMEOUT_S,
      connectTimeout: CONNECT_TIMEOUT_MS,
      maxConnectionRetries: 2
    })
    this.transcriber.on('turn', (turn) => this.onTurn(turn))
    this.transcriber.on('error', (err) => {
      this.error ??= describeVoiceError(err)
      this.turnWaiter?.()
    })
    this.transcriber.on('close', (code) => {
      this.ended = true
      this.stopKeepAlive()
      live.delete(this)
      if (standby === this) standby = null
      if (!QUIET_CLOSE_CODES.has(code)) this.error ??= describeStreamingCode(code)
      this.turnWaiter?.()
    })
    live.add(this)
    this.ready = this.transcriber
      .connect()
      .then(() => {
        this.open = true
        this.queue.forEach((chunk) => this.transcriber.sendAudio(chunk))
        this.queue = []
        return true
      })
      .catch((err) => {
        this.error ??= describeVoiceError(err)
        this.ended = true
        live.delete(this)
        if (standby === this) standby = null
        return false
      })
  }

  get usable(): boolean {
    return !this.ended && !this.closing && !this.error
  }

  /** Holds an idle session open until it is claimed by the next press. */
  keepWarm(): void {
    this.keepAliveTimer = setInterval(() => {
      if (this.open && !this.ended) this.transcriber.keepAlive()
    }, KEEPALIVE_MS)
  }

  stopKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer)
    this.keepAliveTimer = null
  }

  private onTurn(turn: TurnEvent): void {
    if (turn.end_of_turn) {
      this.finals.set(turn.turn_order, turn.transcript)
      this.partial = ''
      this.turnWaiter?.()
    } else {
      this.partial = turn.transcript
    }
    this.onPartial(this.text())
  }

  private text(): string {
    const done = [...this.finals.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t)
    return [...done, this.partial].filter(Boolean).join(' ').trim()
  }

  push(chunk: Buffer): void {
    if (this.ended || this.closing) return
    if (this.open) this.transcriber.sendAudio(toArrayBuffer(chunk))
    else if (this.queue.length < MAX_QUEUED_CHUNKS) this.queue.push(toArrayBuffer(chunk))
  }

  /**
   * Forces the endpoint and resolves with the transcript as soon as the final turn
   * arrives; the session's termination handshake completes in the background.
   */
  async finish(): Promise<string> {
    if ((await this.ready) && !this.ended) {
      const heardSomething = Boolean(this.partial)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          resolve,
          heardSomething ? FINAL_TURN_TIMEOUT_MS : NOTHING_SAID_WAIT_MS
        )
        this.turnWaiter = () => {
          clearTimeout(timer)
          resolve()
        }
        this.transcriber.forceEndpoint()
      })
      this.turnWaiter = null
    }
    void this.close()
    return this.text()
  }

  /** Ends the session without waiting for a transcript. */
  async abort(): Promise<void> {
    this.turnWaiter?.()
    if (await this.ready) await this.close()
  }

  private close(): Promise<void> {
    this.stopKeepAlive()
    live.delete(this)
    this.closing ??= this.ended
      ? Promise.resolve()
      : this.transcriber.close(true, TERMINATION_TIMEOUT_MS).catch(() => undefined)
    return this.closing
  }
}

function clearStandby(): void {
  if (standbyTimer) clearTimeout(standbyTimer)
  standbyTimer = null
  standby = null
}

/** Starts an utterance, reusing the warm standby session when one is open. */
export function openPttSession(onPartial: (text: string) => void): PttSession {
  const warm = standby?.usable ? standby : null
  clearStandby()
  const session = warm ?? new PttSession()
  session.stopKeepAlive()
  session.onPartial = onPartial
  return session
}

/**
 * Opens a session ahead of the next press, so a follow-up during a conversation
 * does not wait on the handshake. It closes itself after a short window.
 */
export function warmStandby(): void {
  if (!loadConfig().assemblyKey || standby?.usable) return
  const session = new PttSession()
  session.keepWarm()
  standby = session
  standbyTimer = setTimeout(() => {
    if (standby !== session) return
    clearStandby()
    void session.abort()
  }, STANDBY_MS)
}

/** Terminates every open session, so none outlive the app. */
export async function closeAllSessions(): Promise<void> {
  clearStandby()
  await Promise.all([...live].map((s) => s.abort()))
}
