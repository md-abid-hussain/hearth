// Real cursor movement and clicks for the demo, plus spoken cues for the person on camera.
// Positions are in Electron's DIP coordinates (what Hearth's /state reports); they are scaled to
// physical pixels for the helper, which is DPI aware.
import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'input.ps1')

export async function openInput(scaleFactor) {
  const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
    stdio: ['pipe', 'pipe', 'inherit']
  })
  const lines = createInterface({ input: proc.stdout })
  const waiting = []
  lines.on('line', (line) => waiting.shift()?.(line.trim()))
  const next = () => new Promise((resolve) => waiting.push(resolve))
  const ready = await next()
  if (ready !== 'ready') throw new Error(`input helper: ${ready}`)

  const send = async (cmd) => {
    proc.stdin.write(cmd + '\n')
    const answer = await next()
    if (answer.startsWith('error')) throw new Error(answer)
    return answer
  }
  const toPx = (v) => Math.round(v * scaleFactor)
  let at = await where()

  async function where() {
    const [, x, y] = (await send('where')).split(' ').map(Number)
    return { x: x / scaleFactor, y: y / scaleFactor }
  }

  /** Glides the cursor to (x, y) over `ms`, easing in and out like a hand would. */
  async function move(x, y, ms = 600) {
    const from = at
    const steps = Math.max(1, Math.round(ms / 16))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      await send(`pos ${toPx(from.x + (x - from.x) * e)} ${toPx(from.y + (y - from.y) * e)}`)
      await new Promise((r) => setTimeout(r, ms / steps))
    }
    at = { x, y }
  }

  return {
    move,
    where,
    async click() {
      await send('down')
      await new Promise((r) => setTimeout(r, 70))
      await send('up')
    },
    /** Press at the current position, glide to (x, y), release. */
    async drag(x, y, ms = 1200) {
      await send('down')
      await new Promise((r) => setTimeout(r, 120))
      await move(x, y, ms)
      await new Promise((r) => setTimeout(r, 120))
      await send('up')
    },
    /** Speaks a cue to the person on camera; the recording has no audio, so it never shows up. */
    cue: (text) => send(`cue ${text}`),
    close() {
      proc.stdin.end()
    }
  }
}
