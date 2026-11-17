// The product scenes, built from recreations of Hearth's screens until the real recordings
// replace them. Every behavior shown here exists in the app; the live-signals scene must be
// swapped for a real recording before submitting.
import { AbsoluteFill } from 'remotion'
import { type Cue, type Gesture, type Mood, speechLevel } from '../HearthFace'
import {
  Card,
  Cursor,
  Dashboard,
  Desktop,
  FastClock,
  PageHead,
  Pill,
  Rows,
  Spark,
  Toast,
  Widget,
  ramp,
  track,
  useT
} from '../mock'
import { color, fonts } from '../theme'
import { HearthSays, Narration } from '../ui'
import { HEARTH_LINES, type HearthLine, levelsFor, lineSeconds } from '../voices'

const IDLE_SUB = 'click me or hold Right Ctrl to talk'
const WIDGET_X = 960
const WIDGET_Y = 998

interface Step {
  at: number
  mood?: Mood
  title?: string
  sub?: string
  say?: { text: string; who: 'you' | 'hearth'; wps?: number } | null
  gesture?: Gesture
  smile?: boolean
  dizzy?: boolean
}

/** Folds a list of steps into the widget's face cues and its title, status line and caption at time t. */
function widgetAt(steps: Step[], t: number): { cues: Cue[]; title: string; sub: string; caption: { text: string; who: 'you' | 'hearth'; at: number; wps?: number } | null } {
  const cues = steps.map(({ at, mood, gesture, smile, dizzy }) => ({ at, mood, gesture, smile, dizzy }))
  let title = 'Hearth'
  let sub = IDLE_SUB
  let caption: { text: string; who: 'you' | 'hearth'; at: number; wps?: number } | null = null
  for (const st of steps) {
    if (st.at > t) break
    if (st.title !== undefined) title = st.title
    if (st.sub !== undefined) sub = st.sub
    if (st.say !== undefined) caption = st.say ? { ...st.say, at: st.at } : null
  }
  return { cues, title, sub, caption }
}

/** You speak (listening, your words appear), Hearth thinks (activity), then answers in its voice. */
function exchange(at: number, you: string, activity: string, line: HearthLine, thinkFor = 0.9): Step[] {
  const listenFor = Math.max(1.6, you.split(' ').length / 3)
  const speakAt = at + listenFor + thinkFor
  const hearth = HEARTH_LINES[line]
  return [
    { at, mood: 'listening', title: 'listening', sub: 'release to send', say: { text: you, who: 'you', wps: 3.2 } },
    { at: at + listenFor, mood: 'thinking', title: activity, sub: `"${you}"`, say: { text: you, who: 'you' } },
    { at: speakAt, mood: 'speaking', title: 'Hearth', sub: 'speaking', say: { text: hearth.text, who: 'hearth', wps: hearth.text.split(' ').length / lineSeconds(line) } },
    { at: speakAt + lineSeconds(line) + 0.1, mood: 'idle', title: 'Hearth', sub: IDLE_SUB },
    { at: speakAt + lineSeconds(line) + 1.6, say: null }
  ]
}
const speakTime = (at: number, you: string, thinkFor = 0.9): number => at + Math.max(1.6, you.split(' ').length / 3) + thinkFor

// ---------------------------------------------------------------------------------------------

/** Drag the widget around the desktop; shake it, and it gets dizzy and says so (13 s). */
export function DragScene(): React.JSX.Element {
  const t = useT()
  const shake: [number, number][] = [[6.2, 1450], [6.36, 1540], [6.52, 1360], [6.68, 1540], [6.84, 1360], [7.0, 1540], [7.16, 1360], [7.32, 1450]]
  const xKeys: [number, number][] = [[0, WIDGET_X], [3.9, WIDGET_X], [5.3, 1450], ...shake, [9.9, 1450], [11.2, WIDGET_X]]
  const yKeys: [number, number][] = [[0, WIDGET_Y], [3.9, WIDGET_Y], [5.3, 460], [9.9, 460], [11.2, WIDGET_Y]]
  const x = track(t, xKeys)
  const y = track(t, yKeys)
  // The pointer holds the bar just right of the face while dragging, then lets go and leaves.
  const path: [number, number, number][] = [
    [1.0, 1650, 980],
    [2.3, WIDGET_X - 200, WIDGET_Y - 50],
    [11.3, WIDGET_X - 200, WIDGET_Y - 50],
    [12.2, 1250, 700]
  ]
  const follow = (tt: number): { x: number; y: number } | null =>
    tt >= 3.7 && tt <= 11.3 ? { x: track(tt, xKeys) - 200, y: track(tt, yKeys) - 50 } : null
  const steps: Step[] = [
    { at: 0, mood: 'idle' },
    { at: 1.2, gesture: 'blink' },
    { at: 2.9, gesture: 'glanceRight' },
    { at: 7.2, dizzy: true, mood: 'speaking', sub: 'speaking', say: { text: HEARTH_LINES['h-slowdown'].text, who: 'hearth', wps: 2.4 } },
    { at: 7.2 + lineSeconds('h-slowdown') + 0.2, mood: 'idle', sub: IDLE_SUB },
    { at: 9.6, dizzy: false },
    { at: 10.4, say: null },
    { at: 11.6, smile: true },
    { at: 11.9, gesture: 'hop' }
  ]
  const w = widgetAt(steps, t)
  const expand = track(t, [[2.2, 0], [2.6, 1], [12.3, 1], [12.8, 0]])
  return (
    <AbsoluteFill>
      <Desktop />
      <Narration file="n03-widget" at={2.4} />
      <HearthSays file="h-slowdown" at={7.2} />
      <Widget x={x} y={y} expand={expand} cues={w.cues} title={w.title} sub={w.sub} caption={w.caption} level={levelsFor([['h-slowdown', 7.2]])} />
      <Cursor path={path} presses={[[3.7, 11.3]]} follow={follow} />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------

const CONSENT_ROWS: [string, string, string][] = [
  ['Video stays on this device', 'camera frames are processed locally by the SmartSpectra SDK, never stored or sent', 'local'],
  ['Derived numbers go to Presage', 'about once a minute your pulse, HRV and breathing numbers go to Presage for a wellness insight', 'presage'],
  ['SmartSpectra telemetry is off', 'if you turn it on in Privacy, the SDK sends session summaries, never video or vitals', 'opt-in'],
  ['Your voice goes to AssemblyAI', 'only while you hold the talk keys; it also voices Hearth’s replies', 'assemblyai'],
  ['Your words go to the language model', 'with a short summary of your signals', 'llm'],
  ['Connectors are read-only', 'Hearth only sees services you sign into, and cannot write to them', 'opt-in'],
  ['Google apps go through Composio', 'if you link Gmail, Calendar or Drive', 'composio']
]

/** A person's head and shoulders, for the camera preview without showing anyone real. */
function Sitter({ lean = 0 }: { lean?: number }): React.JSX.Element {
  return (
    <svg width="560" height="340" viewBox="0 0 560 340">
      <defs>
        <radialGradient id="sitter" cx="50%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#8a7663" />
          <stop offset="100%" stopColor="#4a3d33" />
        </radialGradient>
        <linearGradient id="room" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3b342c" />
          <stop offset="100%" stopColor="#1f1c18" />
        </linearGradient>
      </defs>
      <rect width="560" height="340" fill="url(#room)" />
      <g transform={`translate(${lean * 90} ${lean * 10}) scale(${1 - lean * 0.18})`} style={{ transformOrigin: '280px 340px' }}>
        <ellipse cx="280" cy="150" rx="74" ry="92" fill="url(#sitter)" />
        <path d="M120 340 C130 260 200 238 280 238 C360 238 430 260 440 340 Z" fill="#2f3a46" />
      </g>
    </svg>
  )
}

/** The camera panel above the widget: preview, face guide, frame rate, Start sensing. */
function CameraPanel({ sensing, at }: { sensing: boolean; at: number }): React.JSX.Element {
  const t = useT()
  const k = ramp(t, at, at + 0.4)
  return (
    <div style={{ position: 'absolute', left: WIDGET_X - 300, top: WIDGET_Y - 120 - 470, width: 600, padding: 18, borderRadius: 22, background: 'rgba(26,26,26,0.98)', border: `1.5px solid ${color.lineStrong}`, opacity: k, transform: `translateY(${(1 - k) * 16}px)`, boxShadow: '0 24px 60px rgba(0,0,0,0.55)' }}>
      <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: `2px solid ${sensing ? color.green : 'rgba(63,178,127,0.5)'}` }}>
        <Sitter />
        <svg width="560" height="340" viewBox="0 0 400 300" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
          <ellipse cx="200" cy="140" rx="82" ry="104" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeDasharray="6 6" />
        </svg>
        <span style={{ position: 'absolute', left: 14, top: 14, font: `500 17px ${fonts.mono}`, color: sensing ? color.green : color.text, background: 'rgba(0,0,0,0.55)', padding: '4px 12px', borderRadius: 99 }}>
          ● {sensing ? 'sensing' : 'preview only'} · 30 fps
        </span>
      </div>
      <div style={{ font: `400 21px ${fonts.sans}`, color: sensing ? color.green : color.muted, margin: '16px 4px' }}>
        {sensing ? 'Sensing is on. Hearth will tuck the camera away.' : 'Center your face in the oval, in even light, then start.'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ font: `600 20px ${fonts.sans}`, color: sensing ? color.text : '#0e1a12', background: sensing ? color.surface2 : color.green, padding: '10px 20px', borderRadius: 10 }}>
          {sensing ? 'Stop sensing' : 'Start sensing'}
        </span>
        <span style={{ font: `400 26px ${fonts.sans}`, color: color.faint, marginRight: 8 }}>✕</span>
      </div>
    </div>
  )
}

/** First run: the consent card, I agree, then the camera panel and Start sensing (13 s). */
export function ConsentScene(): React.JSX.Element {
  const t = useT()
  const scroll = track(t, [[1.4, 0], [3.4, -330]])
  const consentOut = ramp(t, 4.7, 5.1)
  const steps: Step[] = [
    { at: 0, mood: 'idle' },
    { at: 9.3, sub: 'sensing · click me or hold Right Ctrl' },
    { at: 10.2, gesture: 'blink' },
    { at: 11.2, smile: true }
  ]
  const w = widgetAt(steps, t)
  return (
    <AbsoluteFill>
      <Desktop dim={0.3} />
      <Narration file="n04-consent" at={0.5} />
      <div style={{ opacity: 1 - consentOut }}>
        <Dashboard page="today" status="asleep">
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} />
          <div style={{ position: 'absolute', left: 170, top: 30, width: 1000, height: 760, borderRadius: 18, background: color.surface, border: `1.5px solid ${color.lineStrong}`, overflow: 'hidden' }}>
            <div style={{ padding: '30px 36px 10px' }}>
              <div style={{ font: `600 32px ${fonts.sans}`, color: color.text }}>Before Hearth turns on the camera or microphone</div>
              <div style={{ font: `500 21px ${fonts.sans}`, color: color.muted, marginTop: 10 }}>Hearth is a wellness companion, not a medical device. Nothing it says is medical advice.</div>
            </div>
            <div style={{ position: 'absolute', top: 150, left: 36, right: 36, bottom: 110, overflow: 'hidden' }}>
              <div style={{ transform: `translateY(${scroll}px)` }}>
                {CONSENT_ROWS.map(([title, body, tag], i) => (
                  <div key={title} style={{ display: 'flex', gap: 22, padding: '20px 0', borderTop: `1px solid ${color.line}` }}>
                    <span style={{ font: `400 18px ${fonts.mono}`, color: color.faint, paddingTop: 4 }}>{String(i + 1).padStart(2, '0')}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ font: `600 25px ${fonts.sans}`, color: color.text }}>{title}</div>
                      <div style={{ font: `400 20px ${fonts.sans}`, color: color.muted, marginTop: 6 }}>{body}</div>
                    </div>
                    <span><Pill tone={tag === 'local' ? 'green' : 'plain'}>{tag}</Pill></span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ position: 'absolute', left: 36, right: 36, bottom: 28, display: 'flex', gap: 16, justifyContent: 'flex-end' }}>
              <span style={{ font: `500 22px ${fonts.sans}`, color: color.muted, padding: '12px 22px' }}>Not now</span>
              <span style={{ font: `600 22px ${fonts.sans}`, color: '#1a1206', background: color.amber, padding: '12px 26px', borderRadius: 10, transform: `scale(${t > 4.3 && t < 4.5 ? 0.96 : 1})` }}>I agree</span>
            </div>
          </div>
        </Dashboard>
      </div>
      {t > 5 && <CameraPanel sensing={t >= 8.9} at={5.2} />}
      <Widget x={WIDGET_X} y={WIDGET_Y} expand={track(t, [[4.9, 0], [5.3, 1], [12.4, 1]])} cues={w.cues} title={w.title} sub={w.sub} camera={t >= 9.0} />
      <Cursor path={[[2.0, 900, 520], [3.9, 1450, 838], [4.6, 1450, 838], [7.6, 1300, 860], [8.6, WIDGET_X - 195, WIDGET_Y - 150], [9.4, WIDGET_X - 195, WIDGET_Y - 150], [10.4, 1500, 700]]} presses={[[4.3, 4.5], [8.7, 8.9]]} />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------

/** Smooth made-up signal for the recreated charts: base plus slow and fast wobble. */
const wobble = (t: number, base: number, slow: number, fast: number, seed: number): number =>
  base + slow * Math.sin(t * 0.35 + seed) + fast * Math.sin(t * 1.7 + seed * 2)

function Metric({ label, value, unit, note, highlight = 0 }: { label: string; value: string; unit: string; note: string; highlight?: number }): React.JSX.Element {
  return (
    <Card style={{ width: 320, borderColor: highlight ? `rgba(240,164,58,${0.3 + 0.6 * highlight})` : color.line }}>
      <div style={{ font: `500 19px ${fonts.mono}`, color: color.faint, letterSpacing: 1 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10 }}>
        <span style={{ font: `500 64px ${fonts.mono}`, color: color.text }}>{value}</span>
        <span style={{ font: `400 22px ${fonts.mono}`, color: color.muted }}>{unit}</span>
      </div>
      <div style={{ font: `400 18px ${fonts.sans}`, color: color.muted, marginTop: 6 }}>{note}</div>
    </Card>
  )
}

/**
 * The Signals page, live (13 s). A recreation for now; this is the scene that must be replaced
 * by a real recording, since judges look for a live Presage signal.
 */
export function SignalsScene(): React.JSX.Element {
  const t = useT()
  const blinks = 15 + (t >= 2.6 ? 1 : 0) + (t >= 3.1 ? 1 : 0)
  const blinkFlash = Math.max(ramp(t, 2.5, 2.6) * (1 - ramp(t, 2.6, 3.0)), ramp(t, 3.0, 3.1) * (1 - ramp(t, 3.1, 3.5)))
  const talking = t >= 4.6 && t < 6.9
  const away = ramp(t, 6.9, 7.3) * (1 - ramp(t, 9.8, 10.2))
  const history = (base: number, slow: number, fast: number, seed: number): number[] =>
    Array.from({ length: 90 }, (_, i) => wobble(t - (89 - i) * 0.33, base, slow, fast, seed))
  return (
    <AbsoluteFill>
      <Desktop dim={0.3} />
      <Narration file="n06-live" at={0.4} />
      <Dashboard page="signals" status="sensing" camera>
        <PageHead eyebrow="SIGNALS · LIVE FROM PRESAGE SMARTSPECTRA" title="Right now" />
        <div style={{ display: 'flex', gap: 22, opacity: 1 - 0.45 * away }}>
          <Metric label="PULSE" value={String(Math.round(wobble(t, 72, 1.5, 0.8, 1)))} unit="bpm" note="stable · confidence 88%" />
          <Metric label="BREATHING" value={String(Math.round(wobble(t, 14, 0.4, 0.2, 2)))} unit="/min" note="stable · confidence 76%" />
          <Metric label="HRV" value={String(Math.round(wobble(t, 48, 2, 1, 3)))} unit="ms" note="RMSSD · 60 s window" />
          <Metric label="BLINKS" value={String(blinks)} unit="/min" note="last minute" highlight={blinkFlash} />
        </div>
        <div style={{ display: 'flex', gap: 22, marginTop: 22 }}>
          <Card style={{ flex: 1, height: 300, opacity: 1 - 0.45 * away }}>
            <div style={{ font: `500 19px ${fonts.mono}`, color: color.faint, letterSpacing: 1 }}>LAST 30 SECONDS</div>
            <div style={{ position: 'relative', marginTop: 20 }}>
              <Spark values={history(72, 1.5, 0.8, 1)} w={900} h={90} stroke={color.amber} min={66} max={78} />
              <div style={{ height: 30 }} />
              <Spark values={history(14, 0.4, 0.2, 2)} w={900} h={90} stroke={color.green} min={11} max={17} />
            </div>
          </Card>
          <Card style={{ width: 300, height: 300 }}>
            <div style={{ font: `500 19px ${fonts.mono}`, color: color.faint, letterSpacing: 1 }}>FACE</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
              <span style={{ font: `500 24px ${fonts.sans}`, color: color.text }}>Talking</span>
              <Pill tone={talking ? 'amber' : 'plain'}>{talking ? 'yes' : 'no'}</Pill>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 22 }}>
              <span style={{ font: `500 24px ${fonts.sans}`, color: color.text }}>In view</span>
              <Pill tone={away > 0.5 ? 'red' : 'green'}>{away > 0.5 ? 'no' : 'yes'}</Pill>
            </div>
          </Card>
        </div>
        <div style={{ position: 'absolute', left: 56, right: 56, bottom: 40, opacity: away, padding: '18px 24px', borderRadius: 14, background: 'rgba(240,164,58,0.12)', border: '1.5px solid rgba(240,164,58,0.5)', font: `500 24px ${fonts.sans}`, color: color.amber }}>
          SmartSpectra: move closer to the camera
        </div>
      </Dashboard>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------

/** Hearth smiles back when you smile, then answers how you are doing (12 s). */
export function AskScene(): React.JSX.Element {
  const t = useT()
  const you = 'Hearth, how am I doing?'
  const steps: Step[] = [
    { at: 0, mood: 'idle', sub: 'sensing · click me or hold Right Ctrl' },
    { at: 0.6, smile: true },
    { at: 2.6, smile: false },
    ...exchange(3.0, you, 'checking your signals', 'h-howami')
  ]
  const w = widgetAt(steps, t)
  const speakAt = speakTime(3.0, you)
  return (
    <AbsoluteFill>
      <Desktop />
      <HearthSays file="h-howami" at={speakAt} />
      <div style={{ position: 'absolute', left: WIDGET_X - 330, top: WIDGET_Y - 300, width: 660, textAlign: 'center', opacity: ramp(t, 0.6, 0.9) * (1 - ramp(t, 2.6, 2.9)) }}>
        <span style={{ font: `500 22px ${fonts.mono}`, color: color.amber, padding: '10px 20px', borderRadius: 12, border: '2px dashed rgba(240,164,58,0.6)', background: 'rgba(20,18,15,0.9)' }}>
          you smile · Hearth smiles back · expressions are opt-in
        </span>
      </div>
      <Widget x={WIDGET_X} y={WIDGET_Y} expand={1} cues={w.cues} title={w.title} sub={w.sub} caption={w.caption} camera level={(tt) => (tt < speakAt ? speechLevel(tt) : levelsFor([['h-howami', speakAt]])(tt))} />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------

/** The breathing check-in: set it up, quiet "all fine" checks, speaking up, then the away pause (33 s). */
export function CheckInScene(): React.JSX.Element {
  const t = useT()
  const you = 'Keep an eye on my breathing every minute.'
  const okAt = speakTime(0.3, you)
  const alertAt = 20.0
  const steps: Step[] = [
    { at: 0, mood: 'idle', sub: 'sensing · click me or hold Right Ctrl' },
    ...exchange(0.3, you, 'setting up a check-in', 'h-checkin-ok'),
    { at: alertAt, mood: 'speaking', sub: 'speaking', say: { text: HEARTH_LINES['h-checkin-alert'].text, who: 'hearth', wps: 3.1 } },
    { at: alertAt + lineSeconds('h-checkin-alert') + 0.1, mood: 'idle', sub: 'sensing · click me or hold Right Ctrl' },
    { at: 25.0, say: null },
    { at: 27.4, sub: 'camera paused while you were away' }
  ]
  const w = widgetAt(steps, t)
  const onDashboard = t >= 8.2 && t < 19.7
  const away = t >= 24.8
  const breathing = track(t, [[17.0, 14], [19.4, 22]])
  const scheduled = [{ at: 0, text: 'Watch your breathing', sub: 'every 1 min · 12 checks left', time: '3:14 PM' }]
  const delivered = [
    { at: 13.2, text: 'Checked your breathing: fine. Breathing about 14 a minute.', chip: 'all fine', tone: 'green' as const, time: '3:14 PM' },
    { at: 15.0, text: 'Checked your breathing: fine. Breathing about 13 a minute.', chip: 'all fine', tone: 'green' as const, time: '3:15 PM' },
    { at: 16.8, text: 'Checked your breathing: fine. Breathing about 15 a minute.', chip: 'all fine', tone: 'green' as const, time: '3:16 PM' },
    { at: 28.7, text: "Stopped watching your breathing: the camera can't see you", chip: 'stopped', tone: 'plain' as const, time: '3:19 PM' }
  ]
  return (
    <AbsoluteFill>
      <Desktop dim={onDashboard || away ? 0.3 : 0} />
      <HearthSays file="h-checkin-ok" at={okAt} />
      <Narration file="n07-checkin" at={8.4} />
      <HearthSays file="h-checkin-alert" at={alertAt} />
      <Narration file="n08-away" at={24.6} />
      {(onDashboard || away) && (
        <Dashboard page="reminders" status={away ? 'camera paused' : 'sensing'} camera={!away}>
          <PageHead eyebrow="REMINDERS" title="Things you asked Hearth to say or watch." />
          <div style={{ display: 'flex', gap: 24 }}>
            <Card style={{ width: 560 }}>
              <div style={{ font: `600 26px ${fonts.sans}`, color: color.text, marginBottom: 8 }}>Scheduled</div>
              <Rows rows={away ? [] : scheduled} empty="Nothing pending." />
            </Card>
            <Card style={{ flex: 1 }}>
              <div style={{ font: `600 26px ${fonts.sans}`, color: color.text, marginBottom: 8 }}>Delivered</div>
              <Rows rows={delivered} empty="None yet." />
            </Card>
          </div>
          {t >= 16.8 && !away && (
            <Card style={{ position: 'absolute', right: 56, bottom: 40, width: 460, opacity: ramp(t, 16.8, 17.2) }}>
              <div style={{ font: `500 19px ${fonts.mono}`, color: color.faint, letterSpacing: 1 }}>BREATHING · LIVE</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
                <span style={{ font: `500 60px ${fonts.mono}`, color: breathing > 19 ? color.amber : color.text }}>{Math.round(breathing)}</span>
                <span style={{ font: `400 22px ${fonts.mono}`, color: color.muted }}>/min</span>
              </div>
            </Card>
          )}
        </Dashboard>
      )}
      <FastClock from={12.4} to={18.0} start="3:14" end="3:18" place={{ left: 470, bottom: 150 }} />
      <Widget x={onDashboard || away ? 1560 : WIDGET_X} y={WIDGET_Y} expand={1} cues={w.cues} title={w.title} sub={w.sub} caption={onDashboard ? null : w.caption} camera={!away} level={levelsFor([['h-checkin-ok', okAt], ['h-checkin-alert', alertAt]])} />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------

/** A spoken reminder that waits while you talk, then quiet mode's notification instead (24 s). */
export function ReminderScene(): React.JSX.Element {
  const t = useT()
  const you = 'Remind me to drink some water in one minute.'
  const okAt = speakTime(0.3, you)
  const waterAt = 10.2
  const quiet = t >= 15.6
  const steps: Step[] = [
    { at: 0, mood: 'idle', sub: 'sensing · click me or hold Right Ctrl' },
    ...exchange(0.3, you, 'setting a reminder', 'h-remind-ok'),
    { at: waterAt, mood: 'speaking', sub: 'speaking', say: { text: HEARTH_LINES['h-remind-water'].text, who: 'hearth', wps: 3.2 } },
    { at: waterAt + lineSeconds('h-remind-water') + 0.1, mood: 'idle', sub: 'sensing · click me or hold Right Ctrl' },
    { at: 14.6, say: null },
    { at: 15.6, sub: 'quiet mode, ask any time' }
  ]
  const w = widgetAt(steps, t)
  const heldBack = ramp(t, 7.4, 7.7) * (1 - ramp(t, 9.6, 9.9))
  return (
    <AbsoluteFill>
      <Desktop />
      <HearthSays file="h-remind-ok" at={okAt} />
      <Narration file="n09-gentle" at={7.4} from={0} to={2.0} />
      <HearthSays file="h-remind-water" at={waterAt} />
      <Narration file="n09-gentle" at={14.0} from={2.0} />
      <FastClock from={6.7} to={7.6} start="3:22" end="3:23" />
      <div style={{ position: 'absolute', left: WIDGET_X - 330, top: WIDGET_Y - 300, width: 660, textAlign: 'center', opacity: heldBack }}>
        <span style={{ font: `500 22px ${fonts.mono}`, color: color.amber, padding: '10px 20px', borderRadius: 12, border: '2px dashed rgba(240,164,58,0.6)', background: 'rgba(20,18,15,0.9)' }}>
          you're talking · Hearth holds the reminder
        </span>
      </div>
      <Toast at={18.7} until={23.6} title="Hearth reminder" body="Stretch for a minute" />
      <Widget x={WIDGET_X} y={WIDGET_Y} expand={1} cues={w.cues} title={w.title} sub={w.sub} caption={w.caption} camera level={levelsFor([['h-remind-ok', okAt], ['h-remind-water', waterAt]])} />
      {quiet && (
        <div style={{ position: 'absolute', left: WIDGET_X - 290, top: WIDGET_Y - 150, opacity: ramp(t, 15.6, 16.0) }}>
          <Pill tone="amber">quiet mode</Pill>
        </div>
      )}
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------

const APPS: [string, string, string, 'green' | 'plain'][] = [
  ['Gmail', 'Composio', 'connected', 'green'],
  ['Google Calendar', 'Composio', 'connected', 'green'],
  ['Google Drive', 'Composio', 'connected', 'green'],
  ['Notion', 'MCP · OAuth', 'connected', 'green'],
  ['Linear', 'MCP · OAuth', 'sign in', 'plain'],
  ['GitHub', 'MCP · key', 'add key', 'plain']
]

/** The Apps page, then Hearth reading your calendar and mail (24 s). */
export function AppsScene(): React.JSX.Element {
  const t = useT()
  const q1 = "What's on my calendar today?"
  const q2 = 'Anything important in my email?'
  const calAt = speakTime(7.0, q1, 1.2)
  const mailStart = calAt + lineSeconds('h-calendar') + 0.9
  const mailAt = speakTime(mailStart, q2, 1.4)
  const steps: Step[] = [
    { at: 0, mood: 'idle', sub: 'sensing · click me or hold Right Ctrl' },
    ...exchange(7.0, q1, 'checking your calendar', 'h-calendar', 1.2),
    ...exchange(mailStart, q2, 'reading your email', 'h-mail', 1.4)
  ]
  const w = widgetAt(steps, t)
  const onApps = t < 6.8
  return (
    <AbsoluteFill>
      <Desktop dim={onApps ? 0.3 : 0} />
      <Narration file="n10-apps" at={0.5} />
      <HearthSays file="h-calendar" at={calAt} />
      <HearthSays file="h-mail" at={mailAt} />
      {onApps && (
        <Dashboard page="apps" status="sensing" camera>
          <PageHead eyebrow="APPS" title="Your apps, read-only." intro="Hearth sees only what you link, and only its read tools." />
          <Card>
            {APPS.map(([name, via, state, tone], i) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '16px 0', borderTop: i ? `1px solid ${color.line}` : 'none', opacity: ramp(t, 0.3 + i * 0.25, 0.6 + i * 0.25) }}>
                <span style={{ flex: 1, font: `600 26px ${fonts.sans}`, color: color.text }}>{name}</span>
                <span style={{ font: `400 18px ${fonts.mono}`, color: color.faint, width: 200 }}>{via}</span>
                <Pill tone="plain">read-only</Pill>
                <Pill tone={tone}>{state}</Pill>
              </div>
            ))}
          </Card>
        </Dashboard>
      )}
      {!onApps && (
        <Widget x={WIDGET_X} y={WIDGET_Y} expand={1} cues={w.cues} title={w.title} sub={w.sub} caption={w.caption} camera level={(tt) => (tt < calAt ? speechLevel(tt) : levelsFor([['h-calendar', calAt], ['h-mail', mailAt]])(tt))} />
      )}
    </AbsoluteFill>
  )
}

export const PRODUCT_SECONDS = { DragScene: 13, ConsentScene: 13, SignalsScene: 12.5, AskScene: 12, CheckInScene: 33.5, ReminderScene: 24.5, AppsScene: 24.5 }

