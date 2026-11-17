import { AbsoluteFill, Composition, Series, Still } from 'remotion'
import { HearthFace } from './HearthFace'
import { Outro, Privacy } from './scenes/Closing'
import { HowItWorks } from './scenes/HowItWorks'
import { MeetHearth } from './scenes/MeetHearth'
import { Opening } from './scenes/Opening'
import { Problem } from './scenes/Problem'
import {
  AppsScene,
  AskScene,
  CheckInScene,
  ConsentScene,
  DragScene,
  PRODUCT_SECONDS,
  ReminderScene,
  SignalsScene
} from './scenes/Product'
import { FPS, HEIGHT, WIDTH, color, fonts, s } from './theme'
import { Backdrop } from './ui'

interface Scene {
  id: string
  seconds: number
  component: React.ComponentType
}

/**
 * The whole demo in order. Scenes from Product.tsx recreate Hearth's screens until the real
 * recordings replace them; Signals must be a real recording before submitting.
 */
export const DEMO: Scene[] = [
  { id: 'Opening', seconds: 13.5, component: Opening },
  { id: 'Problem', seconds: 16.5, component: Problem },
  { id: 'MeetHearth', seconds: 16.5, component: MeetHearth },
  { id: 'Drag', seconds: PRODUCT_SECONDS.DragScene, component: DragScene },
  { id: 'Consent', seconds: PRODUCT_SECONDS.ConsentScene, component: ConsentScene },
  { id: 'HowItWorks', seconds: 21.5, component: HowItWorks },
  { id: 'Signals', seconds: PRODUCT_SECONDS.SignalsScene, component: SignalsScene },
  { id: 'Ask', seconds: PRODUCT_SECONDS.AskScene, component: AskScene },
  { id: 'CheckIn', seconds: PRODUCT_SECONDS.CheckInScene, component: CheckInScene },
  { id: 'Reminders', seconds: PRODUCT_SECONDS.ReminderScene, component: ReminderScene },
  { id: 'Apps', seconds: PRODUCT_SECONDS.AppsScene, component: AppsScene },
  { id: 'Privacy', seconds: 12.5, component: Privacy },
  { id: 'Outro', seconds: 7, component: Outro }
]

const total = DEMO.reduce((sum, g) => sum + g.seconds, 0)

/** Every scene back to back. */
function Demo(): React.JSX.Element {
  return (
    <Series>
      {DEMO.map(({ id, seconds, component: Scene }) => (
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
      <Composition id="Demo" component={Demo} durationInFrames={s(total)} fps={FPS} width={WIDTH} height={HEIGHT} />
      {DEMO.map(({ id, seconds, component }) => (
        <Composition key={id} id={id} component={component} durationInFrames={s(seconds)} fps={FPS} width={WIDTH} height={HEIGHT} />
      ))}
      <Still id="Cover" component={() => <Cover big={false} />} width={1000} height={420} />
      <Still id="Thumbnail" component={() => <Cover big />} width={1280} height={720} />
    </>
  )
}
