import type { TextToSpeechSession } from 'assemblyai'
import { loadConfig } from '../config'
import { hub } from '../hub'
import { QUIET_CLOSE_CODES, assembly, describeVoiceError } from './assembly'

export const TTS_SAMPLE_RATE = 24_000
/** Closed by us before the API's own idle timeout, so an idle session never ends in an error. */
const IDLE_CLOSE_MS = 60_000
/** The handshake usually takes under a second but has been measured past ten. */
const CONNECT_TIMEOUT_MS = 15_000

let session: TextToSpeechSession | null = null
let connecting: Promise<TextToSpeechSession> | null = null
let idleTimer: NodeJS.Timeout | null = null
/** Bumped on every new reply and on cancel, so a stale stream stops forwarding audio. */
let generation = 0
let speaking = false

async function connectSession(): Promise<TextToSpeechSession> {
  const next = assembly().tts.session({
    voiceId: loadConfig().ttsVoice,
    sampleRate: TTS_SAMPLE_RATE,
    encoding: 'pcm_s16le',
    wordBoundaries: false,
    connectTimeout: CONNECT_TIMEOUT_MS
  })
  next.on('close', (code) => {
    if (session === next) session = null
    if (!QUIET_CLOSE_CODES.has(code) && next.error)
      hub.record('error', `Text-to-speech: ${describeVoiceError(next.error)}`)
  })
  await next.connect()
  return next
}

function openSession(): Promise<TextToSpeechSession> {
  if (session) return Promise.resolve(session)
  connecting ??= (async () => {
    try {
      session = await connectSession().catch((err: { retryable?: boolean }) => {
        if (err?.retryable === false) throw err
        return connectSession()
      })
      return session
    } finally {
      connecting = null
    }
  })()
  return connecting
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => void closeSpeech(), IDLE_CLOSE_MS)
}

/** Opens the session ahead of a reply, so the first words are not held up by the handshake. */
export function warmSpeech(): void {
  if (!loadConfig().assemblyKey) return
  openSession()
    .then(scheduleIdleClose)
    .catch(() => undefined)
}

export interface SpeechStream {
  /** Appends reply text as it is written; texts are joined exactly as sent. */
  push(text: string): void
  /** Concludes the reply and resolves once its audio has been forwarded. */
  end(): Promise<void>
  /** Milliseconds from start to the first audio chunk, or null if none arrived. */
  readonly firstAudioMs: number | null
}

/**
 * Starts one spoken reply on the shared TTS session. Text can be pushed while the
 * session is still connecting; audio streams to the pill as soon as the API sends it.
 */
export function beginSpeech(): SpeechStream {
  cancelSpeech()
  const mine = ++generation
  const startedAt = Date.now()
  let firstAudioMs: number | null = null
  let tts: TextToSpeechSession | null = null
  let reader: Promise<void> = Promise.resolve()
  const held: string[] = []
  if (idleTimer) clearTimeout(idleTimer)

  const pump = async (s: TextToSpeechSession): Promise<void> => {
    speaking = true
    hub.send({ type: 'ttsStart' })
    for await (const pcm of s.audio()) {
      if (mine !== generation) break
      firstAudioMs ??= Date.now() - startedAt
      hub.send({ type: 'ttsAudio', pcm })
    }
  }

  const ready = openSession().then((s) => {
    if (mine !== generation) return
    tts = s
    reader = pump(s)
    held.forEach((text) => s.generate(text))
    held.length = 0
  })

  return {
    push(text) {
      if (mine !== generation || !text) return
      if (tts) tts.generate(text)
      else held.push(text)
    },
    async end() {
      try {
        await ready
        if (mine !== generation || !tts) return
        tts.flush()
        await reader
      } catch (err) {
        if (mine === generation) hub.record('error', `Text-to-speech: ${describeVoiceError(err)}`)
      } finally {
        if (mine === generation) {
          speaking = false
          hub.send({ type: 'ttsEnd' })
        }
        scheduleIdleClose()
      }
    },
    get firstAudioMs() {
      return firstAudioMs
    }
  }
}

/** Speaks a complete text, such as an observer nudge. */
export async function speak(text: string): Promise<void> {
  if (!loadConfig().assemblyKey || !text.trim()) return
  const speech = beginSpeech()
  speech.push(text)
  await speech.end()
}

/** Barge-in: stops the reply in flight and keeps the session open for the next one. */
export function cancelSpeech(): void {
  generation++
  if (!speaking) return
  speaking = false
  try {
    session?.cancel()
  } catch {
    // The session already ended; there is nothing to cancel.
  }
  hub.send({ type: 'ttsCancel' })
}

export async function closeSpeech(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  const current = session
  session = null
  await current?.close(false).catch(() => undefined)
}
