import { useState } from 'react'
import { Button, Center, Loader } from '@mantine/core'
import type { WispState } from '@shared/types'
import { useHistory, useWisp } from '../lib/store'
import { Connectors } from './pages/Connectors'
import { Insights } from './pages/Insights'
import { Memory } from './pages/Memory'
import { Privacy } from './pages/Privacy'
import { Reminders } from './pages/Reminders'
import { Signals } from './pages/Signals'
import { Timeline } from './pages/Timeline'
import { Today } from './pages/Today'
import { VoiceModel } from './pages/VoiceModel'

const NAV: { group: string; items: { id: string; label: string }[] }[] = [
  { group: 'Report', items: [{ id: 'today', label: 'Today' }, { id: 'signals', label: 'Signals' }, { id: 'timeline', label: 'Timeline' }, { id: 'insights', label: 'Insights' }] },
  { group: 'Wisp', items: [{ id: 'memory', label: 'Memory' }, { id: 'reminders', label: 'Reminders' }] },
  { group: 'Setup', items: [{ id: 'connectors', label: 'Connectors' }, { id: 'voice', label: 'Voice and model' }, { id: 'privacy', label: 'Privacy' }] }
]

function StatusFooter({ state }: { state: WispState }): React.JSX.Element {
  const { vitals, status, settings } = state
  const rows: [boolean, string][] = [
    [vitals.sensing, vitals.sensing ? 'camera sensing' : 'camera off'],
    [status.assemblyReady, status.assemblyReady ? 'assemblyai voice' : 'voice key missing'],
    [status.llmReady, status.llmReady ? `${status.llmProvider} model` : 'model key missing'],
    [settings.quietMode, settings.quietMode ? 'quiet mode on' : 'quiet mode off']
  ]
  return (
    <div className="nav-foot">
      {rows.map(([on, label]) => (
        <div className="status-row" key={label}>
          <span className={on ? 'sq' : 'sq off'} />
          {label}
        </div>
      ))}
      <Button size="compact-xs" variant="subtle" color="gray" mt={4} onClick={() => window.wisp.quit()} styles={{ root: { alignSelf: 'flex-start', paddingInline: 0 } }}>
        Quit Wisp
      </Button>
    </div>
  )
}

export function Dashboard(): React.JSX.Element {
  const state = useWisp()
  const history = useHistory()
  const [page, setPage] = useState('today')

  if (!state) {
    return (
      <Center h="100vh">
        <Loader color="var(--amber)" />
      </Center>
    )
  }

  let n = 0
  const body = (() => {
    switch (page) {
      case 'signals': return <Signals state={state} history={history} />
      case 'timeline': return <Timeline log={state.log} />
      case 'insights': return <Insights insights={state.insights} />
      case 'memory': return <Memory memory={state.memory} />
      case 'reminders': return <Reminders reminders={state.reminders} log={state.log} />
      case 'connectors': return <Connectors servers={state.mcp} status={state.status} />
      case 'voice': return <VoiceModel state={state} />
      case 'privacy': return <Privacy state={state} />
      default: return <Today state={state} history={history} go={setPage} />
    }
  })()

  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand"><span className="brand-dot" />Wisp</div>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="label nav-group">{g.group}</div>
            {g.items.map((item) => {
              n += 1
              return (
                <button key={item.id} className={page === item.id ? 'nav-item on' : 'nav-item'} onClick={() => setPage(item.id)}>
                  {item.label}
                  <span className="n">{String(n).padStart(2, '0')}</span>
                </button>
              )
            })}
          </div>
        ))}
        <StatusFooter state={state} />
      </nav>
      <main className="page">{body}</main>
    </div>
  )
}
