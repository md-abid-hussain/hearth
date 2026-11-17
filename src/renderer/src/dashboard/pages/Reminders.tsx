import { useMemo } from 'react'
import { Button } from '@mantine/core'
import type { LogEntry, Reminder } from '@shared/types'
import { clock } from '../helpers'
import { PageHeader } from '../shared'

/** How a reminder or check-in ended up, as logged by the observer. */
const VIA: Record<string, string> = {
  spoken: 'spoken',
  notification: 'notification',
  fine: 'all fine',
  stopped: 'stopped',
  finished: 'done',
  missed: 'missed'
}

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
        .filter(
          (e) => e.kind === 'reminder' && (e.data?.rule === 'reminder' || e.data?.rule === 'check')
        )
        .slice(-12)
        .reverse(),
    [log]
  )
  return (
    <div className="page-inner">
      <PageHeader
        eyebrow="Reminders"
        title="Things you asked Hearth to say or watch."
        intro='Ask out loud, like "remind me to stretch in 20 minutes" or "keep an eye on my eye strain every 10 minutes". A check-in reads your signals each time, stays quiet while they look fine, and stops when the camera loses you. Hearth speaks once you are not talking; in quiet mode it sends a notification instead.'
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
              <span style={{ flex: 1 }}>
                {r.text}
                {r.check && (
                  <span className="label" style={{ display: 'block' }}>
                    every {r.check.everyMin} min · {r.check.runsLeft} checks left
                  </span>
                )}
              </span>
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
              <span className="chip">{VIA[String(e.data?.via)] ?? 'spoken'}</span>
              <span className="label">{clock(e.at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
