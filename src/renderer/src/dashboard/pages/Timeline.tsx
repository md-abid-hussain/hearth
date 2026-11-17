import { useMemo, useState } from 'react'
import { SegmentedControl } from '@mantine/core'
import type { LogEntry, LogKind } from '@shared/types'
import { clock } from '../helpers'
import { PageHeader } from '../shared'

const WHO: Record<LogKind, { label: string; tone: '' | 'amber' | 'dim' }> = {
  session: { label: 'Session', tone: 'dim' },
  insight: { label: 'Presage', tone: '' },
  ptt: { label: 'You', tone: '' },
  reply: { label: 'Hearth', tone: 'amber' },
  tool: { label: 'Tool', tone: 'dim' },
  nudge: { label: 'Hearth / nudge', tone: 'amber' },
  suppressed: { label: 'Observer / held back', tone: 'dim' },
  reminder: { label: 'Reminder', tone: 'amber' },
  mcp: { label: 'Connector', tone: 'dim' },
  memory: { label: 'Memory', tone: 'dim' },
  error: { label: 'Error', tone: 'dim' }
}

const FILTERS: Record<string, LogKind[] | null> = {
  all: null,
  observer: ['nudge', 'suppressed', 'reminder'],
  conversation: ['ptt', 'reply', 'tool', 'memory'],
  system: ['session', 'insight', 'mcp', 'error']
}

export function Timeline({ log }: { log: LogEntry[] }): React.JSX.Element {
  const [filter, setFilter] = useState('all')
  const items = useMemo(() => {
    const kinds = FILTERS[filter]
    return log
      .filter((e) => !kinds || kinds.includes(e.kind))
      .slice(-200)
      .reverse()
  }, [log, filter])

  return (
    <div className="page-inner">
      <PageHeader
        eyebrow="Timeline"
        title="Everything Hearth did, and didn't."
        intro="The observer reviews your signals every three minutes. Each time it decides to stay quiet, the reason is written here."
      />
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="log-head">
          <span className="label">{items.length} events</span>
          <SegmentedControl
            size="xs"
            value={filter}
            onChange={setFilter}
            data={[
              { label: 'ALL', value: 'all' },
              { label: 'OBSERVER', value: 'observer' },
              { label: 'CONVERSATION', value: 'conversation' },
              { label: 'SYSTEM', value: 'system' }
            ]}
          />
        </div>
        {items.length === 0 && (
          <div className="entry">
            <span className="t">--:--</span>
            <div className="body empty">Nothing here yet.</div>
          </div>
        )}
        {items.map((e) => {
          const who = WHO[e.kind]
          return (
            <div className="entry" key={e.id}>
              <span className="t">{clock(e.at)}</span>
              <div>
                <div
                  className={`who ${who.tone}`}
                  style={e.kind === 'error' ? { color: 'var(--red)' } : undefined}
                >
                  {who.label}
                </div>
                <div className={e.kind === 'reply' || e.kind === 'nudge' ? 'body voice' : 'body'}>
                  {e.message}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
