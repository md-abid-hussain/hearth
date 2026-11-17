// Records a demo session: the whole screen plus every microphone, until you press Enter.
//
//   node tools/record.mjs              names it session-<date>-<time>
//   node tools/record.mjs mytake       names it mytake
//
// Files land in demo/raw. Ctrl+C also stops it cleanly.
import { listMics, startSession } from './recorder.mjs'

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-')
const name = process.argv[2] ?? `session-${stamp}`

const mics = listMics()
const session = startSession(name, { mics })
console.log(`Recording "${name}": the whole screen${mics.length ? `, plus ${mics.join(' and ')}` : ''}.`)
console.log('Press Enter here to stop.')

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  console.log('Stopping…')
  const meta = await session.stop()
  const minutes = ((meta.video.stoppedAt - (meta.video.firstAt ?? meta.video.spawnedAt)) / 60_000).toFixed(1)
  console.log(`Saved ${meta.video.out} (${minutes} min)`)
  for (const m of meta.mics) console.log(`Saved ${m.out}${m.code === 0 ? '' : ` (ffmpeg exit ${m.code}: ${m.errors})`}`)
  if (meta.video.code !== 0) console.log(`Screen capture problem: ${meta.video.errors}`)
  process.exit(0)
}

process.stdin.on('data', () => void stop())
process.on('SIGINT', () => void stop())
session.screen.exited.then((code) => {
  if (!stopping) {
    console.log(`Screen capture ended on its own (ffmpeg exit ${code}).`)
    void stop()
  }
})
