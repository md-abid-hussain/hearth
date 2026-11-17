import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { HearthFace } from '../HearthFace'
import { levels, text } from '../levels/hearth-intro'
import { FPS, color, fonts, s } from '../theme'
import { Backdrop, Narration, Spoken } from '../ui'

/** When Hearth starts talking, in seconds into the scene. */
const SPEAK_AT = 4.4
/** Each word's start in the line, from the pauses in public/voice/hearth-intro.wav. */
const WORD_TIMES = [
  0, 0.25, 0.5,
  1.09, 1.28,
  1.82, 1.98, 2.14, 2.3, 2.46, 2.62, 2.78,
  3.26, 3.45, 3.64, 3.82, 4.01, 4.2, 4.39, 4.57
]
const SPEECH_END = SPEAK_AT + 4.76
const TITLE_AT = SPEECH_END + 0.5

/** Hearth's mouth and halo follow the real loudness of its voice, frame by frame. */
const voiceLevel = (t: number): number => levels[Math.round((t - SPEAK_AT) * FPS)] ?? 0

/**
 * Scenes 1 and 2 (13 s): Hearth wakes up on a dark screen, blinks, looks at you, hops, introduces
 * itself in its own voice (AssemblyAI's Kyla, as in the app) with a first nudge, then slides
 * aside for the wordmark.
 */
export function Opening(): React.JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const fadeIn = interpolate(frame, [0, s(0.9)], [0, 1], { extrapolateRight: 'clamp' })
  const toTitle = spring({ frame: frame - s(TITLE_AT), fps, config: { damping: 200 }, durationInFrames: s(0.9) })
  const size = interpolate(toTitle, [0, 1], [440, 250])
  const x = interpolate(toTitle, [0, 1], [960, 610])
  const y = interpolate(toTitle, [0, 1], [470, 520])
  const captionOut = interpolate(frame, [s(TITLE_AT - 0.2), s(TITLE_AT + 0.2)], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const word = spring({ frame: frame - s(TITLE_AT + 0.4), fps, config: { damping: 200 } })
  const tagline = spring({ frame: frame - s(TITLE_AT + 0.9), fps, config: { damping: 200 } })

  return (
    <AbsoluteFill>
      <Backdrop glow={0.06 + 0.03 * fadeIn} x={`${(x / 1920) * 100}%`} y={`${(y / 1080) * 100}%`} />
      <Narration file="hearth-intro" ext="wav" at={SPEAK_AT} volume={1.3} />
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
          level={voiceLevel}
          cues={[
            { at: 0, mood: 'idle' },
            { at: 1.3, gesture: 'blink' },
            { at: 2.1, gesture: 'glanceRight' },
            { at: 3.6, gesture: 'hop' },
            { at: SPEAK_AT, mood: 'speaking' },
            { at: SPEECH_END + 0.1, mood: 'idle', smile: true },
            { at: TITLE_AT + 1.9, gesture: 'hop' }
          ]}
        />
      </div>
      <div style={{ position: 'absolute', left: 300, right: 300, top: 760, textAlign: 'center', opacity: captionOut }}>
        <Spoken text={text} at={SPEAK_AT} times={WORD_TIMES} size={50} />
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
