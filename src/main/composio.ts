import { randomUUID } from 'crypto'
import { Composio } from '@composio/core'
import { VercelProvider } from '@composio/vercel'
import type { ToolSet } from 'ai'
import { shell } from 'electron'
import type { McpServerStatus, McpToolInfo } from '../shared/types'
import { loadConfig } from './config'
import { hub } from './hub'
import { readOnlyName, type GateVerdict } from './mcp'
import { SignInCancelled } from './mcpAuth'
import { readJson, writeJson } from './store'

const FILE = 'composio.json'
/** Bump when the session policy below changes, so a stored session with the old policy is replaced. */
const POLICY_VERSION = 2
/** Google's consent screens for Gmail take a while, especially with the full-access warning. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const POLL_FIRST_MS = 1_500
const POLL_MAX_MS = 5_000
/** Creating a sign-in link is a POST, which the Composio client never retries on its own. */
const LINK_ATTEMPTS = 3
const FAILED_STATES = new Set(['FAILED', 'EXPIRED', 'REVOKED'])
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

/**
 * Composio's own helpers that Hearth hands the model: finding tools, reading their schemas, and
 * the executor, which checks every tool it is asked to run. The rest, such as connection
 * management, the code sandbox and raw API calls, are off in the session and blocked here too.
 */
const META_TOOLS = new Set(['COMPOSIO_SEARCH_TOOLS', 'COMPOSIO_GET_TOOL_SCHEMAS', MULTI_EXECUTE])

const appId = (toolkit: string): string => `${HUB_ID}-${toolkit}`

/** The Google app a tool belongs to: GMAIL_FETCH_EMAILS is Gmail's. */
const appOf = (slug: string): (typeof APPS)[number] | undefined =>
  APPS.find((a) => slug.toUpperCase().startsWith(`${a.toolkit.toUpperCase()}_`))

/**
 * Hearth's own read-only check for a Composio tool, on top of the session's tag filter, which
 * Composio sets on a best-effort basis: only Google apps Hearth offers, and only names that pass
 * the same read-word and write-word test as MCP tools.
 */
function composioVerdict(slug: string): GateVerdict {
  if (META_TOOLS.has(slug))
    return { allowed: true, reason: 'Composio helper; runs only read tools' }
  if (slug.toUpperCase().startsWith('COMPOSIO_'))
    return { allowed: false, reason: 'Composio helper Hearth does not use' }
  if (!appOf(slug)) return { allowed: false, reason: 'not one of the Google apps Hearth offers' }
  return readOnlyName(slug)
}

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

/** Runs a request again after a short pause when it fails on the network, not on the server. */
async function withRetries<T>(run: () => Promise<T>, attempts: number): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (err) {
      if (attempt >= attempts || !isNetworkError(err)) throw err
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt))
    }
  }
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
 * Gmail, Google Calendar and Google Drive through one Composio session.
 *
 * The session is read-only on Composio's side: it covers only those three toolkits, only tools
 * tagged read-only and not create, update or destructive are found or run, raw API calls and the
 * code sandbox are off, and sign-in only happens from the Connectors page. Composio's tags are
 * best-effort, so Hearth also runs every tool name through its own read check, both the tools
 * handed to the model and each tool the executor is asked to run, and trims large results
 * before the model sees them.
 */
class ComposioApps {
  private client: Client | null = null
  private session: Session | null = null
  private tools: ToolSet = {}
  private infos: McpToolInfo[] = []
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
    this.infos = []
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
    this.setStatus(HUB_ID, { connected: true, error: null, tools: this.infos })
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
      const session = this.session
      const request = await withRetries(() => session.authorize(app.toolkit), LINK_ATTEMPTS)
      const url = new URL(request.redirectUrl ?? '')
      if (url.protocol !== 'https:')
        throw new Error('Composio returned a sign-in link that is not https')
      await shell.openExternal(url.toString())
      await Promise.race([this.waitUntilConnected(request.id), cancelled])
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

  /**
   * Polls the new connection until the user finishes in the browser. The SDK's own wait gives up
   * on the first network error; this one keeps waiting through blips until the connection is
   * active, fails, or the time runs out.
   */
  private async waitUntilConnected(accountId: string): Promise<void> {
    const client = this.client
    if (!client) throw new Error('Composio is not connected')
    const deadline = Date.now() + SIGN_IN_TIMEOUT_MS
    let delay = POLL_FIRST_MS
    for (;;) {
      try {
        const account = await client.connectedAccounts.get(accountId)
        if (account.status === 'ACTIVE') return
        if (FAILED_STATES.has(account.status))
          throw new Error(`Google sign-in ended: ${account.status.toLowerCase()}`)
      } catch (err) {
        if (!isNetworkError(err)) throw err
      }
      if (Date.now() >= deadline) throw new Error('Sign-in was not finished within 5 minutes')
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 1.5, POLL_MAX_MS)
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
    const create = (readOnlyTag: boolean): ReturnType<Client['create']> =>
      client.create(this.saved.userId, {
        // Only the Google apps Hearth offers, and only tools tagged read-only (enable is an
        // allow-list) that are not also tagged as writing.
        toolkits: { enable: APPS.map((a) => a.toolkit) },
        tags: {
          ...(readOnlyTag ? { enable: ['readOnlyHint' as const] } : {}),
          disable: ['createHint', 'updateHint', 'destructiveHint']
        },
        manageConnections: false,
        sandbox: { enable: false },
        proxyExecute: false,
        preload: { tools: PRELOAD },
        instant: { returnInstantCharge: true }
      })
    let session: Session
    try {
      session = await create(true)
    } catch (err) {
      // Composio refuses a session whose filters hide a preloaded tool. Its tags are best-effort,
      // so if a preloaded read tool lacks the read-only tag, fall back to the block-list; Hearth's
      // own name check still keeps every write tool away from the model.
      if ((err as { status?: number }).status !== 400) throw err
      hub.record('error', `Composio refused the read-only tag filter: ${describe(err)}`)
      session = await create(false)
    }
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

  /**
   * Keeps only the session tools that pass Hearth's read check and wraps each with the per-call
   * checks, logging and result trimming. Records every tool's verdict for the Apps page.
   */
  private guard(tools: ToolSet): ToolSet {
    const guarded: ToolSet = {}
    this.infos = []
    for (const [name, original] of Object.entries(tools)) {
      const execute = original.execute
      const verdict = execute
        ? composioVerdict(name)
        : { allowed: false, reason: 'Composio gave no way to run it' }
      this.infos.push({ server: 'Composio', name, exposedAs: name, ...verdict })
      if (!execute || !verdict.allowed) continue
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
    // Fails closed: a call list Hearth cannot read is refused rather than run unchecked.
    const calls = (input as { tools?: unknown } | null)?.tools
    if (!Array.isArray(calls) || calls.length === 0)
      return 'Hearth could not tell which tools this call would run'
    for (const call of calls) {
      const slug = String((call as { tool_slug?: unknown } | null)?.tool_slug ?? '')
      // The executor runs app tools only, never Composio's helpers or itself again.
      if (!appOf(slug))
        return `Hearth only runs Gmail, Calendar and Drive read tools, not "${slug}"`
      if (this.toolkitOff(slug)) return `${slug} is turned off in Hearth`
      const verdict = readOnlyName(slug)
      if (!verdict.allowed) return `Hearth only reads; ${slug} is blocked: ${verdict.reason}`
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
