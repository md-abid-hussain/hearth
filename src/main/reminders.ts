import type { CheckFocus, Reminder } from '../shared/types'
import { FOCUS_LABEL } from './checks'
import { hub } from './hub'
import { newId, readJson, writeJson } from './store'

const FILE = 'reminders.json'
/** Check-ins Hearth may run at once; a new one on the same focus replaces the old one. */
export const MAX_CHECKS = 3
const MAX_RUNS = 24
/** A reminder that came due this long before Hearth started again is dropped, not said late. */
const STALE_AFTER_MS = 60 * 60_000
/** While a signal settles, a check-in waits a minute at a time, at most this many times. */
const MAX_WAITS = 5
/** A repeating reminder is said at most this many times in all. */
export const MAX_REPEATS = 10
/**
 * Plain reminders that may wait at once. Each is listed in every system prompt, and a cap keeps
 * text read from an app from filling the list.
 */
export const MAX_REMINDERS = 20
/** A reminder is a short task; longer text is refused. */
export const MAX_REMINDER_CHARS = 150
/** A repeat said late never comes round again sooner than this, even if a slot is that close. */
const MIN_REPEAT_GAP_MS = 60_000

export type AddCheckResult = { reminder: Reminder; replaced: boolean } | { error: string }
export type AddResult = { reminder: Reminder } | { error: string }

/**
 * The next time a repeat is due after being said at `now`: whole intervals on from `dueAt`, so
 * the user's rhythm holds even when one was said late, and never sooner than a minute (or half
 * the interval, for a very short one) away.
 */
export function nextRepeatAt(dueAt: number, everyMs: number, now: number): number {
  const gap = Math.min(MIN_REPEAT_GAP_MS, everyMs / 2)
  const slots = Math.max(1, Math.ceil((now + gap - dueAt) / everyMs))
  return dueAt + slots * everyMs
}

class Reminders {
  /**
   * Plain reminders survive a restart; check-ins do not, since they watch a camera session that
   * ended with the app.
   */
  load(): void {
    const now = Date.now()
    const saved = readJson<Reminder[]>(FILE, [])
    // A repeating reminder skips the times it missed while Hearth was closed and carries on.
    for (const r of saved) {
      if (!r.repeat) continue
      while (now - r.dueAt >= STALE_AFTER_MS && r.repeat.left > 1) {
        r.dueAt += r.repeat.everyMin * 60_000
        r.repeat = { ...r.repeat, left: r.repeat.left - 1 }
      }
    }
    const kept = saved.filter((r) => !r.check && now - r.dueAt < STALE_AFTER_MS)
    for (const r of saved) {
      if (r.check) continue
      if (!kept.includes(r))
        hub.record('reminder', `Missed while Hearth was closed: "${r.text}"`, {
          rule: 'reminder',
          via: 'missed'
        })
    }
    hub.reminders = kept
    if (kept.length !== saved.length) this.persist()
  }

  private persist(): void {
    hub.reminders.sort((a, b) => a.dueAt - b.dueAt)
    writeJson(FILE, hub.reminders)
    hub.changed()
  }

  /**
   * A reminder said once, or with `repeat`, every `everyMin` minutes for `times` times in all (at
   * most MAX_REPEATS). Hearth schedules each repeat itself; cancelling stops the whole series.
   */
  add(text: string, inMinutes: number, repeat?: { everyMin: number; times: number }): AddResult {
    if (text.length > MAX_REMINDER_CHARS)
      return { error: `Too long; keep the reminder under ${MAX_REMINDER_CHARS} characters.` }
    const waiting = hub.reminders.filter((r) => !r.check).length
    if (waiting >= MAX_REMINDERS)
      return {
        error: `Already ${MAX_REMINDERS} reminders waiting. Ask the user to cancel some on the Reminders page first.`
      }
    const now = Date.now()
    const reminder: Reminder = {
      id: newId(),
      text,
      dueAt: now + Math.max(1, inMinutes) * 60_000,
      createdAt: now
    }
    const times = repeat ? Math.min(MAX_REPEATS, Math.max(1, Math.round(repeat.times))) : 1
    if (repeat && times > 1)
      reminder.repeat = { everyMin: Math.max(1, Math.round(repeat.everyMin)), left: times }
    hub.reminders.push(reminder)
    hub.record(
      'reminder',
      reminder.repeat
        ? `Reminder set: "${text}" in ${Math.round(inMinutes)} min, then every ${reminder.repeat.everyMin} min, ${times} times in all`
        : `Reminder set: "${text}" in ${Math.round(inMinutes)} min`
    )
    this.persist()
    return { reminder }
  }

  /**
   * A plain reminder was said or shown: schedule its next repeat, or remove it. Only the one said
   * counts against the repeats left; slots skipped because it came late do not.
   */
  fired(id: string): void {
    const r = hub.reminders.find((x) => x.id === id)
    if (!r?.repeat || r.repeat.left <= 1) {
      this.complete(id)
      return
    }
    r.dueAt = nextRepeatAt(r.dueAt, r.repeat.everyMin * 60_000, Date.now())
    r.repeat = { ...r.repeat, left: r.repeat.left - 1 }
    this.persist()
  }

  checks(): Reminder[] {
    return hub.reminders.filter((r) => r.check)
  }

  addCheck(focus: CheckFocus, everyMin: number, forMin: number): AddCheckResult {
    const existing = this.checks().find((r) => r.check?.focus === focus)
    if (!existing && this.checks().length >= MAX_CHECKS)
      return {
        error: `Already running ${MAX_CHECKS} check-ins (${this.checks()
          .map((r) => r.text)
          .join(', ')}). Cancel one first.`
      }
    if (existing) hub.reminders = hub.reminders.filter((r) => r !== existing)
    const now = Date.now()
    const every = Math.max(1, Math.round(everyMin))
    const reminder: Reminder = {
      id: newId(),
      text: `Watch ${FOCUS_LABEL[focus]}`,
      dueAt: now + every * 60_000,
      createdAt: now,
      check: {
        focus,
        everyMin: every,
        runsLeft: Math.min(MAX_RUNS, Math.max(1, Math.round(forMin / every))),
        waits: 0
      }
    }
    hub.reminders.push(reminder)
    hub.record(
      'reminder',
      `Check-in set: ${FOCUS_LABEL[focus]} every ${every} min, ${reminder.check!.runsLeft} times`,
      { rule: 'check-set', focus }
    )
    this.persist()
    return { reminder, replaced: Boolean(existing) }
  }

  /** A check-in ran: schedule the next one, or end it when its runs are used up. */
  advanceCheck(id: string): boolean {
    const r = hub.reminders.find((x) => x.id === id)
    if (!r?.check) return false
    const runsLeft = r.check.runsLeft - 1
    if (runsLeft <= 0) {
      this.complete(id)
      hub.record('reminder', `Finished watching ${FOCUS_LABEL[r.check.focus]}`, {
        rule: 'check',
        via: 'finished'
      })
      return false
    }
    r.check = { ...r.check, runsLeft, waits: 0 }
    r.dueAt = Date.now() + r.check.everyMin * 60_000
    this.persist()
    return true
  }

  /** The signal is still settling: try again in a minute without using up a run. */
  waitCheck(id: string): boolean {
    const r = hub.reminders.find((x) => x.id === id)
    if (!r?.check || r.check.waits >= MAX_WAITS) return false
    r.check = { ...r.check, waits: r.check.waits + 1 }
    r.dueAt = Date.now() + 60_000
    this.persist()
    return true
  }

  cancel(id: string): boolean {
    const before = hub.reminders.length
    hub.reminders = hub.reminders.filter((r) => r.id !== id)
    if (hub.reminders.length === before) return false
    hub.record('reminder', 'Reminder cancelled')
    this.persist()
    return true
  }

  /** Plain reminders that are due; check-ins come from dueChecks. */
  due(now = Date.now()): Reminder[] {
    return hub.reminders.filter((r) => !r.check && r.dueAt <= now)
  }

  dueChecks(now = Date.now()): Reminder[] {
    return hub.reminders.filter((r) => r.check && r.dueAt <= now)
  }

  complete(id: string): void {
    hub.reminders = hub.reminders.filter((r) => r.id !== id)
    this.persist()
  }
}

export const reminders = new Reminders()
