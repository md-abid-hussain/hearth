import type { ListenMode } from '../shared/types'
import { respond } from './agent'
import { loadConfig, llmKeyPresent } from './config'
import { hub } from './hub'
import { observer } from './observer'
import { openPttSession, warmStandby, type PttSession } from './voice/stt'
import { beginSpeech, cancelSpeech, speak, warmSpeech } from './voice/tts'

/** Shorter presses are treated as accidental and never reach speech-to-text. */
const MIN_HOLD_MS = 250

let session: PttSession | null = null
let startedAt = 0

export function pttActive(): boolean {
  return observer.pttActive
}

export async function say(text: string): Promise<void> {
  hub.lastReply = text
  hub.setMood('speaking')
  await speak(text)
  if (!loadConfig().assemblyKey) hub.setMood('idle')
}

export function playbackIdle(): void {
  if (hub.mood === 'speaking') hub.setMood('idle')
}

/** Opens speech sessions ahead of the first press, so it does not pay for the handshake. */
export function warmVoice(): void {
  warmStandby()
}

export function pttStart(mode: ListenMode = 'hold'): void {
  cancelSpeech()
  void session?.abort()
  session = null
  observer.pttActive = true
  startedAt = Date.now()
  hub.partialTranscript = ''
  hub.listenMode = mode
  hub.setMood('listening')
  if (!loadConfig().assemblyKey) {
    hub.notify('Add ASSEMBLYAI_API_KEY to .env to talk to Wisp.')
    return
  }
  session = openPttSession((text) => {
    hub.partialTranscript = text
    hub.changed()
  })
  warmSpeech()
}

export function pttLock(): void {
  hub.listenMode = 'handsFree'
  hub.changed()
}

export function pttAudio(chunk: Uint8Array): void {
  session?.push(Buffer.from(chunk))
}

/** Drops the utterance without transcribing it. */
export function pttCancel(): void {
  observer.pttActive = false
  const current = session
  session = null
  void current?.abort()
  hub.listenMode = null
  hub.partialTranscript = ''
  hub.setMood('idle')
}

export async function pttStop(): Promise<void> {
  if (Date.now() - startedAt < MIN_HOLD_MS) {
    pttCancel()
    return
  }
  observer.pttActive = false
  hub.listenMode = null
  const current = session
  session = null
  if (!current) {
    hub.setMood('idle')
    return
  }
  hub.setMood('thinking')
  const releasedAt = Date.now()
  const text = await current.finish()
  const transcribeMs = Date.now() - releasedAt
  if (current.error) hub.notify(`Speech-to-text: ${current.error}`)
  hub.partialTranscript = text
  if (!text) {
    hub.setMood('idle')
    warmStandby()
    return
  }
  await handleUserText(text, 'voice', transcribeMs)
}

export async function handleUserText(
  text: string,
  via: 'voice' | 'typed',
  transcribeMs: number | null = null
): Promise<void> {
  observer.lastUserTurnAt = Date.now()
  hub.record('ptt', `You (${via}): ${text}`)
  if (!llmKeyPresent(loadConfig())) {
    hub.record('error', 'No LLM key set, add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env')
    hub.setMood('idle')
    return
  }
  hub.setMood('thinking')
  const started = Date.now()
  const voiced = Boolean(loadConfig().assemblyKey)
  const speech = voiced ? beginSpeech() : null
  hub.lastReply = ''
  try {
    const reply = await respond(text, (delta) => {
      if (hub.mood === 'thinking') hub.setMood('speaking')
      hub.lastReply += delta
      hub.changed()
      speech?.push(delta)
    })
    hub.lastReply = reply.text
    hub.record('reply', reply.text)
    const exchange = {
      at: started,
      userText: text,
      via,
      tools: reply.tools,
      reply: reply.text,
      latencyMs: Date.now() - started,
      timings: {
        transcribeMs,
        firstTextMs: reply.firstTextMs,
        firstAudioMs: null as number | null,
        reasoningTokens: reply.reasoningTokens
      }
    }
    hub.setExchange(exchange)
    observer.lastUserTurnAt = Date.now()
    if (speech) {
      await speech.end()
      hub.setExchange({
        ...exchange,
        timings: { ...exchange.timings, firstAudioMs: speech.firstAudioMs }
      })
    } else {
      hub.setMood('idle')
    }
    if (via === 'voice') warmStandby()
  } catch (err) {
    cancelSpeech()
    void speech?.end()
    hub.notify(`Wisp could not answer: ${(err as Error).message}`)
    hub.setMood('idle')
  }
}
