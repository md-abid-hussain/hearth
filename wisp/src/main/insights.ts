import protobuf from 'protobufjs'
import type { InsightEntry } from '../shared/types'
import { hub } from './hub'
import { appendJsonl, newId, readJsonl } from './store'

const FILE = 'insights.jsonl'
const ON_DEMAND_TIMEOUT_MS = 30_000

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
    hub.insights = readJsonl<InsightEntry>(FILE).slice(-50)
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
    hub.record('insight', entry.onDemand ? 'Presage answered an on-demand question' : 'Presage sent a vitals insight', {
      requestId,
      preview: text.slice(0, 140)
    })

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

  recent(count: number): InsightEntry[] {
    return hub.insights.filter((i) => !i.isError).slice(-count)
  }
}

export const insights = new Insights()
