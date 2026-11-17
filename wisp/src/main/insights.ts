import protobuf from 'protobufjs'
import { generateText, Output } from 'ai'
import { z } from 'zod'
import type { InsightEntry, InsightStructured } from '../shared/types'
import { llmKeyPresent, loadConfig } from './config'
import { hub } from './hub'
import { getModel, providerOptions } from './llm'
import { appendJsonl, newId, readJsonl } from './store'

const FILE = 'insights.jsonl'
const ON_DEMAND_TIMEOUT_MS = 30_000

const STRUCTURE_SYSTEM = `You turn a wellness insight written in markdown into structured fields.
Extract only what the text says. Never invent, estimate, convert or round numbers; copy each value exactly as written, with its unit. If the text gives no metrics, return an empty metrics list.
Metric status: "good" when the text calls it normal, healthy or steady; "watch" when it flags something to keep an eye on; "low" or "high" when it says below or above the usual range; otherwise "unknown". note is a short qualifier from the text, or null.
headline: one short, calm sentence summarizing the text. observations: what the text notices. suggestions: what the text recommends. Keep each item brief.
Use plain wellness wording. Do not diagnose or add medical claims that the text does not make.`

/** Strict structured-output providers need every key present, so note is nullable here. */
const StructuredSchema = z.object({
  headline: z.string(),
  metrics: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      status: z.enum(['good', 'watch', 'low', 'high', 'unknown']),
      note: z.string().nullable()
    })
  ),
  observations: z.array(z.string()),
  suggestions: z.array(z.string())
})

/** insights.jsonl is append-only; a structured view lands later as its own line. */
interface StructuredRecord {
  structuredFor: string
  structured: InsightStructured
}

const isStructuredRecord = (row: InsightEntry | StructuredRecord): row is StructuredRecord =>
  'structuredFor' in row

/** The Node SDK ships no Insight decoder; schema from SmartSpectra docs/data-types.md. */
const Insight = protobuf.Root.fromJSON({
  nested: {
    Insight: {
      oneofs: { result: { oneof: ['analysis', 'error'] } },
      fields: {
        requestId: { type: 'int32', id: 1 },
        processedAt: { type: 'string', id: 2 },
        analysis: { type: 'string', id: 3 },
        error: { type: 'string', id: 4 },
        type: { type: 'int32', id: 5 }
      }
    }
  }
}).lookupType('Insight')

interface DecodedInsight {
  requestId?: number
  analysis?: string
  error?: string
}

type Waiter = { resolve: (entry: InsightEntry | null) => void; timer: NodeJS.Timeout }

class Insights {
  private pendingTokens = new Map<string, Waiter>()
  private tokenByRequest = new Map<number, string>()

  load(): void {
    const rows = readJsonl<InsightEntry | StructuredRecord>(FILE)
    const structured = new Map<string, InsightStructured>()
    for (const row of rows)
      if (isStructuredRecord(row)) structured.set(row.structuredFor, row.structured)
    hub.insights = rows
      .filter((row): row is InsightEntry => !isStructuredRecord(row))
      .slice(-50)
      .map((entry) =>
        structured.has(entry.id) ? { ...entry, structured: structured.get(entry.id) } : entry
      )
  }

  ingest(buf: Uint8Array, requestId: number): void {
    const decoded = Insight.toObject(Insight.decode(buf)) as DecodedInsight
    const text = decoded.analysis || decoded.error || ''
    if (!text) return
    const token = this.tokenByRequest.get(requestId)
    const entry: InsightEntry = {
      id: newId(),
      requestId,
      at: Date.now(),
      text,
      isError: !decoded.analysis,
      onDemand: Boolean(token)
    }
    hub.insights.push(entry)
    if (hub.insights.length > 50) hub.insights.shift()
    appendJsonl(FILE, entry)
    hub.record(
      'insight',
      entry.onDemand ? 'Presage answered an on-demand question' : 'Presage sent a vitals insight',
      {
        requestId,
        preview: text.slice(0, 140)
      }
    )
    if (!entry.isError) void this.structure(entry.id, text)

    if (token) {
      this.tokenByRequest.delete(requestId)
      const waiter = this.pendingTokens.get(token)
      if (waiter) {
        clearTimeout(waiter.timer)
        this.pendingTokens.delete(token)
        waiter.resolve(entry)
      }
    }
  }

  /** Asks the renderer-side SDK to dispatch a prompt; resolves with the matching insight or null. */
  request(prompt: string): Promise<InsightEntry | null> {
    if (!hub.vitals.sensing) return Promise.resolve(null)
    const token = newId()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTokens.delete(token)
        resolve(null)
      }, ON_DEMAND_TIMEOUT_MS)
      this.pendingTokens.set(token, { resolve, timer })
      hub.send({ type: 'requestInsight', token, prompt })
    })
  }

  bindRequest(token: string, requestId: number): void {
    if (this.pendingTokens.has(token)) this.tokenByRequest.set(requestId, token)
  }

  failRequest(token: string): void {
    const waiter = this.pendingTokens.get(token)
    if (!waiter) return
    clearTimeout(waiter.timer)
    this.pendingTokens.delete(token)
    waiter.resolve(null)
  }

  /** Background extraction with the cheap model; on any failure the markdown stays as-is. */
  private async structure(id: string, text: string): Promise<void> {
    if (!llmKeyPresent(loadConfig())) return
    try {
      const { output } = await generateText({
        model: getModel(),
        system: STRUCTURE_SYSTEM,
        prompt: text,
        output: Output.object({ schema: StructuredSchema }),
        maxRetries: 1,
        providerOptions: providerOptions('low')
      })
      const structured: InsightStructured = {
        ...output,
        metrics: output.metrics.map(({ note, ...metric }) => (note ? { ...metric, note } : metric))
      }
      const entry = hub.insights.find((i) => i.id === id)
      if (!entry) return
      entry.structured = structured
      appendJsonl(FILE, { structuredFor: id, structured } satisfies StructuredRecord)
      hub.changed()
    } catch (err) {
      hub.record(
        'error',
        `Could not structure a Presage insight (${(err as Error).name}); showing it as written`
      )
    }
  }

  recent(count: number): InsightEntry[] {
    return hub.insights.filter((i) => !i.isError).slice(-count)
  }
}

export const insights = new Insights()
