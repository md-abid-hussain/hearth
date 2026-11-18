import type { Settings } from './types'

/** The camera readings Hearth can ask SmartSpectra for. At least one stays on. */
export const READINGS = [
  { key: 'measurePulse', label: 'Pulse', help: 'heart rate from the colour changes in your skin' },
  { key: 'measureBreathing', label: 'Breathing', help: 'breaths a minute from chest movement' },
  {
    key: 'measureHrv',
    label: 'Heart rate variability',
    help: 'beat-to-beat variation; needs a still, quiet minute'
  },
  {
    key: 'measureBlinks',
    label: 'Blinks and talking',
    help: 'blink rate, and pausing breathing readings while you speak'
  },
  {
    key: 'measureExpressions',
    label: 'Facial expressions',
    help: 'off by default; estimates stay on this computer and never go to the language model'
  }
] as const satisfies readonly { key: keyof Settings; label: string; help: string }[]

export type ReadingKey = (typeof READINGS)[number]['key']

/** The readings switched on in these settings. */
export const readingsOn = (settings: Settings): ReadingKey[] =>
  READINGS.map((r) => r.key).filter((key) => settings[key])

export const KEEP_ONE_READING =
  'Keep at least one reading on. To stop using the camera, press Stop sensing instead.'
