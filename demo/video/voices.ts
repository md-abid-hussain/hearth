// Hearth's own lines (AssemblyAI text-to-speech, the app's voice), made with
// tools/hearth-voice.mjs, with their per-frame loudness for lip sync.
import { levels as calendar } from './levels/h-calendar'
import { levels as checkinAlert } from './levels/h-checkin-alert'
import { levels as checkinOk } from './levels/h-checkin-ok'
import { levels as howami } from './levels/h-howami'
import { levels as mail } from './levels/h-mail'
import { levels as remindOk } from './levels/h-remind-ok'
import { levels as remindWater } from './levels/h-remind-water'
import { levels as slowdown } from './levels/h-slowdown'
import { FPS } from './theme'

export const HEARTH_LINES = {
  'h-slowdown': { text: 'Whoa! Slow down, buddy.', levels: slowdown },
  'h-howami': { text: 'You look calm. Your pulse is steady, and your breathing is slow and even.', levels: howami },
  'h-checkin-ok': { text: "Sure. Your breathing looks calm right now. I'll check again in a minute.", levels: checkinOk },
  'h-checkin-alert': { text: 'Your breathing has picked up a bit. Want to take three slow breaths with me?', levels: checkinAlert },
  'h-remind-ok': { text: "Okay. I'll remind you in a minute.", levels: remindOk },
  'h-remind-water': { text: "A little water might be nice right now, if you'd like.", levels: remindWater },
  'h-calendar': { text: 'You have a design review at three, and the gym at six thirty.', levels: calendar },
  'h-mail': { text: 'Your flight check-in is open, and invoice ten forty-two is due Friday.', levels: mail }
} as const

export type HearthLine = keyof typeof HEARTH_LINES

export const lineSeconds = (name: HearthLine): number => HEARTH_LINES[name].levels.length / FPS

/**
 * A voice level for the face from several lines, each starting at its own time: the mouth moves
 * with whichever line is playing.
 */
export function levelsFor(lines: [HearthLine, number][]): (t: number) => number {
  return (t) => {
    for (const [name, at] of lines) {
      const v = HEARTH_LINES[name].levels[Math.round((t - at) * FPS)]
      if (v !== undefined) return v
    }
    return 0
  }
}
