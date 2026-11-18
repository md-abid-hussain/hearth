import { Notification } from 'electron'
import { FOCUS_FALLBACK, FOCUS_LABEL, readCheck } from './checks'
import { timing } from './demo'
import { hub } from './hub'
import { complete } from './llm'
import { reminders } from './reminders'
import { vitals } from './vitals'

/** Observer timings; HEARTH_DEMO=1 shortens them for recording a demo. */
const T = {
  get tick(): number {
    return timing(30_000, 10_000)
  },
  get reviewEvery(): number {
    return timing(3 * 60_000, 20_000)
  },
  get warmup(): number {
    return timing(5 * 60_000, 30_000)
  },
  get minGap(): number {
    return timing(15 * 60_000, 2 * 60_000)
  },
  get sameRuleCooldown(): number {
    return timing(45 * 60_000, 10 * 60_000)
  },
  get maxPerHour(): number {
    return timing(3, 8)
  },
  get quietAfterChat(): number {
    return timing(2 * 60_000, 20_000)
  },
  get sitLimitMin(): number {
    return timing(50, 3)
  }
}

const PULSE_RISE_BPM = 15
const FAST_BREATHING_PER_MIN = 20

type RuleId = 'sit_break' | 'pulse_up' | 'fast_breathing' | 'reminder' | 'check'

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

/** One spoken sentence for a candidate; the template line when the language model is unavailable. */
async function phrase(c: Candidate): Promise<string> {
  try {
    return (await complete(NUDGE_SYSTEM, c.facts)) || c.fallback
  } catch {
    return c.fallback
  }
}

/** A Windows notification that opens the dashboard when clicked. */
function showNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const note = new Notification({ title, body })
  note.on('click', () => {
    const win = hub.window('dashboard')
    win?.show()
    win?.focus()
    hub.send({ type: 'showPage', page: 'reminders' })
  })
  note.show()
}

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
    this.timer = setInterval(() => void this.tick(speakFn), T.tick)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Runs the check-ins that are due. Fine readings reschedule silently, a lost signal ends the
   * check-in, and anything off comes back as an urgent candidate to say (or to notify in quiet
   * mode). A check-in that cannot be said yet stays due and is read again on the next tick.
   */
  private dueCheckAlerts(now: number): Candidate[] {
    const alerts: Candidate[] = []
    for (const r of reminders.dueChecks(now)) {
      const check = r.check!
      const label = FOCUS_LABEL[check.focus]
      const result = readCheck(check.focus, check.everyMin)
      if (result.status === 'warming' && reminders.waitCheck(r.id)) continue
      if (result.status === 'no_signal' || result.status === 'warming') {
        reminders.complete(r.id)
        const why = result.status === 'warming' ? 'the signal never settled' : result.facts
        hub.record('reminder', `Stopped watching ${label}: ${why}`, {
          rule: 'check',
          via: 'stopped'
        })
        continue
      }
      if (result.status === 'ok') {
        reminders.advanceCheck(r.id)
        hub.record('reminder', `Checked ${label}: fine. ${result.facts}`, {
          rule: 'check',
          via: 'fine'
        })
        continue
      }
      alerts.push({
        rule: 'check',
        urgent: true,
        reminderId: r.id,
        facts: `The user asked you to keep an eye on ${label}, and it looks off right now: ${result.facts} Mention what you noticed and offer one small thing to do about it.`,
        fallback: FOCUS_FALLBACK[check.focus]
      })
    }
    return alerts
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
    if (sittingMin >= T.sitLimitMin) {
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
    if (now - this.lastUserTurnAt < T.quietAfterChat) reasons.push('just chatted with the user')
    if (c.urgent) return reasons

    if (v.sessionStartedAt && now - v.sessionStartedAt < T.warmup) reasons.push('still warming up')
    if (now - this.lastNudgeAt < T.minGap) reasons.push('spoke a short while ago')
    if (now - (this.lastByRule.get(c.rule) ?? 0) < T.sameRuleCooldown)
      reasons.push('same nudge given recently')
    this.recentNudges = this.recentNudges.filter((t) => now - t < 60 * 60_000)
    if (this.recentNudges.length >= T.maxPerHour) reasons.push('hourly nudge budget used')
    return reasons
  }

  /**
   * Quiet mode never speaks, so a due reminder becomes a Windows notification instead, and is
   * logged like a spoken one so the Reminders page lists it.
   */
  private notifyDueReminders(now: number): void {
    for (const r of reminders.due(now)) {
      reminders.fired(r.id)
      showNotification('Hearth reminder', r.text)
      hub.record('reminder', r.text, { rule: 'reminder', via: 'notification' })
    }
  }

  private async notifyCheckAlerts(alerts: Candidate[]): Promise<void> {
    for (const alert of alerts) {
      const line = await phrase(alert)
      reminders.advanceCheck(alert.reminderId!)
      showNotification('Hearth check-in', line)
      hub.record('reminder', line, { rule: 'check', via: 'notification' })
    }
  }

  private async tick(speakFn: SpeakFn): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.review(speakFn)
    } finally {
      this.busy = false
    }
  }

  private async review(speakFn: SpeakFn): Promise<void> {
    const now = Date.now()
    let alerts = this.dueCheckAlerts(now)
    if (hub.settings.quietMode) {
      this.notifyDueReminders(now)
      await this.notifyCheckAlerts(alerts)
      alerts = []
    }
    const due = reminders.due(now).length > 0 || alerts.length > 0
    if (!due && now - this.lastReviewAt < T.reviewEvery) return
    this.lastReviewAt = now

    const candidates = [...alerts, ...this.candidates()]
    if (!candidates.length) return
    const pick = candidates.find((c) => c.urgent) ?? candidates[0]
    const blockers = this.blockers(pick)
    if (blockers.length) {
      hub.record('suppressed', `Held back "${pick.rule}": ${blockers.join(', ')}`, {
        rule: pick.rule,
        reasons: blockers
      })
      return
    }

    const line = await phrase(pick)
    this.lastNudgeAt = Date.now()
    this.lastByRule.set(pick.rule, this.lastNudgeAt)
    if (!pick.urgent) this.recentNudges.push(this.lastNudgeAt)
    if (pick.reminderId && pick.rule === 'check') reminders.advanceCheck(pick.reminderId)
    else if (pick.reminderId) reminders.fired(pick.reminderId)
    const spokenReminder = pick.rule === 'reminder' || pick.rule === 'check'
    hub.record(spokenReminder ? 'reminder' : 'nudge', line, {
      rule: pick.rule,
      ...(spokenReminder ? { via: 'spoken' } : {})
    })
    hub.lastReply = line
    await speakFn(line)
  }
}

export const observer = new Observer()
