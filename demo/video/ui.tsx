import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { color, fonts, s } from './theme'

/** The app's dark canvas with a faint warm glow, optionally centered somewhere else. */
export function Backdrop({ glow = 0.07, x = '50%', y = '46%' }: { glow?: number; x?: string; y?: string }): React.JSX.Element {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1100px 760px at ${x} ${y}, rgba(240,164,58,${glow}), transparent 70%), ${color.bg}`
      }}
    />
  )
}

/** Fades and lifts its children in at `at` seconds, and out at `until` if given. */
export function Appear({
  at = 0,
  until,
  rise = 24,
  children,
  style
}: {
  at?: number
  until?: number
  rise?: number
  children: ReactNode
  style?: CSSProperties
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({ frame: frame - s(at), fps, config: { damping: 200 }, durationInFrames: s(0.6) })
  const exit = until == null ? 0 : interpolate(frame, [s(until), s(until + 0.4)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <div style={{ opacity: enter * (1 - exit), transform: `translateY(${(1 - enter) * rise - exit * 10}px)`, ...style }}>
      {children}
    </div>
  )
}

/** A mono label in a rounded pill, like the tags on Hearth's consent screen. */
export function Chip({ children, tone = 'plain', style }: { children: ReactNode; tone?: 'plain' | 'amber' | 'green' | 'violet'; style?: CSSProperties }): React.JSX.Element {
  const tones = {
    plain: { fg: color.muted, bg: color.surface2, line: color.lineStrong },
    amber: { fg: color.amber, bg: 'rgba(240,164,58,0.12)', line: 'rgba(240,164,58,0.45)' },
    green: { fg: color.green, bg: color.greenSoft, line: 'rgba(63,178,127,0.45)' },
    violet: { fg: '#b9b2ff', bg: 'rgba(143,134,245,0.14)', line: 'rgba(143,134,245,0.45)' }
  }[tone]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 18px',
        borderRadius: 999,
        border: `1.5px solid ${tones.line}`,
        background: tones.bg,
        color: tones.fg,
        font: `500 26px ${fonts.mono}`,
        letterSpacing: 0.5,
        ...style
      }}
    >
      {children}
    </span>
  )
}

/** Big interface text. */
export function Headline({ children, size = 84, style }: { children: ReactNode; size?: number; style?: CSSProperties }): React.JSX.Element {
  return (
    <div style={{ font: `600 ${size}px ${fonts.sans}`, color: color.text, letterSpacing: -1.5, lineHeight: 1.05, ...style }}>
      {children}
    </div>
  )
}

/** Hearth's own words: serif, revealed word by word from `at` at `wps` words a second. */
export function Spoken({
  text,
  at = 0,
  wps = 2.6,
  size = 46,
  style
}: {
  text: string
  at?: number
  wps?: number
  size?: number
  style?: CSSProperties
}): React.JSX.Element {
  const frame = useCurrentFrame()
  const shown = Math.max(0, (frame - s(at)) / s(1 / wps))
  const words = text.split(' ')
  return (
    <div style={{ font: `400 ${size}px ${fonts.serif}`, color: color.text, lineHeight: 1.35, ...style }}>
      {words.map((w, i) => (
        <span key={i} style={{ opacity: interpolate(shown - i, [0, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          {w}{' '}
        </span>
      ))}
    </div>
  )
}

/** Small mono text, for numbers and eyebrows. */
export function Mono({ children, size = 26, tone = color.muted, style }: { children: ReactNode; size?: number; tone?: string; style?: CSSProperties }): React.JSX.Element {
  return <span style={{ font: `500 ${size}px ${fonts.mono}`, color: tone, ...style }}>{children}</span>
}

/** 0..1 progress of a spring that starts at `at` seconds. */
export function useEnter(at: number, damping = 200): number {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - s(at), fps, config: { damping } })
}
