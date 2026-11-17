import { useEffect, useRef } from 'react'
import { mic } from '../lib/mic'

const BARS = 22
/** One new bar per this many milliseconds, so the wave scrolls at a readable pace. */
const STEP_MS = 55
/** Mic peak level below this counts as silence (room noise, a fan). */
const SPEAKING_LEVEL = 0.04
/** How long a silent microphone is tolerated before the user is told to check it. */
const SILENT_WARN_MS = 2_800

/**
 * A scrolling waveform of the real microphone level while Hearth listens: flat when nothing
 * reaches it, moving when the user speaks. Reports when the mic has stayed silent too long, so
 * a muted or wrong microphone is caught instead of Hearth just "listening".
 */
export function VoiceMeter({
  onSilentChange
}: {
  onSilentChange: (silent: boolean) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const report = useRef(onSilentChange)
  useEffect(() => {
    report.current = onSilentChange
  })

  useEffect(() => {
    const levels: number[] = Array(BARS).fill(0)
    const startedAt = performance.now()
    let lastStep = 0
    let lastHeard = startedAt
    let silent = false
    let smooth = 0
    let frame = 0

    const tick = (now: number): void => {
      smooth += (mic.level - smooth) * 0.5
      if (now - lastStep >= STEP_MS) {
        lastStep = now
        levels.shift()
        levels.push(Math.min(1, smooth * 3))
      }
      if (mic.level > SPEAKING_LEVEL) lastHeard = now
      const nowSilent = now - lastHeard > SILENT_WARN_MS
      if (nowSilent !== silent) {
        silent = nowSilent
        report.current(silent)
      }
      const bars = ref.current?.children
      if (bars) {
        for (let i = 0; i < bars.length; i++) {
          const el = bars[i] as HTMLElement
          el.style.transform = `scaleY(${Math.max(0.08, levels[i]).toFixed(3)})`
          el.style.opacity = levels[i] > 0.12 ? '1' : '0.45'
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      if (silent) report.current(false)
    }
  }, [])

  return (
    <div className="voice-meter" ref={ref} role="img" aria-label="Microphone level">
      {Array.from({ length: BARS }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  )
}
