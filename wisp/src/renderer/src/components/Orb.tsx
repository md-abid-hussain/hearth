import { useEffect, useRef } from 'react'
import type { WispMood } from '@shared/types'
import { mic } from '../lib/mic'
import { player } from '../lib/player'

const COLORS: Record<WispMood, string> = {
  sleeping: '#6b665f',
  idle: '#f0a43a',
  listening: '#3fb27f',
  thinking: '#8fb4ff',
  speaking: '#f0a43a'
}

interface Props {
  mood: WispMood
  /** Breaths per minute; the idle orb swells in time with the user. */
  breathing: number | null
  size?: number
}

/** Flat amber orb with eyes; a halo ring shows voice level while listening or speaking. */
export function Orb({ mood, breathing, size = 40 }: Props): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ mood, breathing })
  latest.current = { mood, breathing }

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const pad = 8
    const full = size + pad * 2
    const dpr = window.devicePixelRatio || 1
    canvas.width = full * dpr
    canvas.height = full * dpr
    ctx.scale(dpr, dpr)

    let level = 0
    let frame = 0
    const draw = (time: number): void => {
      const { mood: m, breathing: b } = latest.current
      const target = m === 'speaking' ? player.level() : m === 'listening' ? mic.level : 0
      level += (target - level) * 0.25
      const t = time / 1000
      const bpm = b && b > 4 && b < 40 ? b : 12
      const breath = m === 'idle' ? 0.04 * Math.sin(t * Math.PI * 2 * (bpm / 60)) : 0
      const c = full / 2
      const r = (size / 2) * (1 + breath)

      ctx.clearRect(0, 0, full, full)
      if (m === 'listening' || m === 'speaking') {
        ctx.beginPath()
        ctx.arc(c, c, r + 2 + level * pad * 0.9 + 2, 0, Math.PI * 2)
        ctx.fillStyle = m === 'listening' ? 'rgba(63, 178, 127, 0.24)' : 'rgba(240, 164, 58, 0.28)'
        ctx.fill()
      }
      if (m === 'thinking') {
        ctx.beginPath()
        ctx.arc(c, c, r + 4, t * 4, t * 4 + Math.PI * 0.6)
        ctx.strokeStyle = COLORS.thinking
        ctx.lineWidth = 2
        ctx.stroke()
      }

      ctx.beginPath()
      ctx.arc(c, c, r, 0, Math.PI * 2)
      ctx.fillStyle = COLORS[m]
      ctx.fill()

      const blink = m === 'sleeping' || Math.sin(t * 1.3) > 0.992
      const eyeW = size * 0.11
      const eyeH = blink ? size * 0.03 : size * 0.17
      const dx = size * 0.16
      const lookUp = m === 'thinking' ? -size * 0.06 : 0
      ctx.fillStyle = '#141414'
      for (const sx of [-dx, dx]) {
        ctx.beginPath()
        ctx.roundRect(c + sx - eyeW / 2, c - size * 0.1 + lookUp, eyeW, eyeH, eyeW / 2)
        ctx.fill()
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [size])

  return <canvas ref={ref} style={{ width: size + 16, height: size + 16, display: 'block' }} aria-label={`Wisp is ${mood}`} />
}
