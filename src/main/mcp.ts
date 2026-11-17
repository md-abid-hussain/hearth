import { readFileSync } from 'fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
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

/** Verbs that signal a side effect. Matched against snake/camel/kebab-split name words. */
const WRITE_WORDS = new Set([
  'send',
  'write',
  'delete',
  'del',
  'create',
  'update',
  'patch',
  'put',
  'post',
  'remove',
  'trash',
  'modify',
  'move',
  'rename',
  'insert',
  'upload',
  'edit',
  'set',
  'add',
  'append',
  'archive',
  'publish',
  'reply',
  'forward',
  'draft',
  'submit',
  'execute',
  'exec',
  'run',
  'push',
  'merge',
  'close',
  'assign',
  'invite',
  'share',
  'schedule',
  'cancel',
  'approve',
  'revoke',
  'grant',
  'drop'
])

interface ToolMeta {
  name: string
  description?: string
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }
}

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.:/]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean)
}

/** The first word in a tool name that signals a side effect, if any. */
export function writeVerb(name: string): string | undefined {
  return nameWords(name).find((w) => WRITE_WORDS.has(w))
}

/** Deny-by-default read-only gate. Returns why a tool is allowed or blocked. */
export function gateTool(
  tool: ToolMeta,
  server: ServerConfig
): { allowed: boolean; reason: string } {
  if (server.allowTools?.includes(tool.name))
    return { allowed: true, reason: 'explicitly allowed in mcp.json' }
  const hints = tool.annotations ?? {}
  if (hints.destructiveHint === true)
    return { allowed: false, reason: 'server marks it destructive' }
  if (hints.readOnlyHint === false)
    return { allowed: false, reason: 'server marks it not read-only' }
  const verb = writeVerb(tool.name)
  if (verb) return { allowed: false, reason: `name contains write verb "${verb}"` }
  if (server.requireReadOnlyHint && hints.readOnlyHint !== true) {
    return { allowed: false, reason: 'readOnlyHint required but missing' }
  }
  return {
    allowed: true,
    reason: hints.readOnlyHint ? 'server marks it read-only' : 'no write signals found'
  }
}

const NETWORK_RETRY_MS = 400

function networkCause(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause
  return cause?.code ?? cause?.message ?? (err as Error).message
}

/**
 * fetch only rejects when no response arrived, typically a pooled connection the server
 * already closed. Those get one fresh attempt, and the final error names the real cause
 * instead of a bare "fetch failed". Every Hearth tool is read-only, so repeating is safe.
 */
const networkFetch: FetchLike = async (url, init) => {
  try {
    return await fetch(url, init)
  } catch (err) {
    if (init?.signal?.aborted) throw err
    await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_MS))
    try {
      return await fetch(url, init)
    } catch (second) {
      throw new Error(`Could not reach ${new URL(String(url)).host} (${networkCause(second)})`, {
        cause: second
      })
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
}

class McpManager {
  private entries = new Map<string, Entry>()
  private signInWaits = new Map<string, AuthCodeWait>()
  private disabled = new Set<string>()

  async load(configPath: string | null): Promise<void> {
    await this.close()
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
      this.signInWaits.delete(id)
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
    entry.provider?.forget()
    entry.key?.forget()
    await entry.client?.close().catch(() => {})
    entry.client = null
    entry.tools = {}
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
      await entry.client?.close().catch(() => {})
      entry.client = null
      entry.tools = {}
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

  async close(): Promise<void> {
    await Promise.allSettled([...this.entries.values()].map((e) => e.client?.close()))
    this.entries.clear()
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
    await entry.client?.close().catch(() => {})
    entry.client = null
    entry.tools = {}

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
            env: { ...(process.env as Record<string, string>), ...cfg.env },
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
      await client.connect(transport)
    } catch (err) {
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
    }

    entry.client = client
    await this.loadTools(entry, client)
    if (entry.status.connected) {
      const read = entry.status.tools.filter((t) => t.allowed).length
      hub.record(
        'mcp',
        `Connected ${entry.status.name}: ${read} read tools, ${entry.status.tools.length - read} blocked`
      )
    }
    return { unauthorized: false }
  }

  /** Lists every page of tools and rebuilds the gated tool set for one server. */
  private async loadTools(entry: Entry, client: Client): Promise<void> {
    const cfg = entry.config as ServerConfig
    try {
      const tools: Awaited<ReturnType<Client['listTools']>>['tools'] = []
      let cursor: string | undefined
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined)
        tools.push(...page.tools)
        cursor = page.nextCursor
      } while (cursor)

      const gated: ToolSet = {}
      const infos: McpToolInfo[] = tools.map((t) => {
        const verdict = gateTool(t as ToolMeta, cfg)
        const exposedAs = `${safeName(entry.status.id)}__${safeName(t.name)}`
        if (verdict.allowed) {
          gated[exposedAs] = dynamicTool({
            description: `[${entry.status.name}, read-only] ${t.description ?? t.name}`,
            inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
            execute: async (input) => {
              hub.record('tool', `MCP ${entry.status.name}.${t.name}`)
              const result = await client.callTool({
                name: t.name,
                arguments: input as Record<string, unknown>
              })
              const body = JSON.stringify(result.content ?? result).slice(0, 8_000)
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
