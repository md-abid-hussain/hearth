// Directs a demo recording one step at a time. Hearth must be running with HEARTH_DEMO=1.
//
//   node tools/do.mjs state                    short summary of Hearth's state
//   node tools/do.mjs say "text" [--wait]      typed message to Hearth; --wait until it has answered
//   node tools/do.mjs page reminders           open a dashboard page
//   node tools/do.mjs sensing on|off
//   node tools/do.mjs set quietMode=true       change a setting (quietMode, measureBlinks, ...)
//   node tools/do.mjs dash X Y W H             place the dashboard window (DIPs)
//   node tools/do.mjs pill X Y                 place the widget (DIPs)
//   node tools/do.mjs clearlog
//   node tools/do.mjs move X Y [ms]            glide the cursor (DIPs)
//   node tools/do.mjs click | drag X Y [ms]
//   node tools/do.mjs cue "text"               speak a cue to the person on camera
//   node tools/do.mjs shot [name]              screenshot to build/<name>.png
//   node tools/do.mjs rec NAME                 record raw/NAME.mp4 until `stop NAME` (run it in the background)
//   node tools/do.mjs stop NAME
import { existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import * as hearth from './hearth.mjs'
import { openInput } from './input.mjs'
import { RAW_DIR, screenshot, startRecording } from './recorder.mjs'

const [cmd, ...args] = process.argv.slice(2)
const num = (i) => Number(args[i])

async function withInput(run) {
  const s = await hearth.state()
  const input = await openInput(s.display.scaleFactor)
  try {
    await run(input)
  } finally {
    input.close()
  }
}

function summary(s) {
  const v = s.vitals
  const sig = v.sensing
    ? `pulse ${v.pulseBpm ?? '-'} breathing ${v.breathingPerMin ?? '-'} hrv ${v.hrvRmssdMs ?? '-'} blinks ${v.blinksPerMinute ?? '-'} talking ${v.talking} present ${v.present}${v.validationHint ? ` hint "${v.validationHint}"` : ''}${v.expression ? ` face ${v.expression}` : ''}`
    : `sensing off${v.pausedAway ? ' (paused, away)' : ''}`
  const lines = [
    `mood ${s.mood}${s.activity ? ` (${s.activity})` : ''} | quiet ${s.settings.quietMode} | consent ${s.settings.consentAt ? 'yes' : 'no'}`,
    `signals: ${sig}`,
    `widget ${JSON.stringify(s.windows.pill)} dashboard ${JSON.stringify(s.windows.dashboard?.bounds ?? null)}`,
    ...s.reminders.map(
      (r) =>
        `reminder: ${r.text}${r.check ? ` every ${r.check.everyMin}m, ${r.check.runsLeft} left` : ''} at ${new Date(r.dueAt).toLocaleTimeString()}`
    ),
    s.notice ? `notice: ${s.notice}` : '',
    s.lastReply ? `last reply: ${s.lastReply.slice(0, 160)}` : '',
    'log:',
    ...s.log.slice(-6).map((e) => `  ${new Date(e.at).toLocaleTimeString()} ${e.kind}: ${e.message.slice(0, 140)}`)
  ]
  return lines.filter(Boolean).join('\n')
}

switch (cmd) {
  case 'state':
    console.log(summary(await hearth.state()))
    break
  case 'say': {
    const text = args.filter((a) => a !== '--wait').join(' ')
    await hearth.say(text)
    if (args.includes('--wait')) {
      const s = await hearth.waitForReply()
      console.log(`reply: ${s.lastReply}`)
    }
    break
  }
  case 'page':
    await hearth.page(args[0])
    break
  case 'sensing':
    await hearth.sensing(args[0] === 'on')
    break
  case 'set': {
    const patch = Object.fromEntries(
      args.map((a) => {
        const [k, v] = a.split('=')
        return [k, v === 'true' ? true : v === 'false' ? false : v]
      })
    )
    console.log(JSON.stringify((await hearth.settings(patch)).settings))
    break
  }
  case 'dash':
    console.log(
      JSON.stringify(
        await hearth.dashboard({ bounds: { x: num(0), y: num(1), width: num(2), height: num(3) }, show: true })
      )
    )
    break
  case 'pill':
    console.log(JSON.stringify(await hearth.pill(num(0), num(1))))
    break
  case 'clearlog':
    await hearth.clearLog()
    break
  case 'move':
    await withInput((i) => i.move(num(0), num(1), args[2] ? num(2) : 700))
    break
  case 'click':
    await withInput((i) => i.click())
    break
  case 'drag':
    await withInput((i) => i.drag(num(0), num(1), args[2] ? num(2) : 1200))
    break
  case 'cue':
    await withInput((i) => i.cue(args.join(' ')))
    break
  case 'shot': {
    const file = join('build', `${args[0] ?? 'shot'}.png`)
    await screenshot(file)
    console.log(file)
    break
  }
  case 'rec': {
    const name = args[0]
    const stopFile = join(RAW_DIR, `${name}.stop`)
    if (existsSync(stopFile)) rmSync(stopFile)
    const rec = startRecording(name)
    console.log(`recording ${rec.out}`)
    while (!existsSync(stopFile)) await hearth.sleep(200)
    rmSync(stopFile)
    const meta = await rec.stop()
    console.log(`saved ${rec.out} (${((meta.stoppedAt - meta.firstFrameAt) / 1000).toFixed(1)} s)`)
    break
  }
  case 'stop':
    writeFileSync(join(RAW_DIR, `${args[0]}.stop`), '')
    break
  default:
    console.log('usage: see the top of tools/do.mjs')
}
