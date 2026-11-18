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
/**
 * Pinned facts go into every system prompt. Once full, a new pin is refused rather than pushing
 * out the oldest, so text read from an app can never flush out what the user asked to keep.
 */
const MAX_PINS = 30
/** A pinned fact is one short sentence; longer text is refused. */
export const MAX_FACT_CHARS = 200

export type PinResult = { pins: number } | { error: string }

interface Persisted {
  summary: string
  pins: string[]
  compactions: number
}

const COMPACT_SYSTEM = `You maintain the long-term memory of Hearth, a desk companion.
Merge the previous summary with the older conversation turns into one updated summary.
Keep: the user's ongoing tasks and goals, preferences about how Hearth should behave, promises Hearth made, and recurring patterns the user mentioned.
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

  pin(fact: string): PinResult {
    const clean = fact.trim()
    const pins = hub.memory.pins
    if (!clean || pins.includes(clean)) return { pins: pins.length }
    if (clean.length > MAX_FACT_CHARS)
      return { error: `Too long to pin; keep it under ${MAX_FACT_CHARS} characters.` }
    if (pins.length >= MAX_PINS)
      return {
        error: `Memory already holds ${MAX_PINS} pinned facts. Ask the user to unpin some on the Memory page first.`
      }
    pins.push(clean)
    hub.record('memory', `Pinned: ${clean}`)
    this.persist()
    return { pins: pins.length }
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
      const older = hub.memory.turns.slice(0, -KEEP_RECENT_TURNS)
      // A few long turns can pass the size limit with nothing old enough to summarise.
      if (!older.length) return
      const transcript = older
        .map((t) => `${t.role === 'user' ? 'User' : 'Hearth'}: ${t.text}`)
        .join('\n')
      const summary = await complete(
        COMPACT_SYSTEM,
        `Previous summary:\n${hub.memory.summary || '(none)'}\n\nOlder turns:\n${transcript}`
      )
      // Memory was cleared while the summary was written: it must not bring the old turns back.
      if (hub.memory.turns[0] !== older[0]) return
      // Everything not summarised stays, including turns added while the summary was written.
      const kept = hub.memory.turns.slice(older.length)
      older.forEach((t) => appendJsonl(ARCHIVE_FILE, t))
      writeJsonl(TURNS_FILE, kept)
      hub.memory = {
        ...hub.memory,
        summary,
        turns: kept,
        compactions: hub.memory.compactions + 1
      }
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
