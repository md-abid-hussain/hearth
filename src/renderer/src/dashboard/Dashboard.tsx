import { memo, useEffect, useState } from 'react'
import { Button, Center, Loader, useComputedColorScheme } from '@mantine/core'
import type { HearthState } from '@shared/types'
import { Consent } from '../components/Consent'
import { Orb } from '../components/Orb'
import { onShowPage, useHistory, useHearth } from '../lib/store'
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
  {
    group: 'Report',
    items: [
      { id: 'today', label: 'Today' },
      { id: 'signals', label: 'Signals' },
      { id: 'timeline', label: 'Timeline' },
      { id: 'insights', label: 'Insights' }
    ]
  },
  {
    group: 'Hearth',
    items: [
      { id: 'memory', label: 'Memory' },
      { id: 'reminders', label: 'Reminders' }
    ]
  },
  {
    group: 'Setup',
    items: [
      { id: 'connectors', label: 'Apps' },
      { id: 'privacy', label: 'Privacy' },
      { id: 'voice', label: 'Settings' }
    ]
  }
]

// Every state push is a fresh copy from the main process, but the store keeps the parts it did
// not change identical, so these pages skip the pushes that leave their slice alone: about 12 a
// second while Hearth replies, in the window that also feeds camera frames to SmartSpectra.
const InsightsPage = memo(Insights)
const TimelinePage = memo(Timeline)
const MemoryPage = memo(Memory)
const RemindersPage = memo(Reminders)
const ConnectorsPage = memo(Connectors)

/** Each page's number in the nav, counted across the groups: 01, 02, ... */
const NAV_NUMBER = new Map(
  NAV.flatMap((g) => g.items).map((item, i) => [item.id, String(i + 1).padStart(2, '0')])
)

function StatusFooter({ state }: { state: HearthState }): React.JSX.Element {
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
      <Button
        size="compact-xs"
        variant="subtle"
        color="gray"
        mt={4}
        onClick={() => window.hearth.quit()}
        styles={{ root: { alignSelf: 'flex-start', paddingInline: 0 } }}
      >
        Quit Hearth
      </Button>
    </div>
  )
}

const MOOD_LABEL: Partial<Record<HearthState['mood'], string>> = {
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  sleeping: 'asleep'
}

/**
 * Hearth's own title bar: the live face, the name and what it is doing. It is the window's drag
 * handle; Windows and Linux draw their window buttons over the right end, macOS over the left.
 */
function TitleBar({ state }: { state: HearthState | null }): React.JSX.Element {
  const scheme = useComputedColorScheme('dark')
  useEffect(() => window.hearth?.setTitlebarScheme(scheme), [scheme])
  const mood = state?.mood ?? 'idle'
  const doing = state?.activity ?? MOOD_LABEL[mood]
  return (
    <header className="titlebar">
      <Orb mood={mood} breathing={state?.vitals.breathing ?? null} size={22} />
      <span className="titlebar-name">Hearth</span>
      {doing && <span className="titlebar-sub">{doing}</span>}
      <span className="titlebar-space" />
      {state?.vitals.sensing && (
        <span className="titlebar-chip">
          <span className="sq" /> camera on
        </span>
      )}
      {state?.settings.quietMode && <span className="titlebar-chip">quiet mode</span>}
    </header>
  )
}

export function Dashboard(): React.JSX.Element {
  const state = useHearth()
  return (
    <div className="app-frame">
      <TitleBar state={state} />
      <DashboardBody state={state} />
    </div>
  )
}

function DashboardBody({ state }: { state: HearthState | null }): React.JSX.Element {
  const history = useHistory()
  const [page, setPage] = useState('today')
  useEffect(() => onShowPage(setPage), [])

  if (!state) {
    return (
      <Center style={{ flex: 1 }}>
        <Loader color="var(--amber)" />
      </Center>
    )
  }

  const body = (() => {
    switch (page) {
      case 'signals':
        return <Signals state={state} history={history} />
      case 'timeline':
        return <TimelinePage log={state.log} />
      case 'insights':
        return <InsightsPage insights={state.insights} />
      case 'memory':
        return <MemoryPage memory={state.memory} />
      case 'reminders':
        return <RemindersPage reminders={state.reminders} log={state.log} />
      case 'connectors':
        return <ConnectorsPage servers={state.mcp} status={state.status} />
      case 'voice':
        return <VoiceModel state={state} />
      case 'privacy':
        return <Privacy state={state} />
      default:
        return <Today state={state} history={history} go={setPage} />
    }
  })()

  return (
    <div className="shell">
      <nav className="nav">
        {NAV.map((g) => (
          <div key={g.group} className="nav-section">
            <div className="label nav-group">{g.group}</div>
            {g.items.map((item) => (
              <button
                key={item.id}
                className={page === item.id ? 'nav-item on' : 'nav-item'}
                onClick={() => setPage(item.id)}
              >
                {item.label}
                <span className="n">{NAV_NUMBER.get(item.id)}</span>
              </button>
            ))}
          </div>
        ))}
        <StatusFooter state={state} />
      </nav>
      <main className="page">{body}</main>
      <Consent consentAt={state.settings.consentAt} />
    </div>
  )
}
