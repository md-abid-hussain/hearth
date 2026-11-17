import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { HearthFace } from '../HearthFace'
import { FPS, color, fonts } from '../theme'
import { Appear, Backdrop, Chip, Mono } from '../ui'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** A line that draws itself from (x1,y1) to (x2,y2) starting at `at` seconds. */
function Link({ x1, y1, x2, y2, at, dashed = false }: { x1: number; y1: number; x2: number; y2: number; at: number; dashed?: boolean }): React.JSX.Element {
  const t = useCurrentFrame() / FPS
  const p = interpolate(t, [at, at + 0.45], [0, 1], clamp)
  const x = x1 + (x2 - x1) * p
  const y = y1 + (y2 - y1) * p
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = 14
  return (
    <g opacity={p > 0 ? 1 : 0}>
      <line x1={x1} y1={y1} x2={x} y2={y} stroke={color.faint} strokeWidth="4" strokeDasharray={dashed ? '10 10' : undefined} strokeLinecap="round" />
      {p > 0.95 && !dashed && (
        <path
          d={`M ${x2 - head * Math.cos(angle - 0.5)} ${y2 - head * Math.sin(angle - 0.5)} L ${x2} ${y2} L ${x2 - head * Math.cos(angle + 0.5)} ${y2 - head * Math.sin(angle + 0.5)}`}
          fill="none"
          stroke={color.faint}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </g>
  )
}

function Box({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 26,
        background: color.surface,
        border: `1.5px solid ${color.lineStrong}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10
      }}
    >
      {children}
    </div>
  )
}

const OUTPUTS = [
  { label: 'speaks up', at: 13.6, focus: 15.4 },
  { label: 'sends a notification', at: 14.1, focus: 16.2 },
  { label: 'stays quiet', at: 14.6, focus: 17.0 }
]

/**
 * Scene 6 (18 s): camera → SmartSpectra SDK on this laptop → live signals → stable and baseline
 * checks → Hearth, which speaks, notifies or stays quiet; Presage Insights gets numbers only.
 */
export function HowItWorks(): React.JSX.Element {
  const t = useCurrentFrame() / FPS
  const signals = [
    { name: 'pulse', value: `${Math.round(71 + 2 * Math.sin(t * 1.3))} bpm` },
    { name: 'breathing', value: `${(14 + 0.4 * Math.sin(t * 0.9)).toFixed(0)} /min` },
    { name: 'HRV', value: `${Math.round(47 + 3 * Math.sin(t * 0.7))} ms` },
    { name: 'blinks', value: `${t % 6 < 3 ? 15 : 16} /min` },
    { name: 'talking', value: 'no' }
  ]
  const focus = OUTPUTS.findIndex((o, i) => t >= o.focus && t < (OUTPUTS[i + 1]?.focus ?? 99))

  return (
    <AbsoluteFill>
      <Backdrop glow={0.04} />
      <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }}>
        <Link x1={235} y1={520} x2={292} y2={520} at={0.8} />
        <Link x1={688} y1={520} x2={742} y2={520} at={3.1} />
        <Link x1={490} y1={404} x2={490} y2={262} at={4.6} dashed />
        <Link x1={1088} y1={520} x2={1142} y2={520} at={7.6} />
        <Link x1={1452} y1={520} x2={1512} y2={520} at={12.2} />
      </svg>

      <Appear at={0.3} style={{ position: 'absolute', left: 80, top: 445 }}>
        <div style={{ width: 150, height: 150, borderRadius: 30, background: color.surface, border: `1.5px solid ${color.lineStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 32, border: `8px solid ${color.text}`, boxShadow: `0 0 0 10px ${color.surface2}` }} />
        </div>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Mono size={26}>camera</Mono>
        </div>
      </Appear>

      <Appear at={1.2}>
        <Box x={300} y={410} w={388} h={220}>
          <div style={{ font: `600 38px ${fonts.sans}`, color: color.text, letterSpacing: -1 }}>SmartSpectra SDK</div>
          <Mono size={24}>by Presage</Mono>
          <div style={{ height: 52, opacity: interpolate(t, [6.4, 6.8], [0, 1], clamp) }}>
            <Chip tone="green">● on this laptop</Chip>
          </div>
        </Box>
      </Appear>

      <Appear at={4.6}>
        <Box x={300} y={140} w={388} h={120}>
          <div style={{ font: `600 38px ${fonts.sans}`, color: color.text }}>Presage Insights</div>
        </Box>
      </Appear>
      <Appear at={5.0} style={{ position: 'absolute', left: 30, width: 440, top: 296, textAlign: 'right' }}>
        <Mono size={22} tone={color.faint}>numbers only, about once a minute</Mono>
      </Appear>

      <div style={{ position: 'absolute', left: 750, top: 292, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {signals.map((sig, i) => (
          <Appear key={sig.name} at={3.4 + i * 0.45}>
            <div style={{ width: 336, height: 76, borderRadius: 18, background: color.surface, border: `1.5px solid ${color.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', boxSizing: 'border-box' }}>
              <span style={{ font: `500 32px ${fonts.sans}`, color: color.text }}>{sig.name}</span>
              <Mono size={28} tone={color.amber}>{sig.value}</Mono>
            </div>
          </Appear>
        ))}
      </div>

      <div style={{ position: 'absolute', left: 1150, top: 440, display: 'flex', flexDirection: 'column', gap: 22, alignItems: 'flex-start' }}>
        <Appear at={8.2}>
          <Chip tone="green">✓ stable</Chip>
        </Appear>
        <Appear at={10.6}>
          <Chip tone="amber">vs your baseline</Chip>
        </Appear>
      </div>

      <Appear at={12.6} style={{ position: 'absolute', left: 1530, top: 410 }}>
        <HearthFace size={210} cues={[{ at: 0, mood: 'idle' }, { at: 13.2, gesture: 'blink' }, { at: OUTPUTS[0].focus, mood: 'speaking' }, { at: OUTPUTS[1].focus, mood: 'idle' }, { at: 16.8, gesture: 'glanceLeft' }]} />
      </Appear>
      <div style={{ position: 'absolute', left: 1490, top: 680, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {OUTPUTS.map((o, i) => (
          <Appear key={o.label} at={o.at}>
            <Chip tone={focus === i ? 'amber' : 'plain'} style={{ font: `500 24px ${fonts.mono}` }}>
              {o.label}
            </Chip>
          </Appear>
        ))}
      </div>
    </AbsoluteFill>
  )
}
