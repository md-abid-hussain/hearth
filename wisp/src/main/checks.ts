import type { CheckFocus } from '../shared/types'
import { hub } from './hub'
import { vitals } from './vitals'

/** Relaxed blinking is about 15 to 20 a minute; staring at a screen can halve it. */
const LOW_BLINKS_PER_MIN = 8
const FAST_BREATHING_PER_MIN = 20
const BREATHING_RISE_PER_MIN = 5
const PULSE_RISE_BPM = 15
const HIGH_PULSE_BPM = 100
const SIT_LIMIT_MIN = 50

export const FOCUS_LABEL: Record<CheckFocus, string> = {
  eyes: 'your eyes',
  breathing: 'your breathing',
  pulse: 'your pulse',
  overall: 'how you are doing'
}

/** Template lines for when the language model is unavailable. */
export const FOCUS_FALLBACK: Record<CheckFocus, string> = {
  eyes: "You've barely blinked for a while. Look at something far away for twenty seconds?",
  breathing: 'Your breathing has picked up. Want to take three slow breaths with me?',
  pulse: 'Your pulse is running higher than earlier. Maybe a short pause would help.',
  overall: 'Something looks a bit off right now. Maybe a short break?'
}

export type CheckStatus = 'ok' | 'concern' | 'warming' | 'no_signal'

export interface CheckResult {
  status: CheckStatus
  /** Plain facts for the spoken line and the log; numbers kept for the log only. */
  facts: string
}

const round = (x: number): number => Math.round(x)

function eyes(windowMs: number): CheckResult {
  if (!hub.settings.measureBlinks)
    return { status: 'no_signal', facts: 'blink detection is switched off in Privacy' }
  const blinks = vitals.average('blinks', windowMs)
  if (blinks == null) return { status: 'warming', facts: 'Blink rate is still settling.' }
  if (blinks < LOW_BLINKS_PER_MIN)
    return {
      status: 'concern',
      facts: `Blinking about ${round(blinks)} times a minute lately, well below the relaxed 15 or more, which usually means eyes are locked on the screen.`
    }
  return { status: 'ok', facts: `Blinking about ${round(blinks)} times a minute.` }
}

function breathing(windowMs: number): CheckResult {
  const now = vitals.average('breathing', windowMs)
  if (now == null) return { status: 'warming', facts: 'Breathing rate is still settling.' }
  const base = vitals.baseline('breathing')
  if (now >= FAST_BREATHING_PER_MIN || (base != null && now - base >= BREATHING_RISE_PER_MIN))
    return {
      status: 'concern',
      facts: `Breathing about ${round(now)} a minute lately${base != null ? `, up from about ${round(base)} earlier` : ', on the quick side'}.`
    }
  return { status: 'ok', facts: `Breathing about ${round(now)} a minute.` }
}

function pulse(windowMs: number): CheckResult {
  const now = vitals.average('pulse', windowMs)
  if (now == null) return { status: 'warming', facts: 'Pulse is still settling.' }
  const base = vitals.baseline('pulse')
  if (now >= HIGH_PULSE_BPM || (base != null && now - base >= PULSE_RISE_BPM))
    return {
      status: 'concern',
      facts: `Pulse about ${round(now)} lately${base != null ? `, up from about ${round(base)} earlier in the session` : ''}.`
    }
  return { status: 'ok', facts: `Pulse about ${round(now)}.` }
}

function sitting(): CheckResult {
  const since = hub.vitals.sittingSince
  const minutes = since ? (Date.now() - since) / 60_000 : 0
  return minutes >= SIT_LIMIT_MIN
    ? { status: 'concern', facts: `At the desk for ${round(minutes)} minutes without a break.` }
    : { status: 'ok', facts: `At the desk for ${round(minutes)} minutes.` }
}

/**
 * Reads one focus from the live signals. Averages cover the time since the last check, up to
 * five minutes, so one odd reading does not trigger anything.
 */
export function readCheck(focus: CheckFocus, everyMin: number): CheckResult {
  const v = hub.vitals
  if (!v.sensing) return { status: 'no_signal', facts: 'camera sensing is off' }
  if (!v.present) return { status: 'no_signal', facts: "the camera can't see you" }
  const windowMs = Math.min(Math.max(everyMin, 2), 5) * 60_000
  if (focus === 'eyes') return eyes(windowMs)
  if (focus === 'breathing') return breathing(windowMs)
  if (focus === 'pulse') return pulse(windowMs)

  const parts = [
    ...(hub.settings.measureBlinks ? [eyes(windowMs)] : []),
    breathing(windowMs),
    pulse(windowMs),
    sitting()
  ]
  const concerns = parts.filter((p) => p.status === 'concern')
  if (concerns.length) return { status: 'concern', facts: concerns.map((p) => p.facts).join(' ') }
  const read = parts.filter((p) => p.status === 'ok')
  // Sitting time is always known, so it alone does not count as a reading.
  if (read.length <= 1) return { status: 'warming', facts: 'Signals are still settling.' }
  return { status: 'ok', facts: read.map((p) => p.facts).join(' ') }
}
