// Recreations of Hearth's own screens (the widget, the dashboard and its pages, the consent card,
// the camera panel) and a stand-in desktop, styled after the app's tokens.css and screenshots.
// They stand in until the real recordings replace them; the live-signals scene must be real.
import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion'
import { type Cue, HearthFace } from './HearthFace'
import { FPS, color, fonts } from './theme'

export const ease = Easing.inOut(Easing.cubic)
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** The current time in seconds. */
export const useT = (): number => useCurrentFrame() / FPS

/** A value keyframed over time: `keys` are [seconds, value] pairs, eased between them. */
export function track(t: number, keys: [number, number][]): number {
  if (keys.length === 1) return keys[0][1]
  return interpolate(
    t,
    keys.map(([k]) => k),
    keys.map(([, v]) => v),
    { ...clamp, easing: ease }
  )
}

/** 0..1 between `from` and `to` seconds. */
export const ramp = (t: number, from: number, to: number): number => interpolate(t, [from, to], [0, 1], clamp)

// ---------------------------------------------------------------------------------------------
// Desktop

const CODE: [string, string][][] = [
  [['kw', 'export function '], ['fn', 'readCheck'], ['p', '(focus: CheckFocus, everyMin: number): CheckResult {']],
  [['p', '  const v = hub.vitals']],
  [['kw', '  if '], ['p', '(!v.sensing) '], ['kw', 'return '], ['p', "{ status: "], ['s', "'no_signal'"], ['p', ', facts: '], ['s', "'camera sensing is off'"], ['p', ' }']],
  [['kw', '  if '], ['p', '(!v.present) '], ['kw', 'return '], ['p', "{ status: "], ['s', "'no_signal'"], ['p', ', facts: '], ['s', '"the camera can\'t see you"'], ['p', ' }']],
  [['kw', '  const '], ['p', 'windowMs = Math.min(Math.max(everyMin, 2), 5) * 60_000']],
  [['kw', '  if '], ['p', '(focus === '], ['s', "'eyes'"], ['p', ') '], ['kw', 'return '], ['fn', 'eyes'], ['p', '(windowMs)']],
  [['kw', '  if '], ['p', '(focus === '], ['s', "'breathing'"], ['p', ') '], ['kw', 'return '], ['fn', 'breathing'], ['p', '(windowMs)']],
  [['kw', '  if '], ['p', '(focus === '], ['s', "'pulse'"], ['p', ') '], ['kw', 'return '], ['fn', 'pulse'], ['p', '(windowMs)']],
  [['p', '']],
  [['c', '  // Sitting time is always known, so it alone does not count as a reading.']],
  [['kw', '  const '], ['p', 'parts = ['], ['fn', 'eyes'], ['p', '(windowMs), '], ['fn', 'breathing'], ['p', '(windowMs), '], ['fn', 'pulse'], ['p', '(windowMs), '], ['fn', 'sitting'], ['p', '()]']],
  [['kw', '  const '], ['p', "concerns = parts.filter((p) => p.status === "], ['s', "'concern'"], ['p', ')']],
  [['kw', '  if '], ['p', '(concerns.length) '], ['kw', 'return '], ['p', '{ status: '], ['s', "'concern'"], ['p', ', facts: concerns.map((p) => p.facts).join('], ['s', "' '"], ['p', ') }']],
  [['kw', '  return '], ['p', '{ status: '], ['s', "'ok'"], ['p', ', facts: read.map((p) => p.facts).join('], ['s', "' '"], ['p', ') }']],
  [['p', '}']]
]
const TOKEN: Record<string, string> = { kw: '#c792ea', fn: '#82aaff', s: '#c3e88d', c: '#6a655e', p: '#d6d0c4' }

/** A calm stand-in desktop: wallpaper, an editor with Hearth's own code, and a taskbar. */
export function Desktop({ dim = 0, children }: { dim?: number; children?: ReactNode }): React.JSX.Element {
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(1400px 900px at 70% 20%, #2a2219 0%, #15130f 55%, #0e0d0b 100%)' }}>
      <div
        style={{
          position: 'absolute',
          left: 150,
          top: 70,
          width: 1380,
          height: 780,
          borderRadius: 14,
          background: '#181715',
          border: `1.5px solid ${color.line}`,
          overflow: 'hidden',
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)'
        }}
      >
        <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px', background: '#1d1c19', borderBottom: `1px solid ${color.line}` }}>
          {['#e5675b', '#f0a43a', '#3fb27f'].map((c) => (
            <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.8 }} />
          ))}
          <span style={{ marginLeft: 16, font: `500 18px ${fonts.mono}`, color: color.muted }}>checks.ts — hearth</span>
        </div>
        <div style={{ padding: '26px 30px', font: `400 21px/1.75 ${fonts.mono}`, whiteSpace: 'pre' }}>
          {CODE.map((line, i) => (
            <div key={i}>
              <span style={{ color: '#4a4640', display: 'inline-block', width: 46 }}>{i + 78}</span>
              {line.map(([kind, text], j) => (
                <span key={j} style={{ color: TOKEN[kind] }}>{text}</span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 58, background: 'rgba(20,19,17,0.92)', borderTop: `1px solid ${color.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        {['#3a3a3a', '#2f4b6e', '#5a3f2a', '#2e5244', '#4a3a5c', '#3a3a3a'].map((c, i) => (
          <span key={i} style={{ width: 36, height: 36, borderRadius: 9, background: c, border: '1px solid rgba(255,255,255,0.06)' }} />
        ))}
        <span style={{ position: 'absolute', right: 26, font: `500 20px ${fonts.mono}`, color: color.muted }}>3:12 PM</span>
      </div>
      {dim > 0 && <AbsoluteFill style={{ background: `rgba(0,0,0,${dim})` }} />}
      {children}
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------------------------
// Cursor

/**
 * A mouse pointer following `path` ([seconds, x, y]); `presses` are times it clicks or holds.
 * `follow`, when it returns a point, pins the pointer there (to whatever it is dragging).
 */
export function Cursor({
  path,
  presses = [],
  follow
}: {
  path: [number, number, number][]
  presses?: [number, number][]
  follow?: (t: number) => { x: number; y: number } | null
}): React.JSX.Element {
  const t = useT()
  const pinned = follow?.(t)
  const x = pinned?.x ?? track(t, path.map(([s, px]) => [s, px]))
  const y = pinned?.y ?? track(t, path.map(([s, , py]) => [s, py]))
  const down = presses.some(([a, b]) => t >= a && t <= b)
  const visible = t >= path[0][0] - 0.01
  return (
    <svg width="44" height="54" viewBox="0 0 22 27" style={{ position: 'absolute', left: x, top: y, opacity: visible ? 1 : 0, transform: `scale(${down ? 0.88 : 1})`, transformOrigin: '0 0', filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.5))' }}>
      <path d="M1 1 L1 21 L6 16.5 L9.5 24.5 L13 23 L9.6 15.2 L16.5 15.2 Z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------------------------
// The widget

function Icon({ kind }: { kind: 'camera' | 'cameraOff' | 'grid' | 'dots' }): React.JSX.Element {
  const stroke = { fill: 'none', stroke: color.muted, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg width="30" height="30" viewBox="0 0 24 24">
      {(kind === 'camera' || kind === 'cameraOff') && (
        <>
          <rect x="3" y="7" width="13" height="10" rx="2" {...stroke} stroke={kind === 'camera' ? color.green : color.muted} />
          <path d="M16 10.5 L21 8 V16 L16 13.5" {...stroke} stroke={kind === 'camera' ? color.green : color.muted} />
          {kind === 'cameraOff' && <path d="M3 3 L21 21" {...stroke} />}
        </>
      )}
      {kind === 'grid' && (
        <>
          <rect x="4" y="4" width="7" height="9" rx="1.5" {...stroke} />
          <rect x="13" y="4" width="7" height="5" rx="1.5" {...stroke} />
          <rect x="4" y="15" width="7" height="5" rx="1.5" {...stroke} />
          <rect x="13" y="11" width="7" height="9" rx="1.5" {...stroke} />
        </>
      )}
      {kind === 'dots' && [6, 12, 18].map((cx) => <circle key={cx} cx={cx} cy="12" r="1.6" fill={color.muted} />)}
    </svg>
  )
}

export interface WidgetProps {
  /** Bottom-center of the widget, in video pixels. */
  x: number
  y: number
  /** 0 = just the face, 1 = the full bar (hover or busy). */
  expand: number
  cues: Cue[]
  level?: (t: number) => number
  title?: string
  sub?: string
  /** The caption bubble above the bar: Hearth's words, or yours while it listens, revealed at `wps` words a second. */
  caption?: { text: string; who: 'you' | 'hearth'; at: number; wps?: number } | null
  camera?: boolean
}

/** Hearth's widget: the face at rest, the bar on hover or while busy, a caption above it. */
export function Widget({ x, y, expand, cues, level, title = 'Hearth', sub = '', caption = null, camera = false }: WidgetProps): React.JSX.Element {
  const t = useT()
  const width = interpolate(expand, [0, 1], [96, 620])
  const barOpacity = interpolate(expand, [0, 0.4, 1], [0, 0, 1])
  const captionIn = caption ? ramp(t, caption.at, caption.at + 0.25) : 0
  return (
    <div style={{ position: 'absolute', left: x - width / 2, top: y - 100, width, height: 100 }}>
      {caption && captionIn > 0 && (
        <div
          style={{
            position: 'absolute',
            left: (width - 620) / 2,
            width: 620,
            bottom: 116,
            opacity: captionIn,
            transform: `translateY(${(1 - captionIn) * 10}px)`,
            padding: '16px 22px',
            borderRadius: 20,
            background: 'rgba(26,26,26,0.97)',
            border: `1.5px solid ${caption.who === 'you' ? 'rgba(69,192,138,0.45)' : color.lineStrong}`,
            boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
            boxSizing: 'border-box'
          }}
        >
          <div style={{ font: `500 17px ${fonts.mono}`, color: caption.who === 'you' ? '#45c08a' : color.amber, marginBottom: 6, letterSpacing: 0.5 }}>
            {caption.who === 'you' ? 'YOU' : 'HEARTH'}
          </div>
          <div style={{ font: `400 27px/1.35 ${caption.who === 'you' ? fonts.sans : fonts.serif}`, color: color.text }}>
            {caption.wps
              ? caption.text
                  .split(' ')
                  .slice(0, Math.max(1, Math.ceil((t - caption.at) * caption.wps)))
                  .join(' ')
              : caption.text}
          </div>
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 50,
          background: `rgba(26,26,26,${0.97 * barOpacity})`,
          border: `1.5px solid rgba(58,58,58,${barOpacity})`,
          boxShadow: barOpacity ? `0 18px 44px rgba(0,0,0,${0.45 * barOpacity})` : 'none'
        }}
      />
      <div style={{ position: 'absolute', left: 18, top: 18 }}>
        <HearthFace size={64} cues={cues} level={level} />
        {camera && (
          <span style={{ position: 'absolute', right: -2, bottom: 0, width: 22, height: 22, borderRadius: 11, background: color.green, border: `3px solid ${color.bg}` }} />
        )}
      </div>
      <div style={{ position: 'absolute', left: 104, top: 20, opacity: barOpacity, whiteSpace: 'nowrap' }}>
        <div style={{ font: `600 30px ${fonts.sans}`, color: color.text }}>{title}</div>
        <div style={{ font: `400 21px ${fonts.sans}`, color: color.muted, marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{ position: 'absolute', right: 26, top: 34, display: 'flex', gap: 18, opacity: barOpacity }}>
        <Icon kind={camera ? 'camera' : 'cameraOff'} />
        <Icon kind="grid" />
        <Icon kind="dots" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Dashboard

const NAV: { group: string; items: { id: string; label: string }[] }[] = [
  { group: 'REPORT', items: [{ id: 'today', label: 'Today' }, { id: 'signals', label: 'Signals' }, { id: 'timeline', label: 'Timeline' }, { id: 'insights', label: 'Insights' }] },
  { group: 'HEARTH', items: [{ id: 'memory', label: 'Memory' }, { id: 'reminders', label: 'Reminders' }] },
  { group: 'SETUP', items: [{ id: 'apps', label: 'Apps' }, { id: 'privacy', label: 'Privacy' }, { id: 'settings', label: 'Settings' }] }
]

/** Hearth's dashboard window: title bar, sidebar, and a page. */
export function Dashboard({
  page,
  status = '',
  camera = false,
  quiet = false,
  style,
  children
}: {
  page: string
  status?: string
  camera?: boolean
  quiet?: boolean
  style?: CSSProperties
  children: ReactNode
}): React.JSX.Element {
  let n = 0
  return (
    <div style={{ position: 'absolute', left: 110, top: 50, width: 1700, height: 900, borderRadius: 16, overflow: 'hidden', background: color.bg, border: `1.5px solid ${color.lineStrong}`, boxShadow: '0 40px 100px rgba(0,0,0,0.6)', ...style }}>
      <div style={{ height: 56, display: 'flex', alignItems: 'center', gap: 14, padding: '0 22px', background: color.surface, borderBottom: `1px solid ${color.line}` }}>
        <HearthFace size={30} cues={[{ at: 0, mood: 'idle' }]} />
        <span style={{ font: `600 24px ${fonts.sans}`, color: color.text }}>Hearth</span>
        <span style={{ font: `400 20px ${fonts.sans}`, color: color.muted }}>{status}</span>
        <span style={{ flex: 1 }} />
        {camera && <span style={{ font: `500 17px ${fonts.mono}`, color: color.green, padding: '4px 12px', borderRadius: 99, background: color.greenSoft }}>● camera on</span>}
        {quiet && <span style={{ font: `500 17px ${fonts.mono}`, color: color.muted, padding: '4px 12px', borderRadius: 99, background: color.surface2 }}>quiet mode</span>}
        <span style={{ font: `400 26px ${fonts.sans}`, color: color.faint, marginLeft: 18, letterSpacing: 18 }}>– ▢ ✕</span>
      </div>
      <div style={{ display: 'flex', height: 844 }}>
        <div style={{ width: 280, padding: '26px 18px', borderRight: `1px solid ${color.line}`, background: '#151515', boxSizing: 'border-box' }}>
          {NAV.map((g) => (
            <div key={g.group} style={{ marginBottom: 26 }}>
              <div style={{ font: `500 15px ${fonts.mono}`, color: color.faint, letterSpacing: 2, padding: '0 14px 10px' }}>{g.group}</div>
              {g.items.map((item) => {
                n += 1
                const on = item.id === page
                return (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: on ? color.surface2 : 'transparent', boxShadow: on ? `inset 3px 0 0 ${color.amber}` : 'none' }}>
                    <span style={{ font: `500 22px ${fonts.sans}`, color: on ? color.text : color.muted }}>{item.label}</span>
                    <span style={{ font: `400 16px ${fonts.mono}`, color: color.faint }}>{String(n).padStart(2, '0')}</span>
                  </div>
                )
              })}
            </div>
          ))}
          <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 10, padding: '0 14px' }}>
            {[
              [camera ? 'camera on' : 'camera off', camera ? color.green : color.faint],
              ['assemblyai voice', color.green],
              ['openai model', color.green],
              [quiet ? 'quiet mode on' : 'quiet mode off', quiet ? color.amber : color.faint]
            ].map(([label, dot]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: dot }} />
                <span style={{ font: `400 17px ${fonts.sans}`, color: color.muted }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, padding: '40px 56px', position: 'relative', overflow: 'hidden' }}>{children}</div>
      </div>
    </div>
  )
}

/** A page's eyebrow and title, as in the app. */
export function PageHead({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }): React.JSX.Element {
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ font: `500 18px ${fonts.mono}`, color: color.amber, letterSpacing: 2 }}>— {eyebrow}</div>
      <div style={{ font: `600 52px ${fonts.sans}`, color: color.text, letterSpacing: -1.5, marginTop: 10 }}>{title}</div>
      {intro && <div style={{ font: `400 24px ${fonts.serif}`, color: color.muted, marginTop: 8, maxWidth: 1100 }}>{intro}</div>}
    </div>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }): React.JSX.Element {
  return (
    <div style={{ background: color.surface, border: `1.5px solid ${color.line}`, borderRadius: 16, padding: '22px 26px', boxSizing: 'border-box', ...style }}>
      {children}
    </div>
  )
}

export function Pill({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'green' | 'amber' | 'red' }): React.JSX.Element {
  const tones = {
    plain: [color.muted, color.surface2],
    green: [color.green, color.greenSoft],
    amber: [color.amber, 'rgba(240,164,58,0.14)'],
    red: [color.red, 'rgba(229,103,91,0.14)']
  }[tone]
  return <span style={{ font: `500 17px ${fonts.mono}`, color: tones[0], background: tones[1], padding: '4px 12px', borderRadius: 99, whiteSpace: 'nowrap' }}>{children}</span>
}

// ---------------------------------------------------------------------------------------------
// Pages

/** A small line chart of `values` (oldest first), scaled into the box. */
export function Spark({ values, w, h, stroke, min, max }: { values: number[]; w: number; h: number; stroke: string; min: number; max: number }): React.JSX.Element {
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - ((v - min) / (max - min)) * h}`).join(' ')
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export interface Row {
  at: number
  text: string
  sub?: string
  chip?: string
  tone?: 'plain' | 'green' | 'amber' | 'red'
  time?: string
}

/** A list where rows slide in at their `at` time. */
export function Rows({ rows, empty }: { rows: Row[]; empty: string }): React.JSX.Element {
  const t = useT()
  const shown = rows.filter((r) => t >= r.at)
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {shown.length === 0 && <div style={{ font: `400 22px ${fonts.sans}`, color: color.faint, padding: '14px 0' }}>{empty}</div>}
      {shown.map((r) => {
        const k = ramp(t, r.at, r.at + 0.35)
        return (
          <div key={r.text + r.at} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 0', borderTop: `1px solid ${color.line}`, opacity: k, transform: `translateY(${(1 - k) * 12}px)` }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, border: `2px solid ${color.lineStrong}` }} />
            <div style={{ flex: 1 }}>
              <div style={{ font: `400 23px ${fonts.serif}`, color: color.text }}>{r.text}</div>
              {r.sub && <div style={{ font: `400 17px ${fonts.mono}`, color: color.faint, marginTop: 4 }}>{r.sub}</div>}
            </div>
            {r.chip && <Pill tone={r.tone}>{r.chip}</Pill>}
            {r.time && <span style={{ font: `400 17px ${fonts.mono}`, color: color.faint }}>{r.time}</span>}
          </div>
        )
      })}
    </div>
  )
}

/** Notification card in the corner of the screen, as Windows shows Hearth's reminders. */
export function Toast({ at, until, title, body }: { at: number; until: number; title: string; body: string }): React.JSX.Element {
  const t = useT()
  const k = ramp(t, at, at + 0.4) * (1 - ramp(t, until, until + 0.4))
  return (
    <div style={{ position: 'absolute', right: 36, bottom: 90, width: 520, padding: '22px 26px', borderRadius: 14, background: '#202020', border: `1.5px solid ${color.lineStrong}`, boxShadow: '0 20px 50px rgba(0,0,0,0.6)', opacity: k, transform: `translateX(${(1 - k) * 60}px)`, display: 'flex', gap: 18 }}>
      <HearthFace size={48} cues={[{ at: 0, mood: 'idle' }]} />
      <div>
        <div style={{ font: `600 23px ${fonts.sans}`, color: color.text }}>{title}</div>
        <div style={{ font: `400 21px ${fonts.sans}`, color: color.muted, marginTop: 6 }}>{body}</div>
      </div>
    </div>
  )
}

/** A clock in the corner showing time passing faster than real time. */
export function FastClock({
  from,
  to,
  start,
  end,
  place = { right: 60, top: 70 }
}: {
  from: number
  to: number
  start: string
  end: string
  place?: CSSProperties
}): React.JSX.Element {
  const t = useT()
  const k = ramp(t, from - 0.3, from) * (1 - ramp(t, to, to + 0.3))
  const [h0, m0] = start.split(':').map(Number)
  const [h1, m1] = end.split(':').map(Number)
  const minutes = Math.round(track(t, [[from, h0 * 60 + m0], [to, h1 * 60 + m1]]))
  const label = `${Math.floor(minutes / 60) % 12 || 12}:${String(minutes % 60).padStart(2, '0')}`
  return (
    <div style={{ position: 'absolute', ...place, opacity: k, padding: '14px 22px', borderRadius: 14, background: 'rgba(26,26,26,0.95)', border: `1.5px solid ${color.lineStrong}`, display: 'flex', gap: 14, alignItems: 'center' }}>
      <span style={{ font: `500 20px ${fonts.mono}`, color: color.amber }}>⏩ time passes</span>
      <span style={{ font: `500 30px ${fonts.mono}`, color: color.text }}>{label} PM</span>
    </div>
  )
}
