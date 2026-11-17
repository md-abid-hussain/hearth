// Records a demo session: the whole screen plus every microphone, until you press Enter.
//
//   node tools/record.mjs              names it session-<date>-<time>
//   node tools/record.mjs mytake       names it mytake
//
// Files land in demo/raw. Ctrl+C also stops it cleanly. If the display changes mid-session,
// the screen recording carries on in a new part file.
import { listMics, startSession } from './recorder.mjs'

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-')
const name = process.argv[2] ?? `session-${stamp}`
const clock = () => new Date().toLocaleTimeString()

const mics = listMics()
const session = startSession(name, {
  mics,
  onEvent(e) {
    if (e.type === 'restart') console.log(`${clock()}  The display changed; screen recording continues in part ${e.part}.`)
    if (e.type === 'micSkipped') console.log(`${clock()}  Skipped "${e.device}": it is not available (${e.reason}).`)
    if (e.type === 'gaveUp') console.log(`${clock()}  Screen recording stopped after ${e.parts} parts. Press Enter to finish.`)
  }
})
console.log(`Recording "${name}": the whole screen${mics.length ? `, plus ${mics.join(' and ')}` : ''}.`)
console.log('Press Enter here to stop.')

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  console.log('Stopping…')
  const meta = await session.stop()
  for (const p of meta.parts) {
    const minutes = ((p.stoppedAt - (p.firstAt ?? p.spawnedAt)) / 60_000).toFixed(1)
    console.log(`Saved ${p.out} (${minutes} min)${p.code === 0 ? '' : ` (ffmpeg exit ${p.code}: ${p.errors})`}`)
  }
  for (const m of meta.mics) console.log(`Saved ${m.out}${m.code === 0 ? '' : ` (ffmpeg exit ${m.code}: ${m.errors})`}`)
  process.exit(0)
}

process.stdin.on('data', () => void stop())
process.on('SIGINT', () => void stop())
