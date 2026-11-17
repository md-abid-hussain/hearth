import { AbsoluteFill, interpolate, interpolateColors, useCurrentFrame } from 'remotion'
import { type Cue, HearthFace, type Mood } from '../HearthFace'
import { FPS, color, fonts } from '../theme'
import { Appear, Backdrop, Mono } from '../ui'

const MOODS: { mood: Mood; from: number; name: string; detail: string; dot: string }[] = [
  { mood: 'idle', from: 0, name: 'idle', detail: 'blinks, glances, hops', dot: '#f0a43a' },
  { mood: 'listening', from: 5.4, name: 'listening', detail: 'a ring follows your voice', dot: '#45c08a' },
  { mood: 'thinking', from: 8.0, name: 'thinking', detail: 'looks up while dots circle', dot: '#8f86f5' },
  { mood: 'speaking', from: 10.6, name: 'speaking', detail: 'its mouth follows its voice', dot: '#f5b041' },
  { mood: 'sleeping', from: 13.2, name: 'asleep', detail: 'dozes off when left alone', dot: '#6b665f' }
]

const CUES: Cue[] = [
  { at: 0, mood: 'idle' },
  { at: 0.7, gesture: 'blink' },
  { at: 1.4, gesture: 'glanceLeft' },
  { at: 2.9, gesture: 'glanceRight' },
  { at: 4.2, gesture: 'hop' },
  ...MOODS.slice(1).map((m) => ({ at: m.from, mood: m.mood })),
  { at: 7.0, gesture: 'blink' }
]

/** Scene 4a (16 s): one big Hearth going through each mood, with the list of moods beside it. */
export function MeetHearth(): React.JSX.Element {
  const t = useCurrentFrame() / FPS
  return (
    <AbsoluteFill>
      <Backdrop glow={0.06} x="36%" />
      <div style={{ position: 'absolute', left: 470, top: 300 }}>
        <Appear at={0}>
          <HearthFace size={440} cues={CUES} />
        </Appear>
      </div>
      <div style={{ position: 'absolute', left: 1100, top: 250, display: 'flex', flexDirection: 'column', gap: 34 }}>
        {MOODS.map((m, i) => {
          const next = MOODS[i + 1]?.from ?? 99
          const on = interpolate(t, [m.from, m.from + 0.3, next, next + 0.3], [0, 1, 1, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
          })
          return (
            <Appear key={m.mood} at={0.3 + i * 0.12}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    background: m.dot,
                    opacity: 0.35 + on * 0.65,
                    transform: `scale(${1 + on * 0.25})`
                  }}
                />
                <div>
                  <div
                    style={{
                      font: `600 54px ${fonts.sans}`,
                      color: interpolateColors(on, [0, 1], [color.faint, color.text]),
                      letterSpacing: -1
                    }}
                  >
                    {m.name}
                  </div>
                  <div style={{ height: 34, opacity: on }}>
                    <Mono size={26}>{m.detail}</Mono>
                  </div>
                </div>
              </div>
            </Appear>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
