import { state, sleep } from './hearth.mjs'
import { startRecording, screenshot } from './recorder.mjs'
import { openInput } from './input.mjs'

const s = await state()
console.log('mood', s.mood, '| consent', s.settings.consentAt, '| sensing', s.vitals.sensing)
console.log('display', JSON.stringify(s.display), '| pill', JSON.stringify(s.windows.pill))
const input = await openInput(s.display.scaleFactor)
console.log('cursor', JSON.stringify(await input.where()))
const rec = startRecording('smoke')
await sleep(4000)
const meta = await rec.stop()
console.log('recording', meta.code, 'first frame', meta.firstFrameAt - meta.spawnedAt, 'ms after spawn')
await screenshot('build/smoke.png')
input.close()
