import { useMemo } from 'react'
import { Button } from '@mantine/core'
import type { LogEntry, Reminder } from '@shared/types'
import { PageHeader, clock } from '../shared'

export function Reminders({
  reminders,
  log
}: {
  reminders: Reminder[]
  log: LogEntry[]
}): React.JSX.Element {
  const fired = useMemo(
    () =>
      log
        .filter((e) => e.kind === 'reminder' && e.data?.rule === 'reminder')
        .slice(-8)
        .reverse(),
    [log]
  )
  return (
    <div className="page-inner">
      <PageHeader
        eyebrow="Reminders"
        title="Things you asked Hearth to say."
        intro='Ask out loud, like "remind me to stretch in 20 minutes". When one is due, Hearth says it once you are not talking. In quiet mode it sends a Windows notification instead.'
      />
      <div className="grid-2-even">
        <div className="card pop panel">
          <div className="panel-head">
            <h3>Scheduled</h3>
            <span className="label">{reminders.length} pending</span>
          </div>
          {reminders.length === 0 && (
            <p className="empty" style={{ margin: 0 }}>
              Nothing pending.
            </p>
          )}
          {reminders.map((r) => (
            <div key={r.id} className="check skip" style={{ alignItems: 'center' }}>
              <i />
              <span style={{ flex: 1 }}>{r.text}</span>
              <span className="label">{clock(r.dueAt)}</span>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() => window.hearth.cancelReminder(r.id)}
              >
                cancel
              </Button>
            </div>
          ))}
        </div>
        <div className="card panel">
          <div className="panel-head">
            <h3>Delivered</h3>
          </div>
          {fired.length === 0 && (
            <p className="empty" style={{ margin: 0 }}>
              None yet.
            </p>
          )}
          {fired.map((e) => (
            <div key={e.id} className="check">
              <i />
              <span style={{ flex: 1 }} className="voice">
                {e.message}
              </span>
              <span className="chip">
                {e.data?.via === 'notification' ? 'notification' : 'spoken'}
              </span>
              <span className="label">{clock(e.at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
