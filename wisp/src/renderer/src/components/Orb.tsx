import { useEffect, useRef, useState } from 'react'
import type { HearthMood } from '@shared/types'
import { mic } from '../lib/mic'
import { player } from '../lib/player'

/** What the face is showing beyond its mood: a problem, or dizziness after being shaken. */
export type FaceAlert = 'none' | 'problem' | 'dizzy'

type IdleAction = 'blink' | 'glanceLeft' | 'glanceRight' | 'lookUp' | 'hop' | 'tilt' | 'wiggle'

interface Props {
  mood: HearthMood
  /** Breaths per minute; the idle face swells in time with the user. */
  breathing: number | null
  size?: number
  alert?: FaceAlert
  /** The user's expression from SmartSpectra, when they switched expressions on. */
  expression?: string | null
}

const IDLE_ACTIONS: [IdleAction, number, number][] = [
  // action, weight, duration in ms
  ['blink', 40, 150],
  ['glanceLeft', 12, 1300],
  ['glanceRight', 12, 1300],
  ['lookUp', 8, 1100],
  ['hop', 12, 650],
  ['tilt', 8, 1000],
  ['wiggle', 8, 700]
]

function pickAction(reduced: boolean): [IdleAction, number] {
  const options = reduced
    ? IDLE_ACTIONS.filter(([a]) => a === 'blink' || a.startsWith('glance'))
    : IDLE_ACTIONS
  let roll = Math.random() * options.reduce((sum, [, w]) => sum + w, 0)
  for (const [action, weight, ms] of options) {
    roll -= weight
    if (roll <= 0) return [action, ms]
  }
  return ['blink', 150]
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Hearth's face. Each mood has its own look: idle breathes with you and now and then blinks,
 * glances, hops or tilts; listening opens its eyes wide with a ring that follows your voice;
 * thinking looks up while dots circle; speaking squints happily and its mouth follows the
 * audio; sleeping closes its eyes. A problem tints it red.
 */
export function Orb({
  mood,
  breathing,
  size = 44,
  alert = 'none',
  expression = null
}: Props): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef({ mood, breathing })
  latest.current = { mood, breathing }
  const [action, setAction] = useState<IdleAction | null>(null)

  // Voice level and breathing drive CSS variables directly, without re-rendering React.
  useEffect(() => {
    let frame = 0
    let level = 0
    const tick = (time: number): void => {
      const { mood: m, breathing: b } = latest.current
      const target = m === 'speaking' ? player.level() : m === 'listening' ? mic.level : 0
      level += (Math.min(1, target * 2.2) - level) * 0.3
      const bpm = b && b > 4 && b < 40 ? b : 12
      const breath =
        m === 'idle' || m === 'sleeping' ? Math.sin((time / 1000) * Math.PI * 2 * (bpm / 60)) : 0
      const el = root.current
      if (el) {
        el.style.setProperty('--level', level.toFixed(3))
        el.style.setProperty('--breath', (1 + breath * 0.035).toFixed(4))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  // Small gestures at random moments, plus ordinary blinks while listening or thinking.
  useEffect(() => {
    if (mood === 'sleeping' || mood === 'speaking') return undefined
    let timer: ReturnType<typeof setTimeout>
    const schedule = (): void => {
      const wait = mood === 'idle' ? 2_500 + Math.random() * 5_000 : 3_000 + Math.random() * 3_000
      timer = setTimeout(() => {
        const [next, ms] = mood === 'idle' ? pickAction(reducedMotion()) : (['blink', 150] as const)
        setAction(next)
        timer = setTimeout(() => {
          setAction(null)
          schedule()
        }, ms)
      }, wait)
    }
    schedule()
    return () => {
      clearTimeout(timer)
      setAction(null)
    }
  }, [mood])

  const dizzy = alert === 'dizzy' && mood !== 'sleeping'
  const smiling = mood === 'speaking' || (mood === 'idle' && expression === 'happy')
  const eyes =
    mood === 'sleeping'
      ? 'closed'
      : dizzy
        ? 'dizzy'
        : smiling
          ? 'happy'
          : action === 'blink'
            ? 'blink'
            : 'open'
  const classes = [
    'face',
    `mood-${mood}`,
    alert === 'problem' ? 'problem' : '',
    dizzy ? 'dizzy' : '',
    action && !dizzy ? `act-${action}` : ''
  ]

  return (
    <div
      ref={root}
      className={classes.filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Hearth is ${mood}`}
    >
      <svg viewBox="0 0 100 100" aria-hidden>
        <defs>
          {/* Light from the upper left: a bright cap fading to a darker lower edge. */}
          <radialGradient id="face-shade" cx="38%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.42" />
            <stop offset="40%" stopColor="#fff" stopOpacity="0.08" />
            <stop offset="78%" stopColor="#000" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.32" />
          </radialGradient>
          <filter id="face-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>
        {/* A soft shadow on the "desk" under the face; it stays put when the face hops. */}
        <ellipse
          className="face-shadow"
          cx="50"
          cy="95"
          rx="25"
          ry="3.8"
          filter="url(#face-soft)"
        />
        <g className="face-float">
          <circle className="face-halo" cx="50" cy="50" r="47" />
          {mood === 'thinking' && (
            <g className="face-orbit">
              <circle cx="50" cy="4" r="3.4" />
              <circle cx="90" cy="68" r="2.6" />
              <circle cx="12" cy="70" r="2" />
            </g>
          )}
          <g className="face-body">
            <circle className="face-fill" cx="50" cy="50" r="40" />
            <circle cx="50" cy="50" r="40" fill="url(#face-shade)" />
            <ellipse
              className="face-gloss"
              cx="36"
              cy="27"
              rx="10"
              ry="5.5"
              transform="rotate(-28 36 27)"
              filter="url(#face-soft)"
            />
            <circle className="face-rim" cx="50" cy="50" r="39.3" />
            {(smiling || dizzy) && (
              <g className="face-cheeks">
                <ellipse cx="29" cy="61" rx="6" ry="3.6" />
                <ellipse cx="71" cy="61" rx="6" ry="3.6" />
              </g>
            )}
            <g className="face-eyes">
              {eyes === 'open' && (
                <>
                  <rect className="eye" x="33" y="38" width="9" height="16" rx="4.5" />
                  <rect className="eye" x="58" y="38" width="9" height="16" rx="4.5" />
                </>
              )}
              {eyes === 'blink' && (
                <>
                  <rect className="eye" x="33" y="45" width="9" height="2.6" rx="1.3" />
                  <rect className="eye" x="58" y="45" width="9" height="2.6" rx="1.3" />
                </>
              )}
              {eyes === 'happy' && (
                <>
                  <path className="eye-line" d="M32 49 Q37.5 41 43 49" />
                  <path className="eye-line" d="M57 49 Q62.5 41 68 49" />
                </>
              )}
              {eyes === 'dizzy' && (
                <>
                  <path className="eye-line" d="M33 40 L41 46 L33 52" />
                  <path className="eye-line" d="M67 40 L59 46 L67 52" />
                </>
              )}
              {eyes === 'closed' && (
                <>
                  <path className="eye-line" d="M32 46 Q37.5 52 43 46" />
                  <path className="eye-line" d="M57 46 Q62.5 52 68 46" />
                </>
              )}
            </g>
            {mood === 'speaking' && (
              <ellipse className="face-mouth" cx="50" cy="66" rx="6.5" ry="5" />
            )}
            {mood === 'idle' && smiling && <path className="eye-line" d="M42 63 Q50 70 58 63" />}
          </g>
        </g>
        {mood === 'sleeping' && (
          <text className="face-z" x="76" y="24">
            z
          </text>
        )}
      </svg>
    </div>
  )
}
