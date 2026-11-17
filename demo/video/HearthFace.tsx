import { useId } from 'react'
import { Easing, interpolate, interpolateColors, useCurrentFrame } from 'remotion'
import { FPS, fonts } from './theme'

/**
 * Hearth's face from the app (wisp/src/renderer/src/components/Orb.tsx and the .face styles in
 * tokens.css), rebuilt to be driven by the video frame instead of timers, so every render is the
 * same. Geometry, mood colors and gesture keyframes match the app.
 */

export type Mood = 'idle' | 'listening' | 'thinking' | 'speaking' | 'sleeping'
export type Gesture = 'blink' | 'glanceLeft' | 'glanceRight' | 'lookUp' | 'hop' | 'tilt' | 'wiggle'

/** A change at `at` seconds into the sequence: a new mood, a one-off gesture, or a smile. */
export interface Cue {
  at: number
  mood?: Mood
  gesture?: Gesture
  smile?: boolean
  /** Dizzy after being shaken: > < eyes, flushed cheeks, a double wobble. */
  dizzy?: boolean
}

const MOOD_COLORS: Record<Mood, { face: string; halo: string }> = {
  idle: { face: '#f0a43a', halo: '#f0a43a' },
  listening: { face: '#45c08a', halo: '#45c08a' },
  thinking: { face: '#8f86f5', halo: '#b9b2ff' },
  speaking: { face: '#f5b041', halo: '#ffcf73' },
  sleeping: { face: '#6b665f', halo: '#6b665f' }
}

const GESTURE_SECONDS: Record<Gesture, number> = {
  blink: 0.15,
  glanceLeft: 1.3,
  glanceRight: 1.3,
  lookUp: 1.1,
  hop: 0.65,
  tilt: 1.0,
  wiggle: 0.7
}

const INK = '#161310'
const COLOR_FADE = 0.42
const EYE_EASE = 0.26
const springy = Easing.bezier(0.3, 1.5, 0.5, 1)
const settle = Easing.bezier(0.3, 1.3, 0.5, 1)
const smooth = Easing.inOut(Easing.ease)

/** Keyframed value: `stops` are [progress 0..1, value] pairs, each segment eased. */
function keyframes(p: number, stops: [number, number][], easing = smooth): number {
  return interpolate(
    p,
    stops.map(([t]) => t),
    stops.map(([, v]) => v),
    { easing, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )
}

/** 0 → 1 over the eye transition, with the app's slight overshoot. */
const rise = (x: number): number =>
  interpolate(x, [0, EYE_EASE], [0, 1], { easing: settle, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

function latest<T>(cues: Cue[], t: number, pick: (c: Cue) => T | undefined): { value: T; at: number } | null {
  let found: { value: T; at: number } | null = null
  for (const c of cues) {
    const v = pick(c)
    if (v !== undefined && c.at <= t) found = { value: v, at: c.at }
  }
  return found
}

/** A voice-like level when no real audio drives the face: syllables inside phrases. */
export function speechLevel(t: number): number {
  const syllables = Math.abs(Math.sin(t * 10.5)) * 0.75 + Math.abs(Math.sin(t * 6.3 + 1)) * 0.25
  const phrase = 0.55 + 0.45 * Math.sin(t * 1.7)
  return Math.max(0, Math.min(1, syllables * phrase))
}

interface Props {
  cues: Cue[]
  size: number
  /** Voice level 0..1 at time t (seconds); defaults to a speech-like pattern. */
  level?: (t: number) => number
  /** Breaths per minute for the idle swell, like the app does with your measured breathing. */
  breathing?: number
  /** Seconds to offset the face's own clock, so several faces don't move in lockstep. */
  offset?: number
}

export function HearthFace({ cues, size, level = speechLevel, breathing = 12, offset = 0 }: Props): React.JSX.Element {
  const frame = useCurrentFrame()
  const t = frame / FPS + offset
  const id = useId().replace(/:/g, '')

  const moodNow = latest(cues, t, (c) => c.mood) ?? { value: 'idle' as Mood, at: -10 }
  const mood = moodNow.value
  const moodBefore = latest(
    cues.filter((c) => c.at < moodNow.at),
    t,
    (c) => c.mood
  )?.value ?? mood
  const sinceMood = t - moodNow.at
  const fade = Math.min(1, sinceMood / COLOR_FADE)
  const faceColor = interpolateColors(fade, [0, 1], [MOOD_COLORS[moodBefore].face, MOOD_COLORS[mood].face])
  const haloColor = interpolateColors(fade, [0, 1], [MOOD_COLORS[moodBefore].halo, MOOD_COLORS[mood].halo])

  const gestureCue = latest(cues, t, (c) => c.gesture)
  const gesture =
    gestureCue && t < gestureCue.at + GESTURE_SECONDS[gestureCue.value] + EYE_EASE ? gestureCue : null
  const gp = gesture ? (t - gesture.at) / GESTURE_SECONDS[gesture.value] : 0
  const inGesture = gesture != null && gp <= 1
  // Eye moves ease in at the start and back after the gesture ends, as the CSS transition does.
  const eyeAmount = gesture ? rise(t - gesture.at) - rise(t - gesture.at - GESTURE_SECONDS[gesture.value]) : 0

  const smileCue = latest(cues, t, (c) => c.smile)
  const dizzyCue = latest(cues, t, (c) => c.dizzy)
  const dizzy = dizzyCue?.value === true && mood !== 'sleeping'
  const smiling = mood === 'speaking' || (mood === 'idle' && smileCue?.value === true)
  const blinking = inGesture && gesture?.value === 'blink' && mood !== 'sleeping'
  const eyes =
    mood === 'sleeping' ? 'closed' : dizzy ? 'dizzy' : smiling ? 'happy' : blinking ? 'blink' : 'open'

  const lvl = mood === 'speaking' || mood === 'listening' ? level(t) : 0
  const swell = mood === 'idle' || mood === 'sleeping' ? Math.sin(t * Math.PI * 2 * (breathing / 60)) : 0
  const bodyScale = 1 + swell * 0.035 + lvl * 0.05

  // Eyes: mood offsets (listening widens, thinking looks up) plus gesture offsets.
  const moodEyes = rise(sinceMood)
  let eyeX = 0
  let eyeY = 0
  let eyeScale = 1
  if (mood === 'listening') eyeScale = 1 + 0.12 * moodEyes
  if (mood === 'thinking') {
    eyeX += 4 * moodEyes
    eyeY += -6 * moodEyes
  }
  if (gesture?.value === 'glanceLeft') eyeX += -7 * eyeAmount
  if (gesture?.value === 'glanceRight') eyeX += 7 * eyeAmount
  if (gesture?.value === 'glanceLeft' || gesture?.value === 'glanceRight') eyeY += 1 * eyeAmount
  if (gesture?.value === 'lookUp') {
    eyeX += 4 * eyeAmount
    eyeY += -6 * eyeAmount
  }

  // The whole face: hop, tilt, wiggle, and the thinking bob.
  let floatY = 0
  let floatSX = 1
  let floatSY = 1
  let floatRot = 0
  let shadowSX = 1
  let shadowSY = 1
  let shadowOpacity = mood === 'sleeping' ? 0.2 : 0.34
  if (inGesture && gesture?.value === 'hop') {
    floatY = keyframes(gp, [[0, 0], [0.3, -16], [0.6, 0], [1, 0]], springy)
    floatSX = keyframes(gp, [[0, 1], [0.3, 0.96], [0.6, 1.05], [1, 1]], springy)
    floatSY = keyframes(gp, [[0, 1], [0.3, 1.05], [0.6, 0.95], [1, 1]], springy)
    shadowSX = keyframes(gp, [[0, 1], [0.3, 0.7], [1, 1]], springy)
    shadowSY = keyframes(gp, [[0, 1], [0.3, 0.8], [1, 1]], springy)
    shadowOpacity = keyframes(gp, [[0, 0.34], [0.3, 0.18], [1, 0.34]], springy)
  }
  if (inGesture && gesture?.value === 'tilt') floatRot = keyframes(gp, [[0, 0], [0.35, -11], [0.7, 6], [1, 0]])
  if (inGesture && gesture?.value === 'wiggle')
    floatRot = keyframes(gp, [[0, 0], [0.2, -7], [0.45, 6], [0.7, -3], [1, 0]])
  if (mood === 'thinking') floatY += keyframes((t % 1.3) / 1.3, [[0, 0], [0.5, -4], [1, 0]])
  if (dizzy && dizzyCue && t - dizzyCue.at < 1.2)
    floatRot = keyframes(((t - dizzyCue.at) % 0.6) / 0.6, [[0, 0], [0.2, -7], [0.45, 6], [0.7, -3], [1, 0]])

  // Halo: pumps with the voice while listening or speaking, dashed and spinning while thinking.
  let haloOpacity = 0
  let haloScale = 1
  if (mood === 'listening' || mood === 'speaking') {
    haloOpacity = 0.12 + lvl * 0.88
    haloScale = 0.9 + lvl * 0.22
  }
  if (mood === 'thinking') haloOpacity = 0.85
  haloOpacity *= Math.min(1, sinceMood / 0.3)
  const spin = ((t % 1.8) / 1.8) * 360
  const orbit = ((t % 1.4) / 1.4) * 360

  const zP = (t % 2.6) / 2.6
  const zOpacity = keyframes(zP, [[0, 0], [0.3, 1], [1, 0]])

  const floatTransform = `translate(50 90) translate(0 ${floatY}) rotate(${floatRot}) scale(${floatSX} ${floatSY}) translate(-50 -90)`
  const eyeTransform = `translate(50 46) translate(${eyeX} ${eyeY}) scale(${eyeScale}) translate(-50 -46)`

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: 'visible' }}>
      <defs>
        <radialGradient id={`shade-${id}`} cx="38%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.42" />
          <stop offset="40%" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="78%" stopColor="#000" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.32" />
        </radialGradient>
        <filter id={`soft-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <ellipse
        cx="50"
        cy="95"
        rx="25"
        ry="3.8"
        fill="#000"
        opacity={shadowOpacity}
        filter={`url(#soft-${id})`}
        transform={`translate(50 95) scale(${shadowSX} ${shadowSY}) translate(-50 -95)`}
      />
      <g transform={floatTransform}>
        <circle
          cx="50"
          cy="50"
          r="47"
          fill="none"
          stroke={haloColor}
          strokeWidth="3.5"
          opacity={haloOpacity}
          strokeDasharray={mood === 'thinking' ? '22 14' : undefined}
          transform={
            mood === 'thinking'
              ? `rotate(${spin} 50 50)`
              : `translate(50 50) scale(${haloScale}) translate(-50 -50)`
          }
        />
        {mood === 'thinking' && (
          <g fill="#e4e0ff" transform={`rotate(${orbit} 50 50)`} opacity={Math.min(1, sinceMood / 0.3)}>
            <circle cx="50" cy="4" r="3.4" />
            <circle cx="90" cy="68" r="2.6" />
            <circle cx="12" cy="70" r="2" />
          </g>
        )}
        <g transform={`translate(50 50) scale(${bodyScale}) translate(-50 -50)`}>
          <circle cx="50" cy="50" r="40" fill={faceColor} />
          <circle cx="50" cy="50" r="40" fill={`url(#shade-${id})`} />
          <ellipse
            cx="36"
            cy="27"
            rx="10"
            ry="5.5"
            fill="#fff"
            opacity="0.55"
            transform="rotate(-28 36 27)"
            filter={`url(#soft-${id})`}
          />
          <circle cx="50" cy="50" r="39.3" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2" />
          {(smiling || dizzy) && (
            <g fill="#ff7a59" opacity={dizzy ? 0.6 : 0.35}>
              <ellipse cx="29" cy="61" rx="6" ry="3.6" />
              <ellipse cx="71" cy="61" rx="6" ry="3.6" />
            </g>
          )}
          <g transform={eyeTransform}>
            {eyes === 'open' && (
              <g fill={INK}>
                <rect x="33" y="38" width="9" height="16" rx="4.5" />
                <rect x="58" y="38" width="9" height="16" rx="4.5" />
              </g>
            )}
            {eyes === 'blink' && (
              <g fill={INK}>
                <rect x="33" y="45" width="9" height="2.6" rx="1.3" />
                <rect x="58" y="45" width="9" height="2.6" rx="1.3" />
              </g>
            )}
            {eyes === 'dizzy' && (
              <g fill="none" stroke={INK} strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M33 40 L41 46 L33 52" />
                <path d="M67 40 L59 46 L67 52" />
              </g>
            )}
            {(eyes === 'happy' || eyes === 'closed') && (
              <g fill="none" stroke={INK} strokeWidth="4.2" strokeLinecap="round">
                <path d={eyes === 'happy' ? 'M32 49 Q37.5 41 43 49' : 'M32 46 Q37.5 52 43 46'} />
                <path d={eyes === 'happy' ? 'M57 49 Q62.5 41 68 49' : 'M57 46 Q62.5 52 68 46'} />
              </g>
            )}
          </g>
          {mood === 'speaking' && (
            <ellipse
              cx="50"
              cy="66"
              rx="6.5"
              ry="5"
              fill={INK}
              transform={`translate(50 66) scale(1 ${0.25 + lvl * 1.5}) translate(-50 -66)`}
            />
          )}
          {mood === 'idle' && smiling && (
            <path d="M42 63 Q50 70 58 63" fill="none" stroke={INK} strokeWidth="4.2" strokeLinecap="round" />
          )}
        </g>
      </g>
      {mood === 'sleeping' && (
        <text
          x="76"
          y="24"
          fill="#a19b90"
          opacity={zOpacity}
          transform={`translate(${zP * 8} ${6 - zP * 20})`}
          style={{ font: `700 18px ${fonts.sans}` }}
        >
          z
        </text>
      )}
    </svg>
  )
}
