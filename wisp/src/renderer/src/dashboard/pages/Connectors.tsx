import { useState } from 'react'
import { Button, Code } from '@mantine/core'
import type { AppsState, AppStatus, ConnectedApp, McpServerStatus } from '@shared/types'
import { PageHeader } from '../shared'

export function Connectors({
  apps,
  servers,
  status
}: {
  apps: AppsState
  servers: McpServerStatus[]
  status: AppStatus
}): React.JSX.Element {
  return (
    <div className="page-inner">
      <PageHeader
        eyebrow="Connectors"
        title="Read-only, by design."
        intro="Sign in to the apps Wisp may read. Composio holds the sign-in; Wisp only ever gets tools tagged read-only, and Composio enforces that when they run."
      />

      <div className="grid-2-even">
        <div className="card dashed panel">
          <h3 className="display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>
            What Wisp will never do
          </h3>
          <ul className="list-x">
            <li>Send, reply to or draft a message</li>
            <li>Create, edit, move or delete anything</li>
            <li>Run code or raw requests against your accounts</li>
          </ul>
        </div>
        <div className="card solid panel">
          <h3 className="display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>
            What it can read when you ask
          </h3>
          <ul className="list-arrow">
            <li>Your next meetings, to time a break around them</li>
            <li>Unread mail, issues or messages, summarised</li>
            <li>Notes and docs you point it at</li>
          </ul>
        </div>
      </div>

      <AppList state={apps} />
      <AdvancedMcp servers={servers} status={status} />
    </div>
  )
}

function AppList({ state }: { state: AppsState }): React.JSX.Element {
  if (!state.configured) {
    return (
      <div className="card panel">
        <h3 className="display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
          Apps
        </h3>
        <p className="muted" style={{ margin: 0 }}>
          Add <Code>COMPOSIO_API_KEY</Code> to <Code>.env</Code> and restart Wisp to sign in to
          Gmail, Calendar, GitHub and more. A free key comes from platform.composio.dev.
        </p>
      </div>
    )
  }
  return (
    <div className="card panel">
      <div
        className="panel-head"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <h3>Apps</h3>
        <Button size="xs" variant="subtle" onClick={() => void window.wisp.refreshApps()}>
          Refresh
        </Button>
      </div>
      {state.error && (
        <p style={{ color: 'var(--red)', margin: '0 0 10px', fontSize: 14 }}>{state.error}</p>
      )}
      {state.apps.length === 0 && !state.error && <p className="empty">Loading apps…</p>}
      <div className="app-grid">
        {state.apps.map((app) => (
          <AppRow key={app.slug} app={app} />
        ))}
      </div>
    </div>
  )
}

function AppRow({ app }: { app: ConnectedApp }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const run = async (action: (slug: string) => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action(app.slug)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="app-row">
      <span className="app-logo" aria-hidden>
        {app.name.charAt(0)}
      </span>
      <div className="app-name">
        <span>{app.name}</span>
        <span className="chip">
          <span className={app.connected ? 'sq' : 'sq off'} />
          {app.pending
            ? 'finish signing in, in your browser'
            : app.connected
              ? 'connected'
              : 'not connected'}
        </span>
      </div>
      {app.connected ? (
        <Button
          size="xs"
          variant="default"
          loading={busy}
          onClick={() => run(window.wisp.disconnectApp)}
        >
          Disconnect
        </Button>
      ) : (
        <Button size="xs" loading={busy || app.pending} onClick={() => run(window.wisp.connectApp)}>
          Connect
        </Button>
      )}
    </div>
  )
}

function AdvancedMcp({
  servers,
  status
}: {
  servers: McpServerStatus[]
  status: AppStatus
}): React.JSX.Element {
  const [loading, setLoading] = useState(false)
  const reload = async (): Promise<void> => {
    setLoading(true)
    try {
      await window.wisp.reloadMcp()
    } finally {
      setLoading(false)
    }
  }

  return (
    <details className="advanced">
      <summary className="label">Advanced: your own MCP servers</summary>
      <p className="muted" style={{ fontSize: 14 }}>
        Local or self-hosted MCP servers go in mcp.json. Every tool passes a read-only gate before
        the model sees it.
      </p>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12
        }}
      >
        <span className="label">
          Config file{' '}
          <Code ml={6}>{status.mcpConfigPath ?? 'none, copy mcp.example.json next to .env'}</Code>
        </span>
        <Button size="xs" variant="default" loading={loading} onClick={reload}>
          Reload mcp.json
        </Button>
      </div>

      {servers.map((s) => {
        const allowed = s.tools.filter((t) => t.allowed).length
        return (
          <div key={s.name} className="card panel" style={{ marginBottom: 12 }}>
            <div className="panel-head">
              <h3>
                {s.name}{' '}
                <span className="chip" style={{ marginLeft: 8 }}>
                  <span className={s.connected ? 'sq' : 'sq off'} />
                  {s.connected
                    ? `connected, ${allowed} read, ${s.tools.length - allowed} blocked`
                    : 'failed'}
                </span>
              </h3>
            </div>
            {s.error && (
              <p style={{ color: 'var(--red)', margin: '0 0 10px', fontSize: 14 }}>{s.error}</p>
            )}
            {s.tools.length > 0 && (
              <table className="plain">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Decision</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {s.tools.map((t) => (
                    <tr key={t.name}>
                      <td>
                        <code>{t.name}</code>
                      </td>
                      <td>
                        <span className={t.allowed ? 'tag ok' : 'tag no'}>
                          {t.allowed ? 'allowed' : 'blocked'}
                        </span>
                      </td>
                      <td className="muted">{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </details>
  )
}
