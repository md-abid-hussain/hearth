import type { ChatTurn } from '../shared/types'
import { hub } from './hub'
import { complete } from './llm'
import { appendJsonl, readJson, readJsonl, writeJson, writeJsonl } from './store'

const TURNS_FILE = 'turns.jsonl'
const ARCHIVE_FILE = 'turns-archive.jsonl'
const MEMORY_FILE = 'memory.json'

const COMPACT_AFTER_TURNS = 20
const COMPACT_AFTER_CHARS = 6_000
const KEEP_RECENT_TURNS = 8
const MAX_PINS = 30

interface Persisted {
  summary: string
  pins: string[]
  compactions: number
}

const COMPACT_SYSTEM = `You maintain the long-term memory of Wisp, a desk companion.
Merge the previous summary with the older conversation turns into one updated summary.
Keep: the user's ongoing tasks and goals, preferences about how Wisp should behave, promises Wisp made, and recurring patterns the user mentioned.
Drop: greetings, small talk, raw vitals numbers, anything already resolved.
Write at most 12 short bullet lines in plain text. No health diagnoses.`

class Memory {
  private compacting = false

  load(): void {
    const saved = readJson<Persisted>(MEMORY_FILE, { summary: '', pins: [], compactions: 0 })
    hub.memory = { ...saved, turns: readJsonl<ChatTurn>(TURNS_FILE) }
  }

  private persist(): void {
    const { summary, pins, compactions } = hub.memory
    writeJson(MEMORY_FILE, { summary, pins, compactions })
    hub.changed()
  }

  add(role: ChatTurn['role'], text: string): void {
    const turn: ChatTurn = { role, text, at: Date.now() }
    hub.memory.turns.push(turn)
    appendJsonl(TURNS_FILE, turn)
    hub.changed()
  }

  recentTurns(): ChatTurn[] {
    return hub.memory.turns.slice(-KEEP_RECENT_TURNS * 2)
  }

  pin(fact: string): string[] {
    const clean = fact.trim()
    if (clean && !hub.memory.pins.includes(clean)) {
      hub.memory.pins.push(clean)
      if (hub.memory.pins.length > MAX_PINS) hub.memory.pins.shift()
      hub.record('memory', `Pinned: ${clean}`)
      this.persist()
    }
    return hub.memory.pins
  }

  unpin(index: number): void {
    const [removed] = hub.memory.pins.splice(index, 1)
    if (removed) {
      hub.record('memory', `Unpinned: ${removed}`)
      this.persist()
    }
  }

  clear(): void {
    hub.memory = { summary: '', pins: [], turns: [], compactions: 0 }
    writeJsonl(TURNS_FILE, [])
    this.persist()
  }

  needsCompaction(): boolean {
    const turns = hub.memory.turns
    const chars = turns.reduce((n, t) => n + t.text.length, 0)
    return turns.length > COMPACT_AFTER_TURNS || chars > COMPACT_AFTER_CHARS
  }

  async compactIfNeeded(): Promise<void> {
    if (this.compacting || !this.needsCompaction()) return
    this.compacting = true
    try {
      const turns = hub.memory.turns
      const older = turns.slice(0, -KEEP_RECENT_TURNS)
      const recent = turns.slice(-KEEP_RECENT_TURNS)
      const transcript = older.map((t) => `${t.role === 'user' ? 'User' : 'Wisp'}: ${t.text}`).join('\n')
      const summary = await complete(
        COMPACT_SYSTEM,
        `Previous summary:\n${hub.memory.summary || '(none)'}\n\nOlder turns:\n${transcript}`
      )
      older.forEach((t) => appendJsonl(ARCHIVE_FILE, t))
      writeJsonl(TURNS_FILE, recent)
      hub.memory = { ...hub.memory, summary, turns: recent, compactions: hub.memory.compactions + 1 }
      hub.record('memory', `Compacted ${older.length} turns into the summary`)
      this.persist()
    } catch (err) {
      hub.record('error', `Memory compaction failed: ${(err as Error).message}`)
    } finally {
      this.compacting = false
    }
  }
}

export const memory = new Memory()
