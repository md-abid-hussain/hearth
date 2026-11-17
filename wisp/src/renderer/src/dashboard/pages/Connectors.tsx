import { useState } from 'react'
import { Button, Code, PasswordInput, Switch, TextInput } from '@mantine/core'
import type { AppStatus, McpGroup, McpServerStatus } from '@shared/types'
import { PageHeader } from '../shared'

const PRESET_SECTIONS: { group: McpGroup; title: string }[] = [
  { group: 'work', title: 'Work' },
  { group: 'code', title: 'Code' },
  { group: 'search', title: 'Search' }
]

export function ConnectorSection({
  title,
  note,
  children
}: {
  title: string
  note?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="connector-section">
      <h4 className="caps">{title}</h4>
      {note && <p className="connector-note">{note}</p>}
      <div className="app-grid">{children}</div>
    </section>
  )
}

const COMPOSIO_NOTE = (
  <>
    Composio keeps the Google sign-in on its servers and passes along what Wisp reads. Google asks
    for full mail, calendar and Drive access, but this session only offers tools Composio marks
    read-only, and Wisp checks each one again. Composio&apos;s search can also reach other apps and
    paid web tools, which use your Composio credits.
  </>
)

export function Connectors({
  servers,
  status
}: {
  servers: McpServerStatus[]
  status: AppStatus
}): React.JSX.Element {
  const remote = servers.filter((s) => s.source !== 'mcp.json')
  const custom = servers.filter((s) => s.source === 'custom')
  const viaComposio = servers.filter((s) => s.source === 'composio')
  const fromFile = servers.filter((s) => s.source === 'mcp.json')

  return (
    <div className="page-inner">
      <PageHeader
        eyebrow="Connectors"
        title="Read-only, by design."
        intro="Sign in to an app's own MCP server. Wisp keeps the tokens and keys on this computer, encrypted by Windows, and every tool passes a read-only gate before the model sees it."
      />

      <div className="grid-2-even">
        <div className="card dashed panel">
          <h3 className="display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>
            What Wisp will never do
          </h3>
          <ul className="list-x">
            <li>Send, reply to or draft a message</li>
            <li>Create, edit, move or delete anything</li>
            <li>Run a tool the server marks as destructive</li>
          </ul>
        </div>
        <div className="card solid panel">
          <h3 className="display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>
            What it can read when you ask
          </h3>
          <ul className="list-arrow">
            <li>Your next meetings, to time a break around them</li>
            <li>Unread mail, issues or pages, summarised</li>
            <li>Docs you point it at</li>
          </ul>
        </div>
      </div>

      <div className="card panel">
        <div className="panel-head">
          <h3>Apps</h3>
        </div>
        {viaComposio.length > 0 && (
          <ConnectorSection title="Google and more, through Composio" note={COMPOSIO_NOTE}>
            {viaComposio.map((s) => (
              <AppRow key={s.id} server={s} />
            ))}
          </ConnectorSection>
        )}
        {PRESET_SECTIONS.map(({ group, title }) => {
          const list = remote.filter((s) => s.source === 'preset' && s.group === group)
          return (
            list.length > 0 && (
              <ConnectorSection key={group} title={title}>
                {list.map((s) => (
                  <AppRow key={s.id} server={s} />
                ))}
              </ConnectorSection>
            )
          )
        })}
        <ConnectorSection title="Custom">
          {custom.map((s) => (
            <AppRow key={s.id} server={s} />
          ))}
        </ConnectorSection>
        <AddServer />
      </div>

      {remote
        .filter((s) => s.tools.length > 0)
        .map((s) => (
          <ToolTable key={s.id} server={s} />
        ))}

      <details className="advanced">
        <summary className="label">Advanced: servers from mcp.json</summary>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12
          }}
        >
          <span className="label">
            Config file{' '}
            <Code ml={6}>{status.mcpConfigPath ?? 'none, copy mcp.example.json next to .env'}</Code>
          </span>
          <ReloadButton />
        </div>
        {fromFile.map((s) => (
          <div key={s.id} style={{ marginTop: 12 }}>
            <AppRow server={s} />
            {s.tools.length > 0 && <ToolTable server={s} />}
          </div>
        ))}
      </details>
    </div>
  )
}

function stateLabel(s: McpServerStatus): string {
  if (s.unavailable) return s.unavailable
  if (!s.enabled) return 'Off · tools hidden, sign-in kept'
  if (s.auth === 'signingIn') return 'Waiting for you to finish in the browser…'
  if (s.source === 'composio' && s.auth !== 'none')
    return s.connected ? 'Signed in through Composio' : 'Not signed in'
  if (s.connected) return `Connected · ${s.tools.filter((t) => t.allowed).length} read tools`
  if (s.auth === 'signedIn') return 'Signed in, but not connected'
  if (s.auth === 'signedOut') return s.keyLabel ? 'Needs a key' : 'Not signed in'
  return 'Not connected'
}

function AppRow({ server }: { server: McpServerStatus }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const signOut = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.wisp.mcpSignOut(server.id)
    } finally {
      setBusy(false)
    }
  }
  const signingIn = server.auth === 'signingIn'
  const needsKey = Boolean(server.keyLabel) && server.auth === 'signedOut'
  const canSignIn =
    !server.unavailable &&
    server.enabled &&
    server.auth !== 'none' &&
    !server.connected &&
    !signingIn &&
    !needsKey
  // Servers that need no sign-in, such as the Composio session itself, have nothing to sign out of.
  const canSignOut =
    server.source !== 'mcp.json' &&
    !signingIn &&
    (server.auth === 'signedIn' || server.source === 'custom')
  const canToggle = server.connected || !server.enabled
  const tone = server.connected
    ? 'ok'
    : signingIn
      ? 'busy'
      : server.unavailable || !server.enabled
        ? 'muted'
        : 'off'

  return (
    <div className="app-row">
      <div className="app-head">
        <span className="app-logo" aria-hidden>
          {server.name.charAt(0)}
        </span>
        <span className="app-title">{server.name}</span>
        <div className="app-actions">
          {signingIn && (
            <Button
              size="xs"
              variant="default"
              onClick={() => window.wisp.mcpCancelSignIn(server.id)}
            >
              Cancel
            </Button>
          )}
          {canSignIn && (
            <Button size="xs" onClick={() => void window.wisp.mcpSignIn(server.id)}>
              {server.auth === 'signedIn' ? 'Reconnect' : 'Sign in'}
            </Button>
          )}
          {canSignOut && (
            <Button size="xs" variant="subtle" color="gray" loading={busy} onClick={signOut}>
              {server.source === 'custom' ? 'Remove' : 'Sign out'}
            </Button>
          )}
          {canToggle && (
            <Switch
              size="xs"
              aria-label={`Let Wisp use ${server.name}`}
              checked={server.enabled}
              onChange={(e) => void window.wisp.mcpSetEnabled(server.id, e.currentTarget.checked)}
            />
          )}
        </div>
      </div>
      <div className={`app-status ${tone}`}>
        <span className="dot" />
        {stateLabel(server)}
      </div>
      {needsKey && <KeyForm server={server} />}
      {server.error && <div className="app-error">{server.error}</div>}
    </div>
  )
}

function KeyForm({ server }: { server: McpServerStatus }): React.JSX.Element {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const connect = async (): Promise<void> => {
    setBusy(true)
    try {
      if (!(await window.wisp.mcpSetKey(server.id, key))) setKey('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <PasswordInput
        size="xs"
        style={{ flex: 1, minWidth: 0 }}
        placeholder={server.keyLabel ?? 'API key'}
        aria-label={server.keyLabel ?? 'API key'}
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && key.trim()) void connect()
        }}
      />
      <Button size="xs" loading={busy} disabled={!key.trim()} onClick={connect}>
        Connect
      </Button>
    </div>
  )
}

function AddServer(): React.JSX.Element {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      const problem = await window.wisp.mcpAddServer(name, url, apiKey.trim() || undefined)
      setError(problem)
      if (!problem) {
        setName('')
        setUrl('')
        setApiKey('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <span className="label">Any other app with a remote MCP server</span>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-start' }}>
        <TextInput
          size="xs"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <TextInput
          size="xs"
          placeholder="https://mcp.example.com/mcp"
          style={{ flex: 1 }}
          value={url}
          error={error}
          onChange={(e) => setUrl(e.currentTarget.value)}
        />
        <PasswordInput
          size="xs"
          placeholder="API key (optional)"
          aria-label="API key, optional, replaces browser sign-in"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
        />
        <Button size="xs" variant="default" loading={busy} disabled={!name || !url} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  )
}

function ReloadButton(): React.JSX.Element {
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
    <Button size="xs" variant="default" loading={loading} onClick={reload}>
      Reload
    </Button>
  )
}

function ToolTable({ server }: { server: McpServerStatus }): React.JSX.Element {
  return (
    <details className="card panel advanced">
      <summary className="label">
        {server.name}: {server.tools.filter((t) => !t.allowed).length} of {server.tools.length}{' '}
        tools blocked
      </summary>
      <table className="plain">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Decision</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {server.tools.map((t) => (
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
    </details>
  )
}
