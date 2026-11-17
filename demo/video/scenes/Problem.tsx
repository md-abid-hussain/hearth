import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { HearthFace } from '../HearthFace'
import { FPS, color, fonts, s } from '../theme'
import { Appear, Backdrop, Headline, Mono, Spoken } from '../ui'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** An eye that blinks; each blink in `blinks` (seconds) closes it for a moment. */
function Eye({ blinks }: { blinks: number[] }): React.JSX.Element {
  const t = useCurrentFrame() / FPS
  const closed = blinks.some((b) => t >= b && t < b + 0.16)
  return (
    <svg width="220" height="140" viewBox="0 0 220 140">
      <path
        d={closed ? 'M20 70 Q110 86 200 70' : 'M20 70 Q110 -10 200 70 Q110 150 20 70 Z'}
        fill={closed ? 'none' : color.surface2}
        stroke={color.text}
        strokeWidth="6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {!closed && <circle cx="110" cy="70" r="26" fill={color.amber} />}
      {!closed && <circle cx="110" cy="70" r="11" fill={color.bg} />}
    </svg>
  )
}

/** A breathing trace drawn left to right: slow and deep, turning quick and shallow. */
function Breath({ from }: { from: number }): React.JSX.Element {
  const t = useCurrentFrame() / FPS
  const drawn = interpolate(t, [from, from + 2.6], [0, 1], clamp)
  const points: string[] = []
  for (let i = 0; i <= 200; i++) {
    const x = i / 200
    const amp = interpolate(x, [0, 0.4, 1], [44, 40, 10])
    const freq = interpolate(x, [0, 0.4, 1], [1.4, 1.6, 6.5])
    const phase = x * freq * Math.PI * 2 * 1.6
    points.push(`${(x * 300).toFixed(1)},${(70 - Math.sin(phase) * amp).toFixed(1)}`)
  }
  return (
    <svg width="300" height="140" viewBox="0 0 300 140">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color.green}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1"
        strokeDashoffset={1 - drawn}
      />
    </svg>
  )
}

/** A sitting timer racing up from zero. */
function SitTimer({ from }: { from: number }): React.JSX.Element {
  const t = useCurrentFrame() / FPS
  const minutes = Math.floor(interpolate(t, [from, from + 2.4], [0, 161], { ...clamp, easing: (x) => 1 - (1 - x) ** 2 }))
  const label = `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
  return (
    <div style={{ height: 140, display: 'flex', alignItems: 'center' }}>
      <Mono size={84} tone={color.text}>{label}</Mono>
    </div>
  )
}

function Card({ at, title, children }: { at: number; title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Appear at={at} rise={40}>
      <div
        style={{
          width: 470,
          height: 380,
          borderRadius: 28,
          background: color.surface,
          border: `1.5px solid ${color.line}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 40
        }}
      >
        {children}
        <Headline size={52}>{title}</Headline>
      </div>
    </Appear>
  )
}

/**
 * Scene 3 (18 s): the workday at a screen; blinking less, shallow breathing, hours without moving;
 * the laptop camera; and Hearth popping up from it.
 */
export function Problem(): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps

  const hour = Math.floor(interpolate(t, [0.5, 2.8], [9, 18], clamp))
  const clockOut = interpolate(t, [2.9, 3.3], [1, 0], clamp)
  const cardsOut = interpolate(t, [10.8, 11.3], [1, 0], clamp)
  const laptop = spring({ frame: frame - s(11.2), fps, config: { damping: 200 } })
  const cam = interpolate(t, [12.0, 12.4], [0, 1], clamp)
  const pop = spring({ frame: frame - s(13.4), fps, config: { damping: 11, mass: 0.7 } })

  return (
    <AbsoluteFill>
      <Backdrop glow={0.05} />

      {t < 3.4 && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: clockOut }}>
          <Appear at={0.1}>
            <div style={{ textAlign: 'center' }}>
              <Mono size={30} tone={color.faint}>A WORKDAY</Mono>
              <div style={{ font: `500 220px ${fonts.mono}`, color: color.text, letterSpacing: -6, lineHeight: 1.1 }}>
                {String(hour).padStart(2, '0')}:00
              </div>
              <Headline size={64} style={{ color: color.muted }}>at a screen</Headline>
            </div>
          </Appear>
        </AbsoluteFill>
      )}

      {t >= 3.0 && t < 11.4 && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: cardsOut }}>
          <div style={{ display: 'flex', gap: 48 }}>
            <Card at={3.0} title="blink less">
              <Eye blinks={[3.6, 4.4, 5.8, 8.0, 10.6]} />
            </Card>
            <Card at={5.5} title="breathe shallow">
              <Breath from={5.7} />
            </Card>
            <Card at={8.0} title="forget to move">
              <SitTimer from={8.2} />
            </Card>
          </div>
        </AbsoluteFill>
      )}

      {t >= 11.0 && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', width: 980, height: 640, opacity: laptop, transform: `translateY(${(1 - laptop) * 40}px)` }}>
            <div
              style={{
                position: 'absolute',
                left: 90,
                top: 0,
                width: 800,
                height: 520,
                borderRadius: 28,
                border: `6px solid ${color.lineStrong}`,
                background: color.surface
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 530,
                width: 980,
                height: 34,
                borderRadius: '0 0 30px 30px',
                background: color.lineStrong
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 490 - 9,
                top: 16,
                width: 18,
                height: 18,
                borderRadius: 9,
                background: color.green,
                opacity: cam,
                boxShadow: `0 0 ${20 + 14 * Math.sin(t * 5)}px ${color.green}`
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 490 - 140,
                top: 120,
                transform: `translateY(${(1 - pop) * -90}px) scale(${pop})`,
                transformOrigin: '140px -90px'
              }}
            >
              <HearthFace
                size={280}
                cues={[
                  { at: 0, mood: 'idle' },
                  { at: 14.4, gesture: 'blink' },
                  { at: 15.0, smile: true },
                  { at: 15.9, gesture: 'hop' }
                ]}
              />
            </div>
          </div>
        </AbsoluteFill>
      )}

      {t >= 13.4 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 930, textAlign: 'center' }}>
          <Spoken text="What if it could notice, and look after you, kindly?" at={13.6} wps={3} size={46} />
        </div>
      )}
    </AbsoluteFill>
  )
}
