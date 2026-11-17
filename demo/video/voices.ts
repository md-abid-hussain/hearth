// The spoken lines in the product scenes, with their per-frame loudness for the face.
// h-*: Hearth's own voice (AssemblyAI text-to-speech, the app's voice), from tools/hearth-voice.mjs.
// u-*: the user (ElevenLabs, "Ibrahim - Talkative Friend"), levels from tools/levels.mjs.
import { levels as calendar } from './levels/h-calendar'
import { levels as checkinAlert } from './levels/h-checkin-alert'
import { levels as checkinOk } from './levels/h-checkin-ok'
import { levels as howami } from './levels/h-howami'
import { levels as mail } from './levels/h-mail'
import { levels as remindOk } from './levels/h-remind-ok'
import { levels as remindWater } from './levels/h-remind-water'
import { levels as slowdown } from './levels/h-slowdown'
import { levels as uCalendar } from './levels/u-calendar'
import { levels as uCheckin } from './levels/u-checkin'
import { levels as uHowami } from './levels/u-howami'
import { levels as uMail } from './levels/u-mail'
import { levels as uRemind } from './levels/u-remind'
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

export const YOU_LINES = {
  'u-howami': { text: 'Hearth, how am I doing?', levels: uHowami },
  'u-checkin': { text: 'Keep an eye on my breathing every minute.', levels: uCheckin },
  'u-remind': { text: 'Remind me to drink some water in one minute.', levels: uRemind },
  'u-calendar': { text: "What's on my calendar today?", levels: uCalendar },
  'u-mail': { text: 'Anything important in my email?', levels: uMail }
} as const

export type HearthLine = keyof typeof HEARTH_LINES
export type YouLine = keyof typeof YOU_LINES
type Line = HearthLine | YouLine

const levelsOf = (name: Line): readonly number[] =>
  (name in HEARTH_LINES ? HEARTH_LINES[name as HearthLine] : YOU_LINES[name as YouLine]).levels

export const lineSeconds = (name: Line): number => levelsOf(name).length / FPS

/**
 * A voice level for the face from several lines, each starting at its own time: Hearth's mouth
 * follows its own lines, and its listening ring follows yours.
 */
export function levelsFor(lines: [Line, number][]): (t: number) => number {
  return (t) => {
    for (const [name, at] of lines) {
      const v = levelsOf(name)[Math.round((t - at) * FPS)]
      if (v !== undefined) return v
    }
    return 0
  }
}
