import type { TextToSpeechSession } from 'assemblyai'
import { readFileSync } from 'fs'
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
  /** Speaks whatever has been written so far, for example before a tool call. */
  flushPending(): void
  /** Concludes the reply and resolves once its audio has been forwarded. */
  end(): Promise<void>
  /** Milliseconds from start to the first audio chunk, or null if none arrived. */
  readonly firstAudioMs: number | null
}

/**
 * The end of the last complete sentence in `text`: . ! ? or an ellipsis, optionally closed by a
 * quote or bracket, then whitespace. AssemblyAI treats a sentence as finished only once
 * whitespace follows it.
 */
function lastSentenceEnd(text: string): number {
  let end = -1
  for (const match of text.matchAll(/[.!?…]["'”’)\]]*\s+/g)) end = match.index + match[0].length
  return end
}

/** One Generate frame holds at most 2,000 characters. */
const FRAME_CHARS = 1_800

/** Stops the reply being spoken, so its audio pump does not wait forever. */
let stopCurrent: (() => void) | null = null

/**
 * Starts one spoken reply on the shared TTS session. Text can be pushed while the session is
 * still connecting. Each finished sentence becomes its own request and is flushed at once:
 * per AssemblyAI's latency guide, an unflushed short sentence (or text written just before a
 * tool call) would otherwise wait for more text before it is spoken.
 */
export function beginSpeech(): SpeechStream {
  cancelSpeech()
  const mine = ++generation
  const startedAt = Date.now()
  let firstAudioMs: number | null = null
  let tts: TextToSpeechSession | null = null
  let reader: Promise<void> = Promise.resolve()
  let buffered = ''
  let finished = false
  let failed = false
  const requests: number[] = []
  let wake: (() => void) | null = null
  const nudge = (): void => {
    const w = wake
    wake = null
    w?.()
  }
  stopCurrent = nudge
  if (idleTimer) clearTimeout(idleTimer)

  /** Sends text as one request and flushes it; a failure leaves the reply as text only. */
  const sendRequest = (text: string): void => {
    if (!tts || failed || !text.trim()) return
    try {
      for (let i = 0; i < text.length; i += FRAME_CHARS)
        tts.generate(text.slice(i, i + FRAME_CHARS))
      requests.push(tts.flush())
    } catch (err) {
      failed = true
      hub.record('error', `Text-to-speech: ${describeVoiceError(err)}`)
    }
    nudge()
  }

  /** Sends every complete sentence written so far, keeping the unfinished rest. */
  const sendSentences = (): void => {
    const end = lastSentenceEnd(buffered)
    if (end <= 0) return
    sendRequest(buffered.slice(0, end))
    buffered = buffered.slice(end)
  }

  const flushAll = (): void => {
    sendRequest(buffered)
    buffered = ''
  }

  /** Reads each request's audio in order until the reply ends or is cancelled. */
  const pump = async (s: TextToSpeechSession): Promise<void> => {
    speaking = true
    hub.send({ type: 'ttsStart' })
    for (;;) {
      if (mine !== generation || failed) return
      const id = requests.shift()
      if (id === undefined) {
        if (finished) return
        await new Promise<void>((resolve) => (wake = resolve))
        continue
      }
      for await (const pcm of s.audio(id)) {
        if (mine !== generation) return
        firstAudioMs ??= Date.now() - startedAt
        hub.send({ type: 'ttsAudio', pcm })
      }
    }
  }

  const ready = openSession().then((s) => {
    if (mine !== generation) return
    tts = s
    reader = pump(s).catch((err) => {
      if (mine === generation) hub.record('error', `Text-to-speech: ${describeVoiceError(err)}`)
    })
    sendSentences()
  })
  ready.catch(() => undefined)

  return {
    push(text) {
      if (mine !== generation || !text) return
      buffered += text
      sendSentences()
    },
    flushPending() {
      if (mine === generation) flushAll()
    },
    async end() {
      try {
        await ready
        if (mine !== generation || !tts) return
        flushAll()
        finished = true
        nudge()
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

/**
 * Barge-in: stops the reply in flight and keeps the session open for the next one. The pill is
 * told to stop playback even after all audio has arrived, because synthesis runs well ahead of
 * playback and FlushDone lands long before the last words are heard.
 */
/** Chunk size for a recorded clip: 0.2 s of 24 kHz 16-bit audio. */
const CLIP_CHUNK = 9_600

/** The raw PCM of a recorded WAV (24 kHz, mono, 16-bit, as Hearth's own voice is). */
function wavPcm(file: string): Buffer {
  const wav = readFileSync(file)
  const data = wav.indexOf('data', 12)
  if (data < 0 || wav.readUInt32LE(24) !== TTS_SAMPLE_RATE)
    throw new Error(`${file} is not a 24 kHz PCM WAV`)
  return wav.subarray(data + 8, data + 8 + wav.readUInt32LE(data + 4))
}

/**
 * Plays a recorded clip of Hearth's voice, bundled with the app, through the same path as live
 * speech (the face talks, the caption shows `text`), with no network request.
 */
export function playClip(file: string, text: string): void {
  cancelSpeech()
  let pcm: Buffer
  try {
    pcm = wavPcm(file)
  } catch (err) {
    hub.record('error', `Could not play a recorded line: ${(err as Error).message}`)
    return
  }
  hub.lastReply = text
  hub.setMood('speaking')
  hub.send({ type: 'ttsStart' })
  for (let i = 0; i < pcm.length; i += CLIP_CHUNK)
    hub.send({ type: 'ttsAudio', pcm: pcm.subarray(i, i + CLIP_CHUNK) })
  hub.send({ type: 'ttsEnd' })
}

export function cancelSpeech(): void {
  generation++
  stopCurrent?.()
  stopCurrent = null
  if (speaking) {
    speaking = false
    try {
      session?.cancel()
    } catch {
      // The session already ended; there is nothing to cancel.
    }
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
