import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { MainToRenderer } from '../shared/types'
import { isDemo } from './demo'
import { dataPath } from './store'

/** Matches TTS_SAMPLE_RATE in voice/tts.ts; imported from there it would close an import cycle. */
const SAMPLE_RATE = 24_000

let take: { at: number; chunks: Buffer[] } | null = null

/**
 * In demo mode, saves each spoken reply as a WAV named after the time its audio started, so a
 * screen recording can be cut together with Hearth's clean voice instead of a room microphone.
 */
export function tapSpeech(msg: MainToRenderer): void {
  if (!isDemo()) return
  if (msg.type === 'ttsAudio') {
    take ??= { at: Date.now(), chunks: [] }
    take.chunks.push(Buffer.from(msg.pcm))
  } else if (msg.type === 'ttsEnd') save(null)
  else if (msg.type === 'ttsCancel') save(Date.now())
}

/** Audio arrives faster than it plays, so a reply cut short keeps only what was heard. */
function save(cutAt: number | null): void {
  if (!take) return
  const { at, chunks } = take
  take = null
  let pcm = Buffer.concat(chunks)
  if (cutAt != null) {
    const heard = Math.max(0, Math.floor(((cutAt - at) / 1000) * SAMPLE_RATE)) * 2
    pcm = pcm.subarray(0, Math.min(pcm.length, heard))
  }
  if (!pcm.length) return
  const dir = dataPath('demo-audio')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${at}.wav`), wav(pcm))
}

function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
