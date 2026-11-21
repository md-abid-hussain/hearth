import { decodeMetrics } from '@smartspectra/node-sdk/messages'
import { READINGS } from '../shared/readings'
import type { VitalsPoint } from '../shared/types'
import { away } from './away'
import { isDemo } from './demo'
import { emptyVitals, hub } from './hub'
import { appendJsonl } from './store'

const POINT_INTERVAL_MS = 2_000
const HISTORY_MS = 60 * 60_000
const PRESENCE_TIMEOUT_MS = 20_000
const BREAK_AWAY_MS = 3 * 60_000
const TALKING_WINDOW_MS = 8_000
/** The session baseline is the median of this first stretch of the session. */
const BASELINE_WINDOW_MS = 10 * 60_000
/** Points needed in that stretch for a baseline: two minutes' worth at one point every 2 s. */
const BASELINE_MIN_POINTS = 60
/** Breathing rate is not measured reliably while talking, so it waits this long after speech. */
const BREATHING_AFTER_TALK_MS = 20_000
/** A value not refreshed for this long is left out of the history instead of being repeated. */
const STALE_MS = 6_000
/** Expression labels arrive only when the SDK marks one stable, so one is kept a little longer. */
const EXPRESSION_STALE_MS = 15_000
/** Demo mode only: every history point, kept for editing the demo video. */
const DEMO_VITALS_FILE = 'vitals.jsonl'

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
  /** When blink packets started arriving; the per-minute count means little before a full minute. */
  private blinkSince: number | null = null
  private presenceTimer: NodeJS.Timeout | null = null
  private updated = { pulse: 0, breathing: 0, hrv: 0, blinks: 0, expression: 0 }
  /**
   * Baselines fixed once the session's first ten minutes are over, for the session that started
   * at `session`. The history keeps only the last hour, so after that those minutes are gone.
   */
  private fixedBaselines: {
    session: number
    pulse: number | null
    breathing: number | null
  } | null = null

  /**
   * `awayFrom` is when the user left, for a session that paused itself while they were away:
   * it carries on with the same history and baseline, and only a long absence counts as a break.
   */
  start(awayFrom: number | null = null): void {
    const now = Date.now()
    const prev = hub.vitals
    const resume = awayFrom != null && prev.sessionStartedAt != null
    const tookBreak = awayFrom == null || !resume || now - awayFrom >= BREAK_AWAY_MS
    hub.vitals = {
      ...emptyVitals(),
      sensing: true,
      sessionStartedAt: resume ? prev.sessionStartedAt : now,
      sittingSince: tookBreak ? now : prev.sittingSince,
      updatedAt: now
    }
    if (!resume) this.history = []
    this.awaySince = null
    this.updated = { pulse: 0, breathing: 0, hrv: 0, blinks: 0, expression: 0 }
    this.lastTalkingAt = 0
    this.blinkTimes = []
    this.lastBlinkState = false
    this.blinkSince = null
    if (!resume) hub.record('session', 'Sensing started')
    else if (tookBreak) hub.record('session', 'Welcome back: break detected, sitting timer reset')
    if (!this.presenceTimer) this.presenceTimer = setInterval(() => this.checkPresence(), 5_000)
  }

  stop(): void {
    if (!hub.vitals.sensing) return
    // No packets arrive once stopped, so nothing would ever clear a talking flag left on, and
    // the observer would hold every reminder back as "user appears to be talking".
    this.lastTalkingAt = 0
    hub.vitals = {
      ...hub.vitals,
      sensing: false,
      present: false,
      talking: false,
      updatedAt: Date.now()
    }
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
      if (label) this.updated.expression = now
    }

    const blink = lastOf(m.face?.blinking)
    if (blink) {
      const blinking = Boolean(blink.detected)
      if (blinking && !this.lastBlinkState) this.blinkTimes.push(now)
      this.lastBlinkState = blinking
      this.blinkTimes = this.blinkTimes.filter((t) => now - t < 60_000)
      v.blinksPerMinute = this.blinkTimes.length
      this.blinkSince ??= now
      if (now - this.blinkSince >= 60_000) this.updated.blinks = now
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
      const fresh = (
        key: 'pulse' | 'breathing' | 'hrv' | 'blinks',
        value: number | null
      ): number | null => (now - this.updated[key] < STALE_MS ? value : null)
      const point: VitalsPoint = {
        t: now,
        pulse: fresh('pulse', v.pulse),
        breathing: fresh('breathing', v.breathing),
        hrv: fresh('hrv', v.hrvRmssd),
        blinks: fresh('blinks', v.blinksPerMinute),
        expression:
          hub.settings.measureExpressions && now - this.updated.expression < EXPRESSION_STALE_MS
            ? (v.expression?.label ?? null)
            : null
      }
      this.history.push(point)
      // Before trimming, which would drop the first ten minutes an hour into the session.
      this.fixBaselines(now)
      const cutoff = now - HISTORY_MS
      while (this.history.length && this.history[0].t < cutoff) this.history.shift()
      hub.send({ type: 'vitalsPoint', point })
      hub.changed()
      // Demo recordings get the full signal trace, so the edit can draw real charts in sync.
      if (isDemo())
        appendJsonl(DEMO_VITALS_FILE, {
          ...point,
          blinksPerMinute: v.blinksPerMinute,
          talking: v.talking,
          expression: v.expression?.label ?? null,
          hint: v.validationHint
        })
    }
  }

  private checkPresence(): void {
    const now = Date.now()
    if (!hub.vitals.sensing || !hub.vitals.present) return
    if (now - this.lastMetricsAt > PRESENCE_TIMEOUT_MS) {
      this.awaySince = this.lastMetricsAt
      hub.vitals = { ...hub.vitals, present: false, talking: false }
      hub.changed()
      // Metrics stopped without a no-face status: count down to the away pause all the same.
      away.presenceLost()
    }
  }

  /** Mean of a metric over the trailing window, ignoring gaps. */
  average(
    key: 'pulse' | 'breathing' | 'hrv' | 'blinks',
    windowMs: number,
    endOffsetMs = 0
  ): number | null {
    const end = Date.now() - endOffsetMs
    const values = this.history
      .filter((p) => p.t <= end && p.t > end - windowMs)
      .map((p) => p[key])
      .filter((x): x is number => typeof x === 'number')
    if (!values.length) return null
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  /** Share of each expression label over the trailing window, in whole percent; null with no samples. */
  private expressionShares(windowMs: number): Record<string, number> | null {
    const since = Date.now() - windowMs
    const labels = this.history
      .filter((p) => p.t > since && p.expression)
      .map((p) => p.expression as string)
    if (!labels.length) return null
    const counts: Record<string, number> = {}
    for (const label of labels) counts[label] = (counts[label] ?? 0) + 1
    return Object.fromEntries(
      Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([label, n]) => [label, Math.round((n / labels.length) * 100)])
    )
  }

  /** Median of the session's first ten minutes, or null until enough samples exist. */
  private firstMinutesMedian(key: 'pulse' | 'breathing', start: number): number | null {
    const values = this.history
      .filter((p) => p.t >= start && p.t < start + BASELINE_WINDOW_MS)
      .map((p) => p[key])
      .filter((x): x is number => typeof x === 'number')
      .sort((a, b) => a - b)
    if (values.length < BASELINE_MIN_POINTS) return null
    return values[Math.floor(values.length / 2)]
  }

  /**
   * Fixes both baselines once the first ten minutes are over, once per session. A session
   * resumed after an away pause keeps its start, so it keeps its baseline too.
   */
  private fixBaselines(now: number): void {
    const start = hub.vitals.sessionStartedAt
    if (!start || now < start + BASELINE_WINDOW_MS || this.fixedBaselines?.session === start) return
    this.fixedBaselines = {
      session: start,
      pulse: this.firstMinutesMedian('pulse', start),
      breathing: this.firstMinutesMedian('breathing', start)
    }
  }

  /** Session baseline: median of the first ten minutes once enough samples exist. */
  baseline(key: 'pulse' | 'breathing'): number | null {
    const start = hub.vitals.sessionStartedAt
    if (!start) return null
    this.fixBaselines(Date.now())
    if (this.fixedBaselines?.session === start) return this.fixedBaselines[key]
    return this.firstMinutesMedian(key, start)
  }

  describe(): Record<string, unknown> {
    const v = hub.vitals
    const round = (x: number | null): number | null => (x == null ? null : Math.round(x * 10) / 10)
    const now = Date.now()
    return {
      sensing: v.sensing,
      present: v.present,
      // Readings the user switched off in Signals; their values stay empty on purpose.
      switchedOff: READINGS.filter((r) => !hub.settings[r.key]).map((r) => r.label),
      // What Hearth is tracking right now, so a reading that is missing can be told from one that is off.
      readingsOn: READINGS.filter((r) => hub.settings[r.key]).map((r) => r.label),
      sessionMinutes: v.sessionStartedAt ? Math.round((now - v.sessionStartedAt) / 60_000) : 0,
      minutesSinceLastBreak: v.sittingSince ? Math.round((now - v.sittingSince) / 60_000) : null,
      pulseBpm: round(v.pulse),
      pulseConfidencePct: round(v.pulseConfidence),
      breathingPerMin: round(v.breathing),
      breathingConfidencePct: round(v.breathingConfidence),
      hrvRmssdMs: round(v.hrvRmssd),
      blinksPerMinute: v.blinksPerMinute,
      blinksAvg5min: round(this.average('blinks', 5 * 60_000)),
      talking: v.talking,
      pulseAvg5min: round(this.average('pulse', 5 * 60_000)),
      pulseAvgPrev5min: round(this.average('pulse', 5 * 60_000, 5 * 60_000)),
      breathingAvg5min: round(this.average('breathing', 5 * 60_000)),
      pulseBaseline: round(this.baseline('pulse')),
      breathingBaseline: round(this.baseline('breathing')),
      // A rough estimate of the face's look, not of feelings; present only while the reading is on.
      ...(hub.settings.measureExpressions
        ? {
            facialExpression: {
              now:
                now - this.updated.expression < EXPRESSION_STALE_MS
                  ? (v.expression?.label ?? null)
                  : null,
              confidencePct: v.expression
                ? Math.round(
                    v.expression.confidence <= 1
                      ? v.expression.confidence * 100
                      : v.expression.confidence
                  )
                : null,
              sharePctLast5min: this.expressionShares(5 * 60_000),
              sharePctLastHour: this.expressionShares(HISTORY_MS)
            }
          }
        : {})
    }
  }
}

export const vitals = new VitalsTracker()
