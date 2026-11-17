// Records the whole screen with Windows Desktop Duplication (sees Hearth's transparent widget)
// and NVIDIA's encoder. No audio: Hearth's voice comes from the WAV files demo mode saves.
import { spawn } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import ffmpeg from 'ffmpeg-static'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const RAW_DIR = join(root, 'raw')

/**
 * Starts recording to raw/<name>.mp4. `firstFrameAt` (epoch ms) is when the first frame was
 * captured, read from ffmpeg's progress output, so the saved speech can be lined up with it.
 */
export function startRecording(name, { fps = 30 } = {}) {
  mkdirSync(RAW_DIR, { recursive: true })
  const out = join(RAW_DIR, `${name}.mp4`)
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-f', 'lavfi',
    '-i', `ddagrab=output_idx=0:framerate=${fps}:draw_mouse=1`,
    // The encoder will not take Desktop Duplication's GPU frames directly here, so they are
    // copied to memory first; at 2560x1600 and 30 fps this keeps up comfortably.
    '-vf', 'hwdownload,format=bgra,format=yuv420p',
    '-c:v', 'h264_nvenc',
    '-preset', 'p5',
    '-rc', 'constqp',
    '-qp', '18',
    '-progress', 'pipe:2',
    '-stats_period', '0.1',
    out
  ]
  const spawnedAt = Date.now()
  const proc = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] })
  let firstFrameAt = null
  let errors = ''
  let outTimeUs = 0
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    for (const line of text.split(/\r?\n/)) {
      const m = /^out_time_us=(\d+)/.exec(line)
      if (m) outTimeUs = Number(m[1])
      const f = /^frame=(\d+)/.exec(line)
      if (f && Number(f[1]) > 0 && firstFrameAt == null) firstFrameAt = Date.now() - outTimeUs / 1000
      if (!/^[a-z0-9_]+=/.test(line) && line.trim()) errors += line + '\n'
    }
  })
  const exited = new Promise((resolve) => proc.on('exit', resolve))

  return {
    out,
    async stop() {
      proc.stdin.write('q')
      const code = await exited
      const meta = { name, fps, spawnedAt, firstFrameAt, stoppedAt: Date.now(), code, errors }
      writeFileSync(join(RAW_DIR, `${name}.json`), JSON.stringify(meta, null, 2))
      if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${errors}`)
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
