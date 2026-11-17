import { AbsoluteFill } from 'remotion'
import { HearthFace } from '../HearthFace'
import { color, fonts } from '../theme'
import { Appear, Backdrop, Chip, Headline, Mono } from '../ui'

const PROMISES: { title: string; tag: string; tone: 'green' | 'amber' | 'plain' | 'violet'; at: number }[] = [
  { title: 'Video never leaves your laptop', tag: 'local', tone: 'green', at: 0.4 },
  { title: 'Only the numbers go to Presage', tag: 'presage', tone: 'amber', at: 2.5 },
  { title: 'A wellness companion, not a medical device', tag: 'no diagnosis', tone: 'violet', at: 4.8 },
  { title: 'One button deletes everything', tag: 'delete', tone: 'plain', at: 7.2 }
]

/** Scene 11 (10 s): the privacy promises, styled like the rows of Hearth's consent screen. */
export function Privacy(): React.JSX.Element {
  return (
    <AbsoluteFill>
      <Backdrop glow={0.04} />
      <div style={{ position: 'absolute', left: 300, right: 300, top: 190 }}>
        <Appear at={0}>
          <Mono size={28} tone={color.amber}>PRIVACY</Mono>
        </Appear>
        <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column' }}>
          {PROMISES.map((p, i) => (
            <Appear key={p.tag} at={p.at}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 36,
                  padding: '30px 0',
                  borderTop: `1.5px solid ${color.line}`
                }}
              >
                <Mono size={28} tone={color.faint}>0{i + 1}</Mono>
                <div style={{ flex: 1, font: `600 54px ${fonts.sans}`, color: color.text, letterSpacing: -1 }}>{p.title}</div>
                <Chip tone={p.tone}>{p.tag}</Chip>
              </div>
            </Appear>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** Scene 12 (7 s): Hearth hops and smiles over the wordmark and credits. */
export function Outro({ repo = '' }: { repo?: string }): React.JSX.Element {
  return (
    <AbsoluteFill>
      <Backdrop glow={0.08} y="38%" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 18 }}>
        <Appear at={0}>
          <HearthFace
            size={300}
            cues={[
              { at: 0, mood: 'idle' },
              { at: 0.5, smile: true },
              { at: 1.0, gesture: 'hop' },
              { at: 3.4, gesture: 'blink' },
              { at: 4.8, gesture: 'hop' }
            ]}
          />
        </Appear>
        <Appear at={0.4}>
          <Headline size={150} style={{ letterSpacing: -5 }}>Hearth</Headline>
        </Appear>
        <Appear at={0.9}>
          <div style={{ font: `400 46px ${fonts.serifItalic}`, fontStyle: 'italic', color: color.muted }}>
            a little warmth on your desk
          </div>
        </Appear>
        <Appear at={1.6} style={{ marginTop: 24, display: 'flex', gap: 20, alignItems: 'center' }}>
          <Chip tone="green">Built with Presage SmartSpectra</Chip>
          <Chip tone="amber">#presagechallenge</Chip>
        </Appear>
        {repo && (
          <Appear at={2.2}>
            <Mono size={30} tone={color.text}>{repo}</Mono>
          </Appear>
        )}
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 44, textAlign: 'center' }}>
        <Appear at={2.4}>
          <Mono size={22} tone={color.faint}>Narration voice: ElevenLabs · Timers shortened for this demo</Mono>
        </Appear>
      </div>
    </AbsoluteFill>
  )
}
