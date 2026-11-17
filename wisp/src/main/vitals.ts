import { decodeMetrics } from '@smartspectra/node-sdk/messages'
import type { VitalsPoint } from '../shared/types'
import { emptyVitals, hub } from './hub'

const POINT_INTERVAL_MS = 2_000
const HISTORY_MS = 60 * 60_000
const PRESENCE_TIMEOUT_MS = 20_000
const BREAK_AWAY_MS = 3 * 60_000
const TALKING_WINDOW_MS = 8_000
/** Breathing rate is not measured reliably while talking, so it waits this long after speech. */
const BREATHING_AFTER_TALK_MS = 20_000
/** A value not refreshed for this long is left out of the history instead of being repeated. */
const STALE_MS = 6_000

/**
 * Confidence floors behind the SDK's `stable` flag (SmartSpectra data types: pulse 40,
 * breathing 45, HRV 50). Used only when a packet carries no `stable` flag.
 */
const STABLE_AT = { pulse: 40, breathing: 45, hrv: 50 } as const

/** ExpressionType values from the SmartSpectra protobuf schema. */
const EXPRESSIONS: Record<number, string> = {
  1: 'angry',
  2: 'contempt',
  3: 'disgust',
  4: 'fear',
  5: 'happy',
  6: 'neutral',
  7: 'sad',
  8: 'surprise'
}

interface Measured {
  value?: number | null
  confidence?: number | null
  stable?: boolean | null
}

const lastOf = <T>(list: T[] | null | undefined): T | undefined =>
  list && list.length ? list[list.length - 1] : undefined

/** Readings before the SDK's analysis window fills are not trustworthy, so they are skipped. */
const isStable = (m: Measured | undefined, floor: number): boolean =>
  m?.stable === true || (m?.stable == null && (m?.confidence ?? 0) >= floor)

class VitalsTracker {
  history: VitalsPoint[] = []
  private lastPointAt = 0
  private lastMetricsAt = 0
  private lastTalkingAt = 0
  private awaySince: number | null = null
  private blinkTimes: number[] = []
  private lastBlinkState = false
  private presenceTimer: NodeJS.Timeout | null = null
  private updated = { pulse: 0, breathing: 0, hrv: 0 }

  start(): void {
    const now = Date.now()
    hub.vitals = {
      ...emptyVitals(),
      sensing: true,
      sessionStartedAt: now,
      sittingSince: now,
      updatedAt: now
    }
    this.history = []
    this.awaySince = null
    this.updated = { pulse: 0, breathing: 0, hrv: 0 }
    this.lastTalkingAt = 0
    hub.record('session', 'Sensing started')
    if (!this.presenceTimer) this.presenceTimer = setInterval(() => this.checkPresence(), 5_000)
  }

  stop(): void {
    if (!hub.vitals.sensing) return
    hub.vitals = { ...hub.vitals, sensing: false, present: false, updatedAt: Date.now() }
    hub.record('session', 'Sensing stopped')
    if (this.presenceTimer) clearInterval(this.presenceTimer)
    this.presenceTimer = null
  }

  setValidationHint(hint: string | null): void {
    if (hub.vitals.validationHint === hint) return
    hub.vitals = { ...hub.vitals, validationHint: hint }
    hub.changed()
  }

  ingest(buf: Uint8Array): void {
    const now = Date.now()
    const m = decodeMetrics(buf)
    const v = { ...hub.vitals }

    // Talking first: breathing below is skipped while the user speaks or holds the talk keys.
    const talking = lastOf(m.face?.talking)
    if (talking?.detected || hub.listenMode) this.lastTalkingAt = now
    v.talking = now - this.lastTalkingAt < TALKING_WINDOW_MS

    const pulse = lastOf(m.cardio?.pulseRate as Measured[] | undefined)
    if (pulse?.value && isStable(pulse, STABLE_AT.pulse)) {
      v.pulse = pulse.value
      v.pulseConfidence = pulse.confidence ?? null
      this.updated.pulse = now
    }
    const breathing = lastOf(m.breathing?.rate as Measured[] | undefined)
    const recentlyTalked =
      this.lastTalkingAt > 0 && now - this.lastTalkingAt < BREATHING_AFTER_TALK_MS
    if (breathing?.value && isStable(breathing, STABLE_AT.breathing) && !recentlyTalked) {
      v.breathing = breathing.value
      v.breathingConfidence = breathing.confidence ?? null
      this.updated.breathing = now
    }
    const hrv = lastOf(m.cardio?.hrv)
    if (hrv?.rmssd && isStable(hrv, STABLE_AT.hrv)) {
      v.hrvRmssd = hrv.rmssd
      this.updated.hrv = now
    }

    const expression = lastOf(m.face?.expression)
    if (expression?.stable && expression.scores?.length) {
      const top = [...expression.scores].sort(
        (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
      )[0]
      const label = EXPRESSIONS[top.type ?? 0]
      v.expression = label ? { label, confidence: top.confidence ?? 0 } : null
    }

    const blink = lastOf(m.face?.blinking)
    if (blink) {
      const blinking = Boolean(blink.detected)
      if (blinking && !this.lastBlinkState) this.blinkTimes.push(now)
      this.lastBlinkState = blinking
      this.blinkTimes = this.blinkTimes.filter((t) => now - t < 60_000)
      v.blinksPerMinute = this.blinkTimes.length
    }

    if (this.awaySince && now - this.awaySince >= BREAK_AWAY_MS) {
      v.sittingSince = now
      hub.record('session', 'Welcome back: break detected, sitting timer reset')
    }
    this.awaySince = null
    this.lastMetricsAt = now
    v.present = true
    v.updatedAt = now
    hub.vitals = v

    if (now - this.lastPointAt >= POINT_INTERVAL_MS) {
      this.lastPointAt = now
      const fresh = (key: 'pulse' | 'breathing' | 'hrv', value: number | null): number | null =>
        now - this.updated[key] < STALE_MS ? value : null
      const point: VitalsPoint = {
        t: now,
        pulse: fresh('pulse', v.pulse),
        breathing: fresh('breathing', v.breathing),
        hrv: fresh('hrv', v.hrvRmssd)
      }
      this.history.push(point)
      const cutoff = now - HISTORY_MS
      while (this.history.length && this.history[0].t < cutoff) this.history.shift()
      hub.send({ type: 'vitalsPoint', point })
      hub.changed()
    }
  }

  private checkPresence(): void {
    const now = Date.now()
    if (!hub.vitals.sensing || !hub.vitals.present) return
    if (now - this.lastMetricsAt > PRESENCE_TIMEOUT_MS) {
      this.awaySince = this.lastMetricsAt
      hub.vitals = { ...hub.vitals, present: false, talking: false }
      hub.changed()
    }
  }

  /** Mean of a metric over the trailing window, ignoring gaps. */
  average(key: 'pulse' | 'breathing' | 'hrv', windowMs: number, endOffsetMs = 0): number | null {
    const end = Date.now() - endOffsetMs
    const values = this.history
      .filter((p) => p.t <= end && p.t > end - windowMs)
      .map((p) => p[key])
      .filter((x): x is number => typeof x === 'number')
    if (!values.length) return null
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  /** Session baseline: median of the first ten minutes once enough samples exist. */
  baseline(key: 'pulse' | 'breathing'): number | null {
    const start = hub.vitals.sessionStartedAt
    if (!start) return null
    const values = this.history
      .filter((p) => p.t < start + 10 * 60_000)
      .map((p) => p[key])
      .filter((x): x is number => typeof x === 'number')
      .sort((a, b) => a - b)
    if (values.length < 60) return null
    return values[Math.floor(values.length / 2)]
  }

  describe(): Record<string, unknown> {
    const v = hub.vitals
    const round = (x: number | null): number | null => (x == null ? null : Math.round(x * 10) / 10)
    const now = Date.now()
    return {
      sensing: v.sensing,
      present: v.present,
      sessionMinutes: v.sessionStartedAt ? Math.round((now - v.sessionStartedAt) / 60_000) : 0,
      minutesSinceLastBreak: v.sittingSince ? Math.round((now - v.sittingSince) / 60_000) : null,
      pulseBpm: round(v.pulse),
      pulseConfidencePct: round(v.pulseConfidence),
      breathingPerMin: round(v.breathing),
      breathingConfidencePct: round(v.breathingConfidence),
      hrvRmssdMs: round(v.hrvRmssd),
      blinksPerMinute: v.blinksPerMinute,
      talking: v.talking,
      pulseAvg5min: round(this.average('pulse', 5 * 60_000)),
      pulseAvgPrev5min: round(this.average('pulse', 5 * 60_000, 5 * 60_000)),
      breathingAvg5min: round(this.average('breathing', 5 * 60_000)),
      pulseBaseline: round(this.baseline('pulse')),
      breathingBaseline: round(this.baseline('breathing'))
    }
  }
}

export const vitals = new VitalsTracker()
