import { ActionIcon } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import type { MemoryState } from '@shared/types'
import { PageHeader, clock } from '../shared'

export function Memory({ memory }: { memory: MemoryState }): React.JSX.Element {
  return (
    <div className="page-inner">
      <PageHeader
        eyebrow="Memory"
        title="What Wisp keeps in mind."
        intro="Recent turns are kept word for word. Older ones are folded into a short summary so Wisp remembers without rereading everything."
      />
      <div className="grid-2">
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="log-head">
            <span className="caps">Conversation</span>
            <span className="label">{memory.turns.length} recent turns</span>
          </div>
          {memory.turns.length === 0 && (
            <div className="entry"><span className="t">--:--</span><div className="body empty">Say hello to Wisp and it will show up here.</div></div>
          )}
          {memory.turns.map((t, i) => (
            <div className="entry" key={`${t.at}-${i}`}>
              <span className="t">{clock(t.at)}</span>
              <div>
                <div className={t.role === 'user' ? 'who' : 'who amber'}>{t.role === 'user' ? 'You' : 'Wisp'}</div>
                <div className={t.role === 'user' ? 'body' : 'body voice'}>{t.text}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div className="card pop panel">
            <div className="panel-head">
              <h3>Long-term summary</h3>
              <span className="chip">{memory.compactions} compactions</span>
            </div>
            <p className={memory.summary ? 'voice' : 'empty'} style={{ whiteSpace: 'pre-wrap', fontSize: memory.summary ? 'var(--t-md)' : undefined }}>
              {memory.summary || 'After about twenty turns, older conversation is summarized here.'}
            </p>
          </div>
          <div className="card panel">
            <div className="panel-head">
              <h3>Pinned facts</h3>
              <span className="label">{memory.pins.length}</span>
            </div>
            {memory.pins.length === 0 && <p className="empty" style={{ margin: 0 }}>Tell Wisp something to remember, like "I work in 50 minute blocks".</p>}
            {memory.pins.map((p, i) => (
              <div key={p} className="check" style={{ alignItems: 'center' }}>
                <i />
                <span style={{ flex: 1 }}>{p}</span>
                <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => window.wisp.unpin(i)} aria-label="Unpin">
                  <IconX size={14} />
                </ActionIcon>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
