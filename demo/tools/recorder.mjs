// Records the screen with Windows Desktop Duplication (it sees Hearth's transparent widget) and
// NVIDIA's encoder, plus every microphone into its own file. Hearth's own voice is not recorded
// here: demo mode saves each reply as a WAV.
import { spawn, spawnSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import ffmpeg from 'ffmpeg-static'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const RAW_DIR = join(root, 'raw')

/** Audio capture devices Windows offers through DirectShow, such as "Microphone Array (...)". */
export function listMics() {
  const out = spawnSync(ffmpeg, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
    encoding: 'utf8'
  })
  return [...`${out.stderr}`.matchAll(/"([^"]+)" \(audio\)/g)].map((m) => m[1])
}

/**
 * Runs ffmpeg until stop(). `firstAt` is the wall-clock time (epoch ms) of the first frame or
 * sample, read from ffmpeg's progress output, so files can be lined up with Hearth's own logs.
 */
function capture(args, out) {
  const spawnedAt = Date.now()
  const proc = spawn(ffmpeg, [...args, '-progress', 'pipe:2', '-stats_period', '0.1', out], {
    stdio: ['pipe', 'ignore', 'pipe']
  })
  let firstAt = null
  let outTimeUs = 0
  let errors = ''
  proc.stderr.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      const t = /^out_time_us=(\d+)/.exec(line)
      if (t) {
        outTimeUs = Number(t[1])
        if (firstAt == null && outTimeUs > 0) firstAt = Date.now() - outTimeUs / 1000
      }
      if (!/^[a-z0-9_]+=/.test(line) && line.trim()) errors += line + '\n'
    }
  })
  const exited = new Promise((resolve) => proc.on('exit', resolve))
  // Writing "q" to an ffmpeg that is exiting by itself must not crash the recorder.
  proc.stdin.on('error', () => {})
  return {
    out,
    async stop() {
      if (proc.exitCode == null) proc.stdin.write('q')
      const code = await exited
      return { out, spawnedAt, firstAt, stoppedAt: Date.now(), code, errors: errors.trim() }
    },
    exited
  }
}

/** The whole screen to raw/<name>.mkv (MKV stays playable even if recording is cut off). */
export function startScreen(name, { fps = 30 } = {}) {
  mkdirSync(RAW_DIR, { recursive: true })
  return capture(
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi',
      // 8-bit output, so an HDR switch does not change the format mid-recording.
      '-i', `ddagrab=output_idx=0:framerate=${fps}:draw_mouse=1:output_fmt=bgra`,
      // The encoder will not take Desktop Duplication's GPU frames directly here, so they are
      // copied to memory first; at 2560x1600 and 30 fps this keeps up comfortably.
      '-vf', 'hwdownload,format=bgra,format=yuv420p',
      '-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'constqp', '-qp', '18'
    ],
    join(RAW_DIR, `${name}.mkv`)
  )
}

/** One microphone to raw/<name>.mic<n>.flac, lossless so noise removal has the most to work with. */
export function startMic(name, device, n) {
  mkdirSync(RAW_DIR, { recursive: true })
  return capture(
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'dshow', '-audio_buffer_size', '50',
      '-i', `audio=${device}`,
      '-c:a', 'flac'
    ],
    join(RAW_DIR, `${name}.mic${n}.flac`)
  )
}

const MAX_PARTS = 100

/**
 * Screen plus every microphone; stop() ends them all and writes raw/<name>.json.
 *
 * Desktop Duplication stops when the display changes (resolution, a second screen, the lock
 * screen), so the screen is recorded in parts: when one ends by itself, the next starts at once
 * as <name>.part2.mkv and so on, each with its own start time. A microphone that cannot be opened
 * (nothing plugged into the jack) is skipped.
 */
export function startSession(name, { mics = listMics(), onEvent = () => {} } = {}) {
  let stopping = false
  const parts = []
  let current = null

  const startPart = () => {
    const n = parts.length + 1
    const rec = startScreen(n === 1 ? name : `${name}.part${n}`)
    current = rec
    rec.exited.then(async () => {
      if (stopping || current !== rec) return
      current = null
      parts.push(await rec.stop())
      if (parts.length >= MAX_PARTS) return onEvent({ type: 'gaveUp', parts: parts.length })
      onEvent({ type: 'restart', part: parts.length + 1, reason: parts.at(-1).errors })
      setTimeout(() => {
        if (!stopping) startPart()
      }, 300)
    })
  }
  startPart()

  const audio = mics.map((device, i) => {
    const rec = startMic(name, device, i + 1)
    const entry = { device, rec, failed: false }
    rec.exited.then(async () => {
      if (stopping) return
      entry.failed = true
      const meta = await rec.stop()
      if (meta.firstAt == null) rmSync(meta.out, { force: true })
      onEvent({ type: 'micSkipped', device, reason: meta.errors.split('\n')[0] })
    })
    return entry
  })

  return {
    mics,
    get screen() {
      return current
    },
    async stop() {
      stopping = true
      const [last, ...tracks] = await Promise.all([
        current ? current.stop() : null,
        ...audio.filter((a) => !a.failed).map(async (a) => ({ device: a.device, ...(await a.rec.stop()) }))
      ])
      if (last) parts.push(last)
      const meta = { name, parts, mics: tracks, skippedMics: audio.filter((a) => a.failed).map((a) => a.device) }
      writeFileSync(join(RAW_DIR, `${name}.json`), JSON.stringify(meta, null, 2))
      return meta
    }
  }
}

/** One full-resolution frame of the screen, for checking what is on it. */
export async function screenshot(file) {
  mkdirSync(dirname(file), { recursive: true })
  const proc = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'ddagrab=output_idx=0:framerate=5:draw_mouse=1',
    '-vf', 'hwdownload,format=bgra',
    '-frames:v', '1', file
  ])
  const code = await new Promise((resolve) => proc.on('exit', resolve))
  if (code !== 0) throw new Error(`screenshot failed (${code})`)
  return file
}
