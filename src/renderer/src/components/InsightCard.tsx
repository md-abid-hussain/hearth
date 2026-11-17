import { useState } from 'react'
import type { InsightEntry } from '@shared/types'
import { Markdown } from './Markdown'

function InsightList({
  title,
  items
}: {
  title: string
  items: string[]
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="insight-list">
      <div className="caps">{title}</div>
      <ul>
        {items.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

/** Structured view of a Presage insight; falls back to the original markdown until one exists. */
export function InsightCard({
  insight,
  lead,
  className
}: {
  insight: InsightEntry
  lead?: boolean
  className?: string
}): React.JSX.Element {
  const [showOriginal, setShowOriginal] = useState(false)
  const data = insight.structured
  if (!data || insight.isError) return <Markdown text={insight.text} className={className} />

  return (
    <div className={lead ? 'insight-card lead' : 'insight-card'}>
      {data.headline && <p className="insight-headline">{data.headline}</p>}
      {data.metrics.length > 0 && (
        <div className="insight-metrics">
          {data.metrics.map((m, idx) => (
            <div className="insight-metric" key={`${m.name}-${idx}`}>
              <div className="name">{m.name}</div>
              <div className="value">{m.value}</div>
              <span className={`insight-status ${m.status}`}>
                {m.status === 'unknown' ? 'n/a' : m.status}
              </span>
              {m.note && <div className="note">{m.note}</div>}
            </div>
          ))}
        </div>
      )}
      <InsightList title="Noticed" items={data.observations} />
      <InsightList title="Worth trying" items={data.suggestions} />
      <button className="link insight-toggle" onClick={() => setShowOriginal((v) => !v)}>
        {showOriginal ? 'Hide original' : 'Show original'}
      </button>
      {showOriginal && <Markdown text={insight.text} className="insight-original" />}
    </div>
  )
}
