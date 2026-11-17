import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { HearthFace } from '../HearthFace'
import { color, fonts, s } from '../theme'
import { Backdrop, Spoken } from '../ui'

/** Placeholder until a real line from the recording session replaces it. */
export const COLD_OPEN_LINE = "You've been at it for a while. Want to stand up and stretch for a minute?"

/**
 * Scene 1 and 2 (12 s): Hearth wakes up on a dark screen, blinks, looks at you, hops and says one
 * real nudge; then it slides aside for the wordmark.
 */
export function Opening({ line = COLD_OPEN_LINE }: { line?: string }): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const fadeIn = interpolate(frame, [0, s(0.9)], [0, 1], { extrapolateRight: 'clamp' })
  const toTitle = spring({ frame: frame - s(8.8), fps, config: { damping: 200 }, durationInFrames: s(0.9) })
  const size = interpolate(toTitle, [0, 1], [440, 250])
  const x = interpolate(toTitle, [0, 1], [960, 610])
  const y = interpolate(toTitle, [0, 1], [470, 520])
  const captionOut = interpolate(frame, [s(8.6), s(9.0)], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const word = spring({ frame: frame - s(9.2), fps, config: { damping: 200 } })
  const tagline = spring({ frame: frame - s(9.7), fps, config: { damping: 200 } })

  return (
    <AbsoluteFill>
      <Backdrop glow={0.06 + 0.03 * fadeIn} x={`${(x / 1920) * 100}%`} y={`${(y / 1080) * 100}%`} />
      <div
        style={{
          position: 'absolute',
          left: x - size / 2,
          top: y - size / 2,
          opacity: fadeIn,
          transform: `scale(${interpolate(fadeIn, [0, 1], [0.92, 1])})`
        }}
      >
        <HearthFace
          size={size}
          cues={[
            { at: 0, mood: 'idle' },
            { at: 1.3, gesture: 'blink' },
            { at: 2.1, gesture: 'glanceRight' },
            { at: 3.7, gesture: 'hop' },
            { at: 4.4, mood: 'speaking' },
            { at: 8.6, mood: 'idle', smile: true },
            { at: 10.6, gesture: 'hop' }
          ]}
        />
      </div>
      <div style={{ position: 'absolute', left: 360, right: 360, top: 760, textAlign: 'center', opacity: captionOut }}>
        <Spoken text={line} at={4.5} wps={3.4} size={50} />
      </div>
      <div style={{ position: 'absolute', left: 820, top: 395, opacity: word, transform: `translateX(${(1 - word) * 40}px)` }}>
        <div style={{ font: `600 168px ${fonts.sans}`, color: color.text, letterSpacing: -5, lineHeight: 1 }}>Hearth</div>
      </div>
      <div style={{ position: 'absolute', left: 828, top: 590, opacity: tagline, transform: `translateX(${(1 - tagline) * 30}px)` }}>
        <div style={{ font: `400 52px ${fonts.serifItalic}`, fontStyle: 'italic', color: color.muted }}>
          a small companion that notices
        </div>
      </div>
    </AbsoluteFill>
  )
}
