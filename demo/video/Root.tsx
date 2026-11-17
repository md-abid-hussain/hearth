import { AbsoluteFill, Composition, Series, Still } from 'remotion'
import { HearthFace } from './HearthFace'
import { Outro, Privacy } from './scenes/Closing'
import { HowItWorks } from './scenes/HowItWorks'
import { MeetHearth } from './scenes/MeetHearth'
import { Opening } from './scenes/Opening'
import { Problem } from './scenes/Problem'
import { FPS, HEIGHT, WIDTH, color, fonts, s } from './theme'
import { Backdrop } from './ui'

/** The scenes that need no footage, in video order, with their lengths in seconds. */
export const GENERATED: { id: string; seconds: number; component: React.ComponentType }[] = [
  { id: 'Opening', seconds: 12, component: Opening },
  { id: 'Problem', seconds: 16.5, component: Problem },
  { id: 'MeetHearth', seconds: 16.5, component: MeetHearth },
  { id: 'HowItWorks', seconds: 21.5, component: HowItWorks },
  { id: 'Privacy', seconds: 12.5, component: Privacy },
  { id: 'Outro', seconds: 7, component: Outro }
]

const total = GENERATED.reduce((sum, g) => sum + g.seconds, 0)

/** Every generated scene back to back, for previewing before the footage exists. */
function Generated(): React.JSX.Element {
  return (
    <Series>
      {GENERATED.map(({ id, seconds, component: Scene }) => (
        <Series.Sequence key={id} durationInFrames={s(seconds)}>
          <Scene />
        </Series.Sequence>
      ))}
    </Series>
  )
}

/** DEV cover image (1000x420) and YouTube thumbnail (1280x720). */
function Cover({ big }: { big: boolean }): React.JSX.Element {
  const face = big ? 330 : 250
  return (
    <AbsoluteFill>
      <Backdrop glow={0.12} x="27%" y="50%" />
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', gap: big ? 60 : 44, paddingLeft: big ? 110 : 70 }}>
        <HearthFace size={face} cues={[{ at: 0, mood: 'idle', smile: true }]} />
        <div>
          <div style={{ font: `600 ${big ? 150 : 104}px ${fonts.sans}`, color: color.text, letterSpacing: big ? -5 : -3.5, lineHeight: 1 }}>
            Hearth
          </div>
          <div style={{ font: `400 ${big ? 44 : 32}px ${fonts.serifItalic}`, fontStyle: 'italic', color: color.muted, marginTop: 10 }}>
            reads your pulse and breath,
            <br />
            looks after you kindly
          </div>
          <div style={{ font: `500 ${big ? 24 : 18}px ${fonts.mono}`, color: color.green, marginTop: big ? 30 : 18 }}>
            ● Presage SmartSpectra · live
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export function Root(): React.JSX.Element {
  return (
    <>
      <Composition id="Generated" component={Generated} durationInFrames={s(total)} fps={FPS} width={WIDTH} height={HEIGHT} />
      {GENERATED.map(({ id, seconds, component }) => (
        <Composition key={id} id={id} component={component} durationInFrames={s(seconds)} fps={FPS} width={WIDTH} height={HEIGHT} />
      ))}
      <Still id="Cover" component={() => <Cover big={false} />} width={1000} height={420} />
      <Still id="Thumbnail" component={() => <Cover big />} width={1280} height={720} />
    </>
  )
}
