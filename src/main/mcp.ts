import { readFileSync } from 'fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import {
  getDefaultEnvironment,
  StdioClientTransport
} from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { dynamicTool, jsonSchema, type ToolSet } from 'ai'
import { z } from 'zod'
import type { McpAuthState, McpGroup, McpServerStatus, McpToolInfo } from '../shared/types'
import { loadConfig, type HearthConfig } from './config'
import { hub } from './hub'
import {
  SignInCancelled,
  StoredOAuthProvider,
  waitForAuthCode,
  type AuthCodeWait,
  type AuthOptions
} from './mcpAuth'
import { StoredApiKey } from './mcpKeys'
import { readJson, writeJson } from './store'

const serverSchema = z.union([
  z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
    allowTools: z.array(z.string()).optional(),
    requireReadOnlyHint: z.boolean().optional(),
    disabled: z.boolean().optional()
  }),
  z.object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    allowTools: z.array(z.string()).optional(),
    requireReadOnlyHint: z.boolean().optional(),
    disabled: z.boolean().optional()
  })
])

const configSchema = z.object({ mcpServers: z.record(z.string(), serverSchema) })

type ServerConfig = z.infer<typeof serverSchema>

/**
 * Words that name a read. A tool the server does not mark read-only needs one of these in its
 * name, and no write word, to get through. "download" is left out on purpose: some servers save
 * the file to disk, so it is not a pure read. allowTools in mcp.json can still let one through.
 */
const READ_WORDS = new Set([
  'get',
  'list',
  'search',
  'find',
  'fetch',
  'read',
  'query',
  'describe',
  'lookup',
  'view',
  'show',
  'count',
  'retrieve',
  'whoami'
])

/**
 * Words that signal a side effect, matched against the split name words. Any one of them blocks
 * a tool the server does not mark read-only, even when the name also has a read word, so
 * "calendar_list_watch" stays blocked. Verbs that are just as often nouns in read tools (block,
 * commit, deploy, link, start, sync, trigger and so on) are left out on purpose: a name with no
 * read word is blocked anyway, and listing them would block reads like "get_commit".
 */
const WRITE_WORDS = new Set([
  // Create, change and delete
  'add',
  'append',
  'apply',
  'clear',
  'copy',
  'cp',
  'create',
  'creates',
  'del',
  'delete',
  'deletes',
  'destroy',
  'drop',
  'duplicate',
  'edit',
  'erase',
  'flush',
  'insert',
  'mkdir',
  'modify',
  'modifies',
  'move',
  'mutate',
  'mv',
  'overwrite',
  'patch',
  'purge',
  'put',
  'remove',
  'removes',
  'rename',
  'reorder',
  'replace',
  'reset',
  'restore',
  'retire',
  'rm',
  'rmdir',
  'save',
  'set',
  'trash',
  'truncate',
  'untrash',
  'update',
  'upload',
  'upsert',
  'wipe',
  'write',
  'writes',
  // Send and share
  'draft',
  'forward',
  'invite',
  'notify',
  'post',
  'publish',
  'publishes',
  'reply',
  'send',
  'sends',
  'share',
  'submit',
  'submits',
  'unshare',
  // Workflow and state
  'accept',
  'acknowledge',
  'archive',
  'assign',
  'attach',
  'approve',
  'cancel',
  'close',
  'complete',
  'decline',
  'detach',
  'disable',
  'disconnect',
  'dismiss',
  'enable',
  'escalate',
  'grant',
  'kill',
  'manage',
  'mark',
  'merge',
  'mute',
  'pin',
  'reject',
  'reopen',
  'reschedule',
  'resolve',
  'restart',
  'revert',
  'revoke',
  'rollback',
  'rotate',
  'schedule',
  'snooze',
  'star',
  'subscribe',
  'terminate',
  'toggle',
  'transfer',
  'transition',
  'unarchive',
  'unassign',
  'unblock',
  'unfollow',
  'unlink',
  'unlock',
  'unmute',
  'unpin',
  'unstar',
  'unsubscribe',
  'unwatch',
  'watch',
  // Run code or spend money
  'authorize',
  'buy',
  'exec',
  'execute',
  'executes',
  'pay',
  'purchase',
  'push',
  'run'
])

interface ToolMeta {
  name: string
  description?: string
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }
}

/** Splits snake, kebab, camel and Pascal case, and capital runs: "SENDMessage" is send, message. */
function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean)
}

export interface GateVerdict {
  allowed: boolean
  reason: string
}

/**
 * The name half of the gate, shared with Composio: a name passes only when it has a read word
 * such as get, list or search, and no write word. Words are matched whole, so "sendmail" or
 * "deleteall" has no read word and is blocked too.
 */
export function readOnlyName(name: string): GateVerdict {
  const words = nameWords(name)
  const write = words.find((w) => WRITE_WORDS.has(w))
  if (write) return { allowed: false, reason: `name contains the write word "${write}"` }
  const read = words.find((w) => READ_WORDS.has(w))
  if (!read) return { allowed: false, reason: 'name has no read word such as get, list or search' }
  return { allowed: true, reason: `name reads data ("${read}") and has no write word` }
}

/**
 * Deny-by-default read-only gate. A tool gets through when mcp.json lists it in allowTools, when
 * the server marks it read-only and not destructive, or, when the server says nothing either
 * way, when its name passes readOnlyName. Everything else is blocked, with the reason shown on
 * the Apps page.
 */
export function gateTool(tool: ToolMeta, server: ServerConfig): GateVerdict {
  if (server.allowTools?.includes(tool.name))
    return { allowed: true, reason: 'explicitly allowed in mcp.json' }
  const hints = tool.annotations ?? {}
  if (hints.destructiveHint === true)
    return { allowed: false, reason: 'server marks it destructive' }
  if (hints.readOnlyHint === true) return { allowed: true, reason: 'server marks it read-only' }
  if (hints.readOnlyHint === false)
    return { allowed: false, reason: 'server marks it not read-only' }
  if (server.requireReadOnlyHint)
    return { allowed: false, reason: 'mcp.json requires readOnlyHint and the server gives none' }
  return readOnlyName(tool.name)
}

const NETWORK_RETRY_MS = 400
/** Long enough for a slow search, short enough that a spoken answer is not left hanging. */
const TOOL_TIMEOUT_MS = 60_000
/** A server that pages forever, or repeats a cursor, cannot stall a connection. */
const MAX_TOOL_PAGES = 20

/** Errors that mean no connection was made, so the request never reached the server. */
const NOT_SENT = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT'
])

/** MCP requests that change nothing on the server, so sending one twice is harmless. */
const HOUSEKEEPING = new Set(['initialize', 'notifications/initialized', 'ping', 'tools/list'])

function networkCause(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause
  return cause?.code ?? cause?.message ?? (err as Error).message
}

function errorCode(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: string; errors?: { code?: string }[] } }).cause
  return cause?.code ?? cause?.errors?.[0]?.code
}

/** Whether every JSON-RPC message in a request body is housekeeping. */
function onlyHousekeeping(body: unknown): boolean {
  if (typeof body !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(body)
    const messages = Array.isArray(parsed) ? parsed : [parsed]
    return (
      messages.length > 0 &&
      messages.every((m) => HOUSEKEEPING.has(String((m as { method?: unknown })?.method)))
    )
  } catch {
    return false
  }
}

/**
 * A failed request is sent again only when that cannot repeat a side effect: the connection
 * was never made, the request is a GET, or it is MCP housekeeping such as listing tools. A tool
 * call that may have reached the server is never repeated.
 */
function safeToRetry(init: RequestInit | undefined, err: unknown): boolean {
  const code = errorCode(err)
  if (code && NOT_SENT.has(code)) return true
  const method = (init?.method ?? 'GET').toUpperCase()
  return method === 'GET' || method === 'HEAD' || onlyHousekeeping(init?.body)
}

function unreachable(url: string | URL, err: unknown): Error {
  return new Error(`Could not reach ${new URL(String(url)).host} (${networkCause(err)})`, {
    cause: err
  })
}

/**
 * fetch only rejects when no response arrived, typically a refused connection or a pooled
 * connection the server already closed. Safe requests get one fresh attempt, and the error
 * names the real cause instead of a bare "fetch failed".
 */
const networkFetch: FetchLike = async (url, init) => {
  try {
    return await fetch(url, init)
  } catch (err) {
    if (init?.signal?.aborted) throw err
    if (!safeToRetry(init, err)) throw unreachable(url, err)
    await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_MS))
    try {
      return await fetch(url, init)
    } catch (second) {
      if (init?.signal?.aborted) throw second
      throw unreachable(url, second)
    }
  }
}

const safeName = (s: string): string => s.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30)

interface Preset {
  id: string
  name: string
  url: string
  group: McpGroup
  /** What to paste, for servers without OAuth dynamic client registration. Skips OAuth. */
  key?: string
  /** Auth options, or why the preset cannot be used with this .env. */
  auth?(cfg: HearthConfig): AuthOptions | string
}

/**
 * Official hosted MCP servers. Most register Hearth themselves; GitHub and Linkup have no dynamic
 * client registration, so they take a pasted key.
 */
const PRESETS: Preset[] = [
  {
    id: 'notion',
    name: 'Notion',
    group: 'work',
    url: 'https://mcp.notion.com/mcp',
    auth: () => ({})
  },
  {
    id: 'linear',
    name: 'Linear',
    group: 'work',
    url: 'https://mcp.linear.app/mcp/readonly',
    auth: () => ({ scope: 'read' })
  },
  {
    id: 'atlassian',
    name: 'Atlassian',
    group: 'work',
    url: 'https://mcp.atlassian.com/v1/mcp',
    auth: () => ({})
  },
  {
    id: 'todoist',
    name: 'Todoist',
    group: 'work',
    url: 'https://ai.todoist.net/mcp',
    auth: () => ({})
  },
  {
    id: 'github',
    name: 'GitHub',
    group: 'code',
    url: 'https://api.githubcopilot.com/mcp/readonly',
    key: 'Fine-grained personal access token, read-only'
  },
  {
    id: 'sentry',
    name: 'Sentry',
    group: 'code',
    url: 'https://mcp.sentry.dev/mcp',
    auth: () => ({})
  },
  {
    id: 'vercel',
    name: 'Vercel',
    group: 'code',
    url: 'https://mcp.vercel.com',
    auth: () => ({})
  },
  {
    id: 'linkup',
    name: 'Linkup',
    group: 'search',
    url: 'https://mcp.linkup.so/mcp',
    key: 'Linkup API key'
  }
]

const CUSTOM_FILE = 'connectors.json'
const CUSTOM_KEY_LABEL = 'API key'

interface CustomServer {
  id: string
  name: string
  url: string
  /** The key itself lives in mcp-keys/, encrypted. */
  key?: boolean
}

interface ConnectorsFile {
  custom: CustomServer[]
  disabled: string[]
}

/** Older versions saved a bare array of custom servers. */
function readConnectors(): ConnectorsFile {
  const raw = readJson<CustomServer[] | Partial<ConnectorsFile>>(CUSTOM_FILE, [])
  if (Array.isArray(raw)) return { custom: raw, disabled: [] }
  return { custom: raw.custom ?? [], disabled: raw.disabled ?? [] }
}

type Credential = { oauth: AuthOptions } | { keyLabel: string } | null

interface Entry {
  status: McpServerStatus
  config: ServerConfig | null
  provider: StoredOAuthProvider | null
  key: StoredApiKey | null
  client: Client | null
  tools: ToolSet
  /** Bumped on every connect and disconnect, so a connect that finishes late knows it is stale. */
  generation: number
  /** Aborts the connect in flight, if any. */
  connecting: AbortController | null
}

class McpManager {
  private entries = new Map<string, Entry>()
  private signInWaits = new Map<string, AuthCodeWait>()
  private disabled = new Set<string>()
  /** The load in progress; each load waits for the one before it. */
  private loading: Promise<void> = Promise.resolve()
  /** Bumped by close(), so a load that was overtaken by a newer load or a close stops. */
  private epoch = 0

  /**
   * Rebuilds every server from scratch. The old connections close and sign-ins stop at once, and
   * loads run one after another, so no client is left connected outside the entries map.
   */
  load(configPath: string | null): Promise<void> {
    const closing = this.close()
    const epoch = this.epoch
    const run = this.loading.then(() => closing).then(() => this.loadNow(configPath, epoch))
    this.loading = run.catch(() => {})
    return run
  }

  private async loadNow(configPath: string | null, epoch: number): Promise<void> {
    if (epoch !== this.epoch) return
    // A server added on the Apps page while this load waited its turn is saved to disk and
    // rebuilt below, so its live copy goes rather than being replaced while still connected.
    void this.dropAll()
    const cfg = loadConfig()
    const saved = readConnectors()
    this.disabled = new Set(saved.disabled)

    for (const preset of PRESETS) {
      const auth = preset.key ? null : (preset.auth?.(cfg) ?? {})
      const unavailable = typeof auth === 'string' ? auth : null
      let credential: Credential = null
      if (preset.key) credential = { keyLabel: preset.key }
      else if (auth && typeof auth !== 'string') credential = { oauth: auth }
      this.add(
        preset.id,
        preset.name,
        'preset',
        preset.group,
        { url: preset.url },
        credential,
        unavailable
      )
    }
    for (const custom of saved.custom) {
      const credential = custom.key ? { keyLabel: CUSTOM_KEY_LABEL } : { oauth: {} }
      this.add(custom.id, custom.name, 'custom', 'custom', { url: custom.url }, credential, null)
    }
    if (configPath) {
      try {
        const parsed = configSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')))
        for (const [name, server] of Object.entries(parsed.mcpServers)) {
          if (server.disabled) continue
          const credential =
            'url' in server && !hasAuthHeader(server.headers) ? { oauth: {} } : null
          this.add(`json-${name}`, name, 'mcp.json', 'custom', server, credential, null)
        }
      } catch (err) {
        hub.record('error', `mcp.json could not be parsed: ${(err as Error).message}`)
      }
    }
    this.publish()

    // Presets connect only once signed in, so startup never knocks on servers the user never chose.
    await Promise.all(
      [...this.entries.values()]
        .filter(
          (e) =>
            e.config &&
            !e.status.unavailable &&
            e.status.enabled &&
            (e.key ? e.key.has() : e.status.source !== 'preset' || e.provider?.hasTokens())
        )
        .map((e) => this.open(e))
    )
    this.publish()
  }

  async signIn(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (entry?.key?.has()) {
      await this.open(entry)
      this.publish()
      return
    }
    if (!entry?.provider || !entry.config || entry.status.auth === 'signingIn') return
    const provider = entry.provider
    provider.interactive = true
    this.setAuth(entry, 'signingIn', null)
    const wait = waitForAuthCode(provider)
    this.signInWaits.set(id, wait)
    try {
      const first = await this.open(entry)
      if (!first.unauthorized) return
      const code = await wait.code
      await first.transport.finishAuth(code)
      await first.transport.close().catch(() => {})
      await this.open(entry)
      if (entry.status.connected) hub.record('mcp', `Signed in to ${entry.status.name}`)
    } catch (err) {
      const cancelled = err instanceof SignInCancelled
      this.setAuth(entry, 'signedOut', cancelled ? null : (err as Error).message)
      if (!cancelled) {
        hub.record('error', `Sign-in to ${entry.status.name} failed: ${(err as Error).message}`)
      }
    } finally {
      wait.cancel()
      // A reload may have started a new sign-in for the same id meanwhile; leave that one be.
      if (this.signInWaits.get(id) === wait) this.signInWaits.delete(id)
      provider.interactive = false
      if (this.authOf(entry) === 'signingIn') {
        entry.status = { ...entry.status, auth: provider.hasTokens() ? 'signedIn' : 'signedOut' }
      }
      this.publish()
    }
  }

  /** Stops waiting for the browser; the sign-in page can simply be closed. */
  cancelSignIn(id: string): void {
    this.signInWaits.get(id)?.cancel()
  }

  async signOut(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    this.signInWaits.get(id)?.cancel()
    entry.provider?.forget()
    entry.key?.forget()
    await this.disconnect(entry)
    if (entry.status.source === 'custom') {
      this.entries.delete(id)
    } else {
      entry.status = {
        ...entry.status,
        connected: false,
        auth: 'signedOut',
        enabled: true,
        error: null,
        tools: []
      }
    }
    this.disabled.delete(id)
    this.save()
    hub.record('mcp', `Signed out of ${entry.status.name}`)
    this.publish()
  }

  /** Stores a pasted key for a key-based server and connects with it. */
  async setKey(id: string, key: string): Promise<string | null> {
    const entry = this.entries.get(id)
    if (!entry?.key) return 'This connector signs in through the browser'
    const value = key.trim()
    if (!value) return 'Paste a key first'
    entry.key.save(value)
    entry.status = { ...entry.status, auth: 'signedIn', error: null }
    await this.open(entry)
    this.publish()
    if (entry.status.connected) hub.record('mcp', `Signed in to ${entry.status.name}`)
    return entry.status.connected ? null : (entry.status.error ?? 'Could not connect')
  }

  /** Off closes the connection and hides the tools, keeping tokens and keys for later. */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry || entry.status.enabled === enabled) return
    entry.status = { ...entry.status, enabled }
    if (enabled) this.disabled.delete(id)
    else this.disabled.add(id)
    this.save()
    if (enabled) {
      await this.open(entry)
    } else {
      await this.disconnect(entry)
      entry.status = { ...entry.status, connected: false, error: null, tools: [] }
    }
    hub.record('mcp', `Turned ${enabled ? 'on' : 'off'} ${entry.status.name}`)
    this.publish()
  }

  /** Saves a remote MCP server by URL and connects; it will ask for sign-in if it needs one. */
  async addServer(name: string, url: string, apiKey?: string): Promise<string | null> {
    const label = name.trim()
    let parsed: URL
    try {
      parsed = new URL(url.trim())
    } catch {
      return 'That is not a valid URL'
    }
    const local = ['localhost', '127.0.0.1'].includes(parsed.hostname)
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:'))
      return 'Use an https URL'
    if (!label) return 'Give it a name'
    const id = `custom-${safeName(label).toLowerCase()}`
    if (this.entries.has(id)) return 'A connector with that name already exists'

    const key = apiKey?.trim()
    const credential = key ? { keyLabel: CUSTOM_KEY_LABEL } : { oauth: {} }
    const entry = this.add(
      id,
      label,
      'custom',
      'custom',
      { url: parsed.toString() },
      credential,
      null
    )
    if (key) {
      entry.key?.save(key)
      entry.status = { ...entry.status, auth: 'signedIn' }
    }
    this.save()
    await this.open(entry)
    this.publish()
    return null
  }

  toolset(): ToolSet {
    return Object.assign(
      {},
      ...[...this.entries.values()].filter((e) => e.status.enabled).map((e) => e.tools)
    )
  }

  /**
   * Closes every connection, including connects still in flight, and ends sign-ins. Providers are
   * retired first, so tokens from a sign-in that finishes afterwards, say after Delete all local
   * data, are never written to disk.
   */
  async close(): Promise<void> {
    this.epoch++
    await this.dropAll()
  }

  /** Empties the map; its first part, up to closing the clients, runs synchronously. */
  private async dropAll(): Promise<void> {
    for (const wait of this.signInWaits.values()) wait.cancel()
    this.signInWaits.clear()
    const entries = [...this.entries.values()]
    this.entries.clear()
    for (const entry of entries) entry.provider?.retire()
    await Promise.allSettled(entries.map((entry) => this.disconnect(entry)))
  }

  /** Drops an entry's connection and any connect in flight. Runs its first part synchronously. */
  private async disconnect(entry: Entry): Promise<void> {
    entry.generation++
    entry.connecting?.abort()
    entry.connecting = null
    const client = entry.client
    entry.client = null
    entry.tools = {}
    await client?.close().catch(() => {})
  }

  /** Whether the entry is still the one in the map, so its results should be kept. */
  private isLive(entry: Entry): boolean {
    return this.entries.get(entry.status.id) === entry
  }

  private add(
    id: string,
    name: string,
    source: McpServerStatus['source'],
    group: McpGroup,
    config: ServerConfig,
    credential: Credential,
    unavailable: string | null
  ): Entry {
    const provider =
      credential && 'oauth' in credential ? new StoredOAuthProvider(id, credential.oauth) : null
    const key = credential && 'keyLabel' in credential ? new StoredApiKey(id) : null
    const stored = provider?.hasTokens() ?? key?.has()
    const entry: Entry = {
      config,
      provider,
      key,
      client: null,
      tools: {},
      generation: 0,
      connecting: null,
      status: {
        id,
        name,
        source,
        url: 'url' in config ? config.url : null,
        auth: stored === undefined ? 'none' : stored ? 'signedIn' : 'signedOut',
        unavailable,
        group,
        keyLabel: credential && 'keyLabel' in credential ? credential.keyLabel : null,
        enabled: !this.disabled.has(id),
        connected: false,
        error: null,
        tools: []
      }
    }
    this.entries.set(id, entry)
    return entry
  }

  /** Connects one server and gates its tools. Reports a 401 instead of throwing it. */
  private async open(
    entry: Entry
  ): Promise<
    { unauthorized: false } | { unauthorized: true; transport: StreamableHTTPClientTransport }
  > {
    const cfg = entry.config as ServerConfig
    if (!this.isLive(entry)) return { unauthorized: false }
    // The previous client closes before the new one connects. disconnect bumps the generation
    // before its first await, so this connect owns the generation read right after it.
    const closing = this.disconnect(entry)
    const generation = entry.generation
    await closing
    const stale = (): boolean => entry.generation !== generation || !this.isLive(entry)
    if (stale()) return { unauthorized: false }
    const connecting = new AbortController()
    entry.connecting = connecting

    const client = new Client(
      { name: 'hearth', version: '0.1.0' },
      {
        listChanged: {
          tools: {
            autoRefresh: false,
            onChanged: () => {
              if (entry.client !== client) return
              void this.loadTools(entry, client).then(() => this.publish())
            }
          }
        }
      }
    )
    const key = entry.key?.get()
    const transport =
      'command' in cfg
        ? new StdioClientTransport({
            command: cfg.command,
            args: cfg.args,
            // Only the SDK's safe basics (PATH, home and temp folders) plus what mcp.json gives,
            // never Hearth's own environment with the API keys loaded from .env.
            env: { ...getDefaultEnvironment(), ...cfg.env },
            cwd: cfg.cwd,
            stderr: 'ignore'
          })
        : new StreamableHTTPClientTransport(new URL(cfg.url), {
            requestInit: {
              headers: key ? { ...cfg.headers, Authorization: `Bearer ${key}` } : cfg.headers
            },
            authProvider: entry.provider ?? undefined,
            fetch: networkFetch
          })

    try {
      await client.connect(transport, { signal: connecting.signal })
    } catch (err) {
      if (stale()) {
        // Closed or replaced while connecting: nothing to report, just make sure it is gone.
        await client.close().catch(() => {})
        return { unauthorized: false }
      }
      if (err instanceof UnauthorizedError && transport instanceof StreamableHTTPClientTransport) {
        this.setAuth(entry, entry.status.auth === 'signingIn' ? 'signingIn' : 'signedOut', null)
        return { unauthorized: true, transport }
      }
      if (entry.key && err instanceof StreamableHTTPError && [401, 403].includes(err.code ?? 0)) {
        entry.key.forget()
        this.setAuth(entry, 'signedOut', `${entry.status.name} rejected the key`)
        return { unauthorized: false }
      }
      entry.status = { ...entry.status, connected: false, error: (err as Error).message, tools: [] }
      hub.record('error', `MCP ${entry.status.name} failed: ${(err as Error).message}`)
      return { unauthorized: false }
    } finally {
      if (entry.connecting === connecting) entry.connecting = null
    }
    if (stale()) {
      // A newer connect or a close won; this client would otherwise live on outside the map.
      await client.close().catch(() => {})
      return { unauthorized: false }
    }

    entry.client = client
    await this.loadTools(entry, client)
    if (entry.client === client && entry.status.connected) {
      const read = entry.status.tools.filter((t) => t.allowed).length
      hub.record(
        'mcp',
        `Connected ${entry.status.name}: ${read} read tools, ${entry.status.tools.length - read} blocked`
      )
    }
    return { unauthorized: false }
  }

  /** Lists the server's tools, a bounded number of pages, and rebuilds its gated tool set. */
  private async loadTools(entry: Entry, client: Client): Promise<void> {
    const cfg = entry.config as ServerConfig
    try {
      const tools: Awaited<ReturnType<Client['listTools']>>['tools'] = []
      const seen = new Set<string>()
      let cursor: string | undefined
      let pages = 0
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined)
        tools.push(...page.tools)
        pages++
        // A repeated cursor would loop forever, so it ends the listing like a missing one.
        cursor = page.nextCursor && !seen.has(page.nextCursor) ? page.nextCursor : undefined
        if (cursor) seen.add(cursor)
      } while (cursor && pages < MAX_TOOL_PAGES)
      if (cursor) {
        hub.record(
          'error',
          `${entry.status.name} lists more than ${MAX_TOOL_PAGES} pages of tools; Hearth uses the first ${MAX_TOOL_PAGES}`
        )
      }
      // Replaced or closed while listing: the newer connection sets the tools.
      if (entry.client !== client) return

      const gated: ToolSet = {}
      const infos: McpToolInfo[] = tools.map((t) => {
        const verdict = gateTool(t as ToolMeta, cfg)
        const exposedAs = `${safeName(entry.status.id)}__${safeName(t.name)}`
        if (verdict.allowed) {
          gated[exposedAs] = dynamicTool({
            description: `[${entry.status.name}, read-only] ${t.description ?? t.name}`,
            inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
            execute: async (input, { abortSignal }) => {
              hub.record('tool', `MCP ${entry.status.name}.${t.name}`)
              // An interrupted turn aborts the signal, which cancels the call on the server too.
              const result = await client.callTool(
                { name: t.name, arguments: input as Record<string, unknown> },
                undefined,
                { signal: abortSignal, timeout: TOOL_TIMEOUT_MS }
              )
              const body = JSON.stringify(result.content ?? result).slice(0, 10_000)
              if (result.isError) throw new Error(`${entry.status.name} returned an error: ${body}`)
              return body
            }
          })
        }
        return {
          server: entry.status.name,
          name: t.name,
          exposedAs,
          allowed: verdict.allowed,
          reason: verdict.reason
        }
      })
      entry.tools = gated
      entry.status = {
        ...entry.status,
        connected: true,
        auth: entry.provider || entry.key ? 'signedIn' : 'none',
        error: null,
        tools: infos
      }
    } catch (err) {
      if (entry.client !== client) return
      entry.tools = {}
      entry.status = { ...entry.status, connected: false, error: (err as Error).message, tools: [] }
    }
  }

  /** Read through a call: sign-in replaces entry.status across awaits. */
  private authOf(entry: Entry): McpAuthState {
    return entry.status.auth
  }

  private setAuth(entry: Entry, auth: McpAuthState, error: string | null): void {
    entry.status = { ...entry.status, auth, error, connected: false, tools: [] }
    this.publish()
  }

  private save(): void {
    const custom: CustomServer[] = [...this.entries.values()]
      .filter((e) => e.status.source === 'custom' && e.status.url)
      .map((e) => ({
        id: e.status.id,
        name: e.status.name,
        url: e.status.url as string,
        ...(e.key ? { key: true } : {})
      }))
    const file: ConnectorsFile = { custom, disabled: [...this.disabled] }
    writeJson(CUSTOM_FILE, file)
  }

  private publish(): void {
    hub.mcp = [...this.entries.values()].map((e) => e.status)
    hub.changed()
  }
}

function hasAuthHeader(headers: Record<string, string> | undefined): boolean {
  return Object.keys(headers ?? {}).some((h) => h.toLowerCase() === 'authorization')
}

export const mcp = new McpManager()
