import { randomUUID } from 'crypto'
import { Composio } from '@composio/core'
import { VercelProvider } from '@composio/vercel'
import type { ToolSet } from 'ai'
import { shell } from 'electron'
import type { McpServerStatus, McpToolInfo } from '../shared/types'
import { loadConfig } from './config'
import { hub } from './hub'
import { writeVerb } from './mcp'
import { SignInCancelled } from './mcpAuth'
import { readJson, writeJson } from './store'

const FILE = 'composio.json'
/** Bump when the session policy below changes, so a stored session with the old policy is replaced. */
const POLICY_VERSION = 1
const SIGN_IN_TIMEOUT_MS = 3 * 60_000
/** Mail and file listings can be huge; the model only needs enough to answer out loud. */
const RESULT_LIMIT = 8_000
const HUB_ID = 'composio'
/** Connections to Composio's API occasionally time out on the first try. */
const START_ATTEMPTS = 3
const MULTI_EXECUTE = 'COMPOSIO_MULTI_EXECUTE_TOOL'

/** Google needs the user's own account. Composio supplies the OAuth app and keeps the tokens. */
const APPS = [
  { toolkit: 'gmail', name: 'Gmail' },
  { toolkit: 'googlecalendar', name: 'Google Calendar' },
  { toolkit: 'googledrive', name: 'Google Drive' }
] as const

/** Given to the model directly, so the everyday questions skip Composio's search step. */
const PRELOAD = ['GMAIL_FETCH_EMAILS', 'GOOGLECALENDAR_EVENTS_LIST', 'GOOGLEDRIVE_FIND_FILE']

const appId = (toolkit: string): string => `${HUB_ID}-${toolkit}`

interface Saved {
  /** Stable per install; Composio keeps this user's connections. */
  userId: string
  sessionId?: string
  policy?: number
  /** Connector ids switched off on the Connectors page. */
  disabled?: string[]
}

type Client = Composio<VercelProvider>
type Session = Awaited<ReturnType<Client['use']>>
type AnyTool = ToolSet[string]

/** Why the key in .env cannot start a session, or null when it looks usable. */
function keyProblem(key: string): string | null {
  if (!key) return 'Needs COMPOSIO_API_KEY in .env'
  // The For You consumer key only works with Composio's own MCP endpoint, never with the SDK.
  if (key.startsWith('ck_'))
    return 'COMPOSIO_API_KEY is a For You key (ck_); use a Platform key (ak_)'
  return null
}

/** Timeouts and dropped connections, as opposed to a rejected key or request. */
function isNetworkError(err: unknown): boolean {
  const e = err as { status?: number; name?: string; message?: string }
  return (
    e.status === undefined &&
    /timed out|timeout|fetch failed|connection|ECONN/i.test(`${e.name} ${e.message}`)
  )
}

function describe(err: unknown): string {
  const e = err as { status?: number; error?: { error?: { message?: string } }; message?: string }
  if (e.status === 401) return 'Composio rejected COMPOSIO_API_KEY'
  const message = e.error?.error?.message ?? e.message ?? String(err)
  return message.length > 240 ? `${message.slice(0, 240)}…` : message
}

/**
 * Gmail, Google Calendar, Google Drive and Composio's catalog through one Composio session.
 *
 * The session is read-only on Composio's side: tools tagged create, update or destructive are
 * hidden from search and refused when run, raw API calls and the code sandbox are off, and
 * sign-in only happens from the Connectors page. Hearth adds its own check on every tool the
 * catalog executor is asked to run, and trims large results before the model sees them.
 */
class ComposioApps {
  private client: Client | null = null
  private session: Session | null = null
  private tools: ToolSet = {}
  private saved: Saved = { userId: '' }
  private accounts = new Map<string, string>()
  private signIns = new Map<string, () => void>()
  private statuses = new Map<string, McpServerStatus>()

  owns(id: string): boolean {
    return id === HUB_ID || id.startsWith(`${HUB_ID}-`)
  }

  async load(): Promise<void> {
    const key = loadConfig().composioKey
    const stored = readJson<Partial<Saved>>(FILE, {})
    this.saved = { ...stored, userId: stored.userId || `hearth-${randomUUID()}` }
    if (!stored.userId) writeJson(FILE, this.saved)
    this.client = null
    this.session = null
    this.tools = {}
    this.accounts.clear()
    this.resetStatuses(keyProblem(key))
    if (keyProblem(key)) return this.publish()

    this.client = new Composio({
      apiKey: key,
      provider: new VercelProvider(),
      allowTracking: false,
      disableVersionCheck: true
    })
    for (let attempt = 1; ; attempt++) {
      try {
        await this.start(this.client)
        break
      } catch (err) {
        this.session = null
        this.tools = {}
        if (attempt < START_ATTEMPTS && isNetworkError(err)) continue
        this.setStatus(HUB_ID, { connected: false, error: describe(err), tools: [] })
        for (const app of APPS)
          this.setStatus(appId(app.toolkit), { unavailable: 'Composio is not connected' })
        hub.record('error', `Composio could not start: ${describe(err)}`)
        break
      }
    }
    this.publish()
  }

  private async start(client: Client): Promise<void> {
    this.session = await this.openSession(client)
    this.tools = this.guard(await this.session.tools())
    this.setStatus(HUB_ID, { connected: true, error: null, tools: this.toolInfos() })
    await this.refresh()
    hub.record('mcp', `Connected Composio: ${Object.keys(this.tools).length} read tools`)
  }

  toolset(): ToolSet {
    if (this.isOff(HUB_ID)) return {}
    return Object.fromEntries(Object.entries(this.tools).filter(([name]) => !this.toolkitOff(name)))
  }

  /** Opens Composio's Google sign-in in the browser and waits until the account is linked. */
  async signIn(id: string): Promise<void> {
    const app = APPS.find((a) => appId(a.toolkit) === id)
    if (!app || !this.session || this.signIns.has(id)) return
    let cancel: () => void = () => {}
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(new SignInCancelled())
    })
    cancelled.catch(() => {})
    this.signIns.set(id, cancel)
    this.setStatus(id, { auth: 'signingIn', error: null })
    this.publish()
    try {
      const request = await this.session.authorize(app.toolkit)
      const url = new URL(request.redirectUrl ?? '')
      if (url.protocol !== 'https:')
        throw new Error('Composio returned a sign-in link that is not https')
      await shell.openExternal(url.toString())
      await Promise.race([request.waitForConnection(SIGN_IN_TIMEOUT_MS), cancelled])
      hub.record('mcp', `Signed in to ${app.name} through Composio`)
    } catch (err) {
      const wasCancelled = err instanceof SignInCancelled
      this.setStatus(id, { error: wasCancelled ? null : describe(err) })
      if (!wasCancelled) hub.record('error', `${app.name} sign-in failed: ${describe(err)}`)
    } finally {
      this.signIns.delete(id)
      await this.refresh().catch(() => {})
      this.publish()
    }
  }

  cancelSignIn(id: string): void {
    this.signIns.get(id)?.()
  }

  /** Deletes the connected account on Composio, which also drops its Google tokens. */
  async signOut(id: string): Promise<void> {
    const app = APPS.find((a) => appId(a.toolkit) === id)
    const account = app && this.accounts.get(app.toolkit)
    if (!app || !account || !this.client) return
    try {
      await this.client.connectedAccounts.delete(account)
      hub.record('mcp', `Signed out of ${app.name}; Composio deleted the connection`)
    } catch (err) {
      this.setStatus(id, { error: describe(err) })
      hub.record('error', `Could not sign out of ${app.name}: ${describe(err)}`)
    }
    await this.refresh().catch(() => {})
    this.publish()
  }

  /** Off hides the tools from the model and refuses them in the catalog executor. */
  setEnabled(id: string, enabled: boolean): void {
    if (!this.statuses.has(id)) return
    const disabled = new Set(this.saved.disabled ?? [])
    if (enabled) disabled.delete(id)
    else disabled.add(id)
    this.saved = { ...this.saved, disabled: [...disabled] }
    writeJson(FILE, this.saved)
    this.setStatus(id, { enabled })
    hub.record('mcp', `Turned ${enabled ? 'on' : 'off'} ${this.statuses.get(id)?.name}`)
    this.publish()
  }

  /**
   * For Privacy > Delete all local data: removes this install's connected accounts and session
   * from Composio. Returns an error message when that fails, so the caller can report it.
   */
  async forgetAll(): Promise<string | null> {
    const { client } = this
    if (!client) return null
    try {
      const { items } = await client.connectedAccounts.list({ userIds: [this.saved.userId] })
      await Promise.all(items.map((account) => client.connectedAccounts.delete(account.id)))
      await this.session?.delete().catch(() => {})
      return null
    } catch (err) {
      return `Could not remove the Composio connections: ${describe(err)}`
    }
  }

  private async openSession(client: Client): Promise<Session> {
    const { sessionId, policy } = this.saved
    if (sessionId && policy === POLICY_VERSION) {
      try {
        return await client.use(sessionId)
      } catch {
        // Deleted or expired on Composio's side; start a new one below.
      }
    } else if (sessionId) {
      await client.sessions.delete(sessionId).catch(() => {})
    }
    const session = await client.create(this.saved.userId, {
      tags: { disable: ['createHint', 'updateHint', 'destructiveHint'] },
      manageConnections: false,
      sandbox: { enable: false },
      proxyExecute: false,
      preload: { tools: PRELOAD },
      instant: { returnInstantCharge: true }
    })
    this.saved = { ...this.saved, sessionId: session.sessionId, policy: POLICY_VERSION }
    writeJson(FILE, this.saved)
    return session
  }

  /** Reads which Google accounts are linked to this install. */
  private async refresh(): Promise<void> {
    if (!this.session) return
    const { items } = await this.session.toolkits({ toolkits: APPS.map((a) => a.toolkit) })
    for (const app of APPS) {
      const item = items.find((i) => i.slug.toLowerCase() === app.toolkit)
      const account = item?.connection?.connectedAccount?.id
      if (account) this.accounts.set(app.toolkit, account)
      else this.accounts.delete(app.toolkit)
      const active = Boolean(item?.connection?.isActive)
      if (
        this.statuses.get(appId(app.toolkit))?.auth === 'signingIn' &&
        this.signIns.has(appId(app.toolkit))
      )
        continue
      this.setStatus(appId(app.toolkit), {
        connected: active,
        auth: active ? 'signedIn' : 'signedOut'
      })
    }
  }

  /** Wraps each session tool with Hearth's checks, logging and result trimming. */
  private guard(tools: ToolSet): ToolSet {
    const guarded: ToolSet = {}
    for (const [name, original] of Object.entries(tools)) {
      const execute = original.execute
      if (!execute) continue
      guarded[name] = {
        ...original,
        execute: (async (input, options) => {
          const blocked = this.blockedReason(name, input)
          if (blocked) throw new Error(blocked)
          hub.record('tool', `Composio ${name}`)
          return this.trim(name, await execute(input, options))
        }) as AnyTool['execute']
      }
    }
    return guarded
  }

  private blockedReason(name: string, input: unknown): string | null {
    if (this.toolkitOff(name)) return `${name} is turned off in Hearth`
    if (name !== MULTI_EXECUTE) return null
    const calls = (input as { tools?: { tool_slug?: unknown }[] } | null)?.tools ?? []
    for (const call of calls) {
      const slug = String(call.tool_slug ?? '')
      if (this.toolkitOff(slug)) return `${slug} is turned off in Hearth`
      const verb = writeVerb(slug)
      if (verb) return `Hearth only reads; ${slug} looks like it writes ("${verb}")`
    }
    return null
  }

  private trim(name: string, result: unknown): unknown {
    const r = result as {
      data?: unknown
      error?: unknown
      successful?: boolean
      instantCharge?: unknown
    }
    const charge = r?.instantCharge as { amount?: string; currency?: string } | undefined
    if (charge?.amount) {
      hub.record(
        'tool',
        `Composio charged ${charge.amount} ${charge.currency ?? 'USD'} for ${name}`
      )
    }
    if (r && r.successful === false) return { error: r.error ?? 'The tool failed' }
    const data = r && 'data' in r ? r.data : result
    const text = JSON.stringify(data)
    return text && text.length > RESULT_LIMIT
      ? `${text.slice(0, RESULT_LIMIT)}… (cut short; ask for fewer results if more is needed)`
      : data
  }

  private toolInfos(): McpToolInfo[] {
    return Object.keys(this.tools).map((name) => ({
      server: 'Composio',
      name,
      exposedAs: name,
      allowed: true,
      reason: name.startsWith('COMPOSIO_')
        ? 'Composio session hides and refuses tools that create, update or delete'
        : 'preloaded read tool'
    }))
  }

  private isOff(id: string): boolean {
    return (this.saved.disabled ?? []).includes(id)
  }

  /** GMAIL_FETCH_EMAILS belongs to the gmail toolkit, and so on. */
  private toolkitOff(slug: string): boolean {
    const upper = slug.toUpperCase()
    return APPS.some(
      (a) => this.isOff(appId(a.toolkit)) && upper.startsWith(`${a.toolkit.toUpperCase()}_`)
    )
  }

  private resetStatuses(unavailable: string | null): void {
    const base = {
      source: 'composio' as const,
      url: null,
      group: 'composio' as const,
      keyLabel: null,
      unavailable,
      connected: false,
      error: null,
      tools: []
    }
    this.statuses.clear()
    this.statuses.set(HUB_ID, {
      ...base,
      id: HUB_ID,
      name: 'Composio',
      auth: 'none',
      enabled: !this.isOff(HUB_ID)
    })
    for (const app of APPS) {
      const id = appId(app.toolkit)
      this.statuses.set(id, {
        ...base,
        id,
        name: app.name,
        auth: 'signedOut',
        enabled: !this.isOff(id)
      })
    }
  }

  private setStatus(id: string, patch: Partial<McpServerStatus>): void {
    const current = this.statuses.get(id)
    if (current) this.statuses.set(id, { ...current, ...patch })
  }

  private publish(): void {
    hub.composio = [...this.statuses.values()]
    hub.changed()
  }
}

export const composio = new ComposioApps()
