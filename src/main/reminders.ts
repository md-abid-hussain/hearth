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

export type AddCheckResult = { reminder: Reminder; replaced: boolean } | { error: string }

class Reminders {
  /**
   * Plain reminders survive a restart; check-ins do not, since they watch a camera session that
   * ended with the app.
   */
  load(): void {
    const now = Date.now()
    const saved = readJson<Reminder[]>(FILE, [])
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

  add(text: string, inMinutes: number): Reminder {
    const now = Date.now()
    const reminder: Reminder = {
      id: newId(),
      text,
      dueAt: now + Math.max(1, inMinutes) * 60_000,
      createdAt: now
    }
    hub.reminders.push(reminder)
    hub.record('reminder', `Reminder set: "${text}" in ${Math.round(inMinutes)} min`)
    this.persist()
    return reminder
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
