import { AssemblyAI, TextToSpeechError } from 'assemblyai'
import { loadConfig } from '../config'

let client: AssemblyAI | null = null

/** One SDK client for the app; the key never leaves the main process. */
export function assembly(): AssemblyAI {
  client ??= new AssemblyAI({ apiKey: loadConfig().assemblyKey })
  return client
}

const KEY_REFUSED = 'AssemblyAI refused the API key. Check ASSEMBLYAI_API_KEY in .env.'
const TOO_MANY =
  'Too many voice sessions are open on your AssemblyAI account. Leftover ones close within 15 seconds, so try again shortly.'

/** Streaming close and error codes, from the AssemblyAI streaming reference. */
const STREAMING_CODES: Record<number, string> = {
  1008: KEY_REFUSED,
  4001: KEY_REFUSED,
  4002: 'Your AssemblyAI account is out of credit.',
  4003: 'Streaming speech-to-text needs an AssemblyAI account with billing set up.',
  3009: TOO_MANY,
  4102: TOO_MANY,
  4029: 'AssemblyAI is rate limiting new voice sessions. Wait a few seconds and try again.',
  3005: 'AssemblyAI had a server error. Try again.',
  3008: 'The voice session hit its maximum length.'
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
    describeStreamingCode(typeof code === 'number' ? code : undefined) ??
    (err as Error)?.message ??
    String(err)
  )
}
