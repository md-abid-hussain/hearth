import type { Reminder } from '../shared/types'
import { hub } from './hub'
import { newId, readJson, writeJson } from './store'

const FILE = 'reminders.json'

class Reminders {
  load(): void {
    hub.reminders = readJson<Reminder[]>(FILE, [])
  }

  private persist(): void {
    writeJson(FILE, hub.reminders)
    hub.changed()
  }

  add(text: string, inMinutes: number): Reminder {
    const now = Date.now()
    const reminder: Reminder = { id: newId(), text, dueAt: now + Math.max(1, inMinutes) * 60_000, createdAt: now }
    hub.reminders.push(reminder)
    hub.reminders.sort((a, b) => a.dueAt - b.dueAt)
    hub.record('reminder', `Reminder set: "${text}" in ${Math.round(inMinutes)} min`)
    this.persist()
    return reminder
  }

  cancel(id: string): boolean {
    const before = hub.reminders.length
    hub.reminders = hub.reminders.filter((r) => r.id !== id)
    if (hub.reminders.length === before) return false
    hub.record('reminder', 'Reminder cancelled')
    this.persist()
    return true
  }

  due(now = Date.now()): Reminder[] {
    return hub.reminders.filter((r) => r.dueAt <= now)
  }

  complete(id: string): void {
    hub.reminders = hub.reminders.filter((r) => r.id !== id)
    this.persist()
  }
}

export const reminders = new Reminders()
