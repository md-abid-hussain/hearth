import { AssemblyAI, TextToSpeechError } from 'assemblyai'
import { loadConfig } from '../config'

let client: AssemblyAI | null = null

/** One SDK client for the app; the key never leaves the main process. */
export function assembly(): AssemblyAI {
  client ??= new AssemblyAI({ apiKey: loadConfig().assemblyKey })
  return client
}

const KEY_REFUSED = 'AssemblyAI refused the API key. Check ASSEMBLYAI_API_KEY in .env.'
const OUT_OF_CREDIT = 'Your AssemblyAI account is out of credit.'
/** v3 counts session starts per minute (5 on the free plan), despite the "concurrent" wording. */
const RATE_LIMITED =
  'AssemblyAI is limiting new voice sessions this minute. Wait a minute and try again.'

/** Streaming close codes, from AssemblyAI's v3 session errors and closures reference. */
const STREAMING_CODES: Record<number, string> = {
  1008: KEY_REFUSED,
  3005: 'AssemblyAI had a server error. Try again.',
  3008: 'The voice session hit its maximum length.'
}

/**
 * Code 1008 covers a bad key, missing funds and the session-start rate limit alike; only the
 * close reason tells them apart.
 */
export function describeStreamingClose(code: number | undefined, reason?: string): string | null {
  if (code === 1008 && reason) {
    if (/too many concurrent|rate limit/i.test(reason)) return RATE_LIMITED
    if (/insufficient funds/i.test(reason)) return OUT_OF_CREDIT
    if (/signature has expired/i.test(reason)) return 'The voice sign-in expired. Try again.'
    if (/invalid api key|missing authorization/i.test(reason)) return KEY_REFUSED
    return `AssemblyAI refused the voice session: ${reason}`
  }
  return describeStreamingCode(code)
}

const TTS_CODES: Record<string, string> = {
  unauthorized: KEY_REFUSED,
  rate_limited: 'AssemblyAI is rate limiting speech. Wait a few seconds and try again.',
  voice_not_found: 'The voice in HEARTH_TTS_VOICE does not exist. Remove it to use the default.',
  auth_unavailable: 'AssemblyAI could not check the API key just now. Try again.'
}

/** Close codes that mean the session ended normally or idled out as configured. */
export const QUIET_CLOSE_CODES = new Set([1000, 3006])

export function describeStreamingCode(code: number | undefined): string | null {
  return code == null ? null : (STREAMING_CODES[code] ?? null)
}

export function describeVoiceError(err: unknown): string {
  if (err instanceof TextToSpeechError) {
    return (
      (err.errorCode && TTS_CODES[err.errorCode]) ||
      describeStreamingCode(err.closeCode) ||
      err.message
    )
  }
  const code = (err as { code?: unknown })?.code
  return (
    describeStreamingClose(typeof code === 'number' ? code : undefined, (err as Error)?.message) ??
    (err as Error)?.message ??
    String(err)
  )
}
