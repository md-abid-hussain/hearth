import type { ListenMode } from '../shared/types'
import { respond } from './agent'
import { loadConfig, llmKeyPresent } from './config'
import { hub } from './hub'
import { observer } from './observer'
import { beginUtterance, warmVoiceSession, type VoiceSession } from './voice/stt'
import { beginSpeech, cancelSpeech, speak, warmSpeech } from './voice/tts'

/** Shorter presses are treated as accidental and never reach speech-to-text. */
const MIN_HOLD_MS = 250
/**
 * Audio already captured when the keys come up is still in flight from the pill, so the
 * endpoint waits this long; otherwise the last word ("remind me at seven") is cut off.
 */
const RELEASE_GRACE_MS = 200

let session: VoiceSession | null = null
/** The press being finished: it still receives the audio that arrives during the grace period. */
let finishing: VoiceSession | null = null
let startedAt = 0
/** Bumped by every new press or typed message; older turns stop when they see it change. */
let turn = 0
let replyAbort: AbortController | null = null

export function pttActive(): boolean {
  return observer.pttActive
}

/** A new turn interrupts the old one: its speech stops and its reply stops being written. */
function newTurn(): number {
  turn++
  // A nudge being written right now must not be said over this turn.
  observer.userTurnStarted()
  replyAbort?.abort()
  replyAbort = null
  cancelSpeech()
  return turn
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

/** Opens the speech session ahead of the first press, so it does not pay for the handshake. */
export function warmVoice(): void {
  warmVoiceSession()
}

export function pttStart(mode: ListenMode = 'hold'): void {
  newTurn()
  // A press that never ended (a missed key-up) is dropped rather than merged into this one.
  session?.discard()
  session = null
  observer.pttActive = true
  startedAt = Date.now()
  hub.partialTranscript = ''
  hub.listenMode = mode
  hub.setMood('listening')
  if (!loadConfig().assemblyKey) {
    hub.notify('Add ASSEMBLYAI_API_KEY to .env to talk to Hearth.')
    return
  }
  session = beginUtterance((text) => {
    hub.partialTranscript = text
    hub.changed()
  })
  warmSpeech()
}

export function pttLock(): void {
  hub.listenMode = 'handsFree'
  hub.changed()
}

const consented = (): boolean => hub.settings.consentAt != null

export function pttAudio(chunk: Uint8Array): void {
  // Consent withdrawn mid-press: no more audio goes to AssemblyAI, and the press is dropped
  // along with anything it would have said.
  if (!consented()) {
    if (session || finishing) {
      newTurn()
      finishing = null
      pttCancel()
    }
    return
  }
  ;(session ?? finishing)?.push(Buffer.from(chunk))
}

/** Drops the utterance without transcribing it. */
export function pttCancel(): void {
  observer.pttActive = false
  session?.discard()
  session = null
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
  const myTurn = turn
  session = null
  if (!current) {
    hub.setMood('idle')
    return
  }
  hub.setMood('thinking')
  finishing = current
  await new Promise((resolve) => setTimeout(resolve, RELEASE_GRACE_MS))
  if (finishing === current) finishing = null
  const releasedAt = Date.now()
  const text = await current.finish()
  // Another press began while this one was being transcribed; that press owns the turn now.
  if (myTurn !== turn) return
  // Consent was withdrawn after the last audio chunk; what was said is not answered.
  if (!consented()) {
    hub.partialTranscript = ''
    hub.setMood('idle')
    return
  }
  const transcribeMs = Date.now() - releasedAt
  if (current.error) hub.notify(`Speech-to-text: ${current.error}`)
  hub.partialTranscript = text
  if (!text) {
    hub.setMood('idle')
    return
  }
  await handleUserText(text, 'voice', transcribeMs)
}

export async function handleUserText(
  text: string,
  via: 'voice' | 'typed',
  transcribeMs: number | null = null
): Promise<void> {
  const myTurn = via === 'typed' ? newTurn() : turn
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
  const abort = new AbortController()
  replyAbort = abort
  hub.lastReply = ''
  try {
    const reply = await respond(
      text,
      (delta) => {
        if (abort.signal.aborted) return
        if (hub.mood === 'thinking') hub.setMood('speaking')
        hub.lastReply += delta
        hub.changed()
        speech?.push(delta)
      },
      { abortSignal: abort.signal, onStepEnd: () => speech?.flushPending() }
    )
    if (myTurn !== turn) return
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
      if (myTurn === turn)
        hub.setExchange({
          ...exchange,
          timings: { ...exchange.timings, firstAudioMs: speech.firstAudioMs }
        })
    } else {
      hub.setMood('idle')
    }
  } catch (err) {
    // A newer press or message interrupted this turn; it has already taken over the mood.
    if (abort.signal.aborted || myTurn !== turn) return
    cancelSpeech()
    void speech?.end()
    hub.notify(`Hearth could not answer: ${(err as Error).message}`)
    hub.setMood('idle')
  } finally {
    if (replyAbort === abort) replyAbort = null
  }
}
