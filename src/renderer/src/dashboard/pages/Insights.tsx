import type { InsightEntry } from '@shared/types'
import { InsightCard } from '../../components/InsightCard'
import { clock } from '../helpers'
import { PageHeader } from '../shared'

export function Insights({ insights }: { insights: InsightEntry[] }): React.JSX.Element {
  const items = [...insights].reverse()
  const [first, ...rest] = items

  return (
    <div className="page-inner">
      <PageHeader
        eyebrow="Insights"
        title="What Presage noticed."
        intro="Presage's own LLM writes these from your measured numbers, never from video. The first arrives after a stable pulse, then about every minute. Hearth can also ask on demand."
      />
      {!first && (
        <p className="empty">No insights yet. Start sensing and give it fifteen seconds or so.</p>
      )}
      {first && (
        <div className="card pop quote" style={{ maxWidth: 760 }}>
          <div className="mark">&ldquo;</div>
          <InsightCard insight={first} lead className="quote-body" />
          <div className="quote-foot">
            <span className="label">Latest, {clock(first.at)}</span>
            <span className={first.isError ? 'tag no' : 'chip'}>
              {first.isError ? 'error' : first.onDemand ? 'asked by Hearth' : 'automatic'}
            </span>
          </div>
        </div>
      )}
      {rest.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {rest.map((i) => (
            <div className="entry" key={i.id}>
              <span className="t">{clock(i.at)}</span>
              <div>
                <div className="who" style={i.isError ? { color: 'var(--red)' } : undefined}>
                  {i.isError
                    ? 'Presage, error'
                    : i.onDemand
                      ? 'Presage, asked by Hearth'
                      : 'Presage'}
                </div>
                <InsightCard insight={i} className={i.isError ? 'body' : 'body voice'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
