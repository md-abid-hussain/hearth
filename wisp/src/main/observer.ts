import { hub } from './hub'
import { complete } from './llm'
import { reminders } from './reminders'
import { vitals } from './vitals'

const TICK_MS = 30_000
const REVIEW_EVERY_MS = 3 * 60_000
const WARMUP_MS = 5 * 60_000
const MIN_GAP_MS = 15 * 60_000
const SAME_RULE_COOLDOWN_MS = 45 * 60_000
const MAX_PER_HOUR = 3
const QUIET_AFTER_CHAT_MS = 2 * 60_000

const SIT_LIMIT_MIN = 50
const PULSE_RISE_BPM = 15
const FAST_BREATHING_PER_MIN = 20

type RuleId = 'sit_break' | 'pulse_up' | 'fast_breathing' | 'reminder'

interface Candidate {
  rule: RuleId
  urgent: boolean
  facts: string
  fallback: string
  reminderId?: string
}

const NUDGE_SYSTEM = `You are Hearth, a calm desk companion. Write ONE short spoken sentence (max 22 words) gently nudging the user.
Plain words, no numbers unless essential, no medical language, no diagnosis. Offer, do not command.`

export type SpeakFn = (text: string) => Promise<void>

class Observer {
  private timer: NodeJS.Timeout | null = null
  private lastReviewAt = 0
  private lastNudgeAt = 0
  private lastByRule = new Map<RuleId, number>()
  private recentNudges: number[] = []
  private busy = false
  lastUserTurnAt = 0
  pttActive = false

  start(speakFn: SpeakFn): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(speakFn), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private candidates(): Candidate[] {
    const now = Date.now()
    const v = hub.vitals
    const out: Candidate[] = []

    for (const r of reminders.due(now)) {
      out.push({
        rule: 'reminder',
        urgent: true,
        reminderId: r.id,
        facts: `The user asked to be reminded: "${r.text}".`,
        fallback: `Hey, you asked me to remind you: ${r.text}.`
      })
    }
    if (!v.sensing || !v.present) return out

    const sittingMin = v.sittingSince ? (now - v.sittingSince) / 60_000 : 0
    if (sittingMin >= SIT_LIMIT_MIN) {
      out.push({
        rule: 'sit_break',
        urgent: false,
        facts: `The user has been at the desk for ${Math.round(sittingMin)} minutes without stepping away.`,
        fallback: "You've been at it for a while. Want to stand up and stretch for a minute?"
      })
    }

    const base = vitals.baseline('pulse')
    const recent = vitals.average('pulse', 5 * 60_000)
    if (base && recent && recent - base >= PULSE_RISE_BPM && (v.pulseConfidence ?? 0) >= 40) {
      out.push({
        rule: 'pulse_up',
        urgent: false,
        facts: `Estimated pulse has been noticeably above the user's own session baseline for about five minutes.`,
        fallback: 'Things look a bit revved up. Fancy three slow breaths with me?'
      })
    }

    const breathing = vitals.average('breathing', 3 * 60_000)
    if (breathing && breathing >= FAST_BREATHING_PER_MIN && (v.breathingConfidence ?? 0) >= 45) {
      out.push({
        rule: 'fast_breathing',
        urgent: false,
        facts: 'Estimated breathing has been on the quick side for a few minutes.',
        fallback: 'Your breathing seems a little quick. A slow exhale might feel nice.'
      })
    }
    return out
  }

  /** Every reason Hearth should stay silent right now, empty when it may speak. */
  private blockers(c: Candidate): string[] {
    const now = Date.now()
    const v = hub.vitals
    const s = hub.settings
    const reasons: string[] = []
    if (s.quietMode) reasons.push('quiet mode is on')
    if (!s.nudgesEnabled && !c.urgent) reasons.push('nudges are turned off')
    if (this.pttActive) reasons.push('user is holding push-to-talk')
    if (hub.mood === 'speaking' || hub.mood === 'thinking') reasons.push('Hearth is mid-reply')
    if (v.talking) reasons.push('user appears to be talking')
    if (now - this.lastUserTurnAt < QUIET_AFTER_CHAT_MS) reasons.push('just chatted with the user')
    if (c.urgent) return reasons

    if (v.sessionStartedAt && now - v.sessionStartedAt < WARMUP_MS) reasons.push('still warming up')
    if (now - this.lastNudgeAt < MIN_GAP_MS) reasons.push('spoke less than 15 minutes ago')
    if (now - (this.lastByRule.get(c.rule) ?? 0) < SAME_RULE_COOLDOWN_MS) reasons.push('same nudge given recently')
    this.recentNudges = this.recentNudges.filter((t) => now - t < 60 * 60_000)
    if (this.recentNudges.length >= MAX_PER_HOUR) reasons.push('hourly nudge budget used')
    return reasons
  }

  private async tick(speakFn: SpeakFn): Promise<void> {
    if (this.busy) return
    const now = Date.now()
    const due = reminders.due(now).length > 0
    if (!due && now - this.lastReviewAt < REVIEW_EVERY_MS) return
    this.lastReviewAt = now

    const candidates = this.candidates()
    if (!candidates.length) return
    const pick = candidates.find((c) => c.urgent) ?? candidates[0]
    const blockers = this.blockers(pick)
    if (blockers.length) {
      hub.record('suppressed', `Held back "${pick.rule}": ${blockers.join(', ')}`, { rule: pick.rule, reasons: blockers })
      return
    }

    this.busy = true
    try {
      let line = pick.fallback
      try {
        line = (await complete(NUDGE_SYSTEM, pick.facts)) || pick.fallback
      } catch {
        // Template line is fine when the LLM is unavailable.
      }
      this.lastNudgeAt = Date.now()
      this.lastByRule.set(pick.rule, this.lastNudgeAt)
      if (!pick.urgent) this.recentNudges.push(this.lastNudgeAt)
      if (pick.reminderId) reminders.complete(pick.reminderId)
      hub.record(pick.rule === 'reminder' ? 'reminder' : 'nudge', line, { rule: pick.rule })
      hub.lastReply = line
      await speakFn(line)
    } finally {
      this.busy = false
    }
  }
}

export const observer = new Observer()
