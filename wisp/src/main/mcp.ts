import { readFileSync } from 'fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { dynamicTool, jsonSchema, type ToolSet } from 'ai'
import { z } from 'zod'
import type { McpAuthState, McpServerStatus, McpToolInfo } from '../shared/types'
import { loadConfig, type WispConfig } from './config'
import { hub } from './hub'
import {
  SignInCancelled,
  StoredOAuthProvider,
  waitForAuthCode,
  type AuthCodeWait,
  type AuthOptions
} from './mcpAuth'
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
  const verb = nameWords(tool.name).find((w) => WRITE_WORDS.has(w))
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
 * instead of a bare "fetch failed". Every Wisp tool is read-only, so repeating is safe.
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
  /** Auth options, or why the preset cannot be used with this .env. */
  auth(cfg: WispConfig): AuthOptions | string
}

const GOOGLE_SCOPE = (scopes: string[]): string =>
  scopes.map((s) => `https://www.googleapis.com/auth/${s}`).join(' ')

function google(id: string, name: string, url: string, scopes: string[]): Preset {
  return {
    id,
    name,
    url,
    auth: (cfg) =>
      cfg.googleClientId
        ? {
            client: {
              client_id: cfg.googleClientId,
              client_secret: cfg.googleClientSecret || undefined,
              issuer: 'https://accounts.google.com'
            },
            scope: GOOGLE_SCOPE(scopes),
            // Google only issues a refresh token with these, otherwise sign-in lasts an hour.
            authParams: { access_type: 'offline', prompt: 'consent' }
          }
        : 'Needs GOOGLE_OAUTH_CLIENT_ID in .env'
  }
}

/** Official hosted MCP servers. Notion and Linear register Wisp themselves; Google needs a client. */
const PRESETS: Preset[] = [
  { id: 'notion', name: 'Notion', url: 'https://mcp.notion.com/mcp', auth: () => ({}) },
  {
    id: 'linear',
    name: 'Linear',
    url: 'https://mcp.linear.app/mcp/readonly',
    auth: () => ({ scope: 'read' })
  },
  google('gmail', 'Gmail', 'https://gmailmcp.googleapis.com/mcp/v1', ['gmail.readonly']),
  google('calendar', 'Google Calendar', 'https://calendarmcp.googleapis.com/mcp/v1', [
    'calendar.calendarlist.readonly',
    'calendar.events.freebusy',
    'calendar.events.readonly'
  ]),
  google('drive', 'Google Drive', 'https://drivemcp.googleapis.com/mcp/v1', ['drive.readonly'])
]

const CUSTOM_FILE = 'connectors.json'

interface CustomServer {
  id: string
  name: string
  url: string
}

interface Entry {
  status: McpServerStatus
  config: ServerConfig | null
  provider: StoredOAuthProvider | null
  client: Client | null
  tools: ToolSet
}

class McpManager {
  private entries = new Map<string, Entry>()
  private signInWaits = new Map<string, AuthCodeWait>()

  async load(configPath: string | null): Promise<void> {
    await this.close()
    const cfg = loadConfig()

    for (const preset of PRESETS) {
      const auth = preset.auth(cfg)
      const usable = typeof auth !== 'string'
      this.add(
        preset.id,
        preset.name,
        'preset',
        { url: preset.url },
        usable ? auth : null,
        usable ? null : auth
      )
    }
    for (const custom of readJson<CustomServer[]>(CUSTOM_FILE, [])) {
      this.add(custom.id, custom.name, 'custom', { url: custom.url }, {}, null)
    }
    if (configPath) {
      try {
        const parsed = configSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')))
        for (const [name, server] of Object.entries(parsed.mcpServers)) {
          if (server.disabled) continue
          const oauth = 'url' in server && !hasAuthHeader(server.headers) ? {} : null
          this.add(`json-${name}`, name, 'mcp.json', server, oauth, null)
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
            (e.status.source !== 'preset' || e.provider?.hasTokens())
        )
        .map((e) => this.open(e))
    )
    this.publish()
  }

  async signIn(id: string): Promise<void> {
    const entry = this.entries.get(id)
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
    await entry.client?.close().catch(() => {})
    entry.client = null
    entry.tools = {}
    if (entry.status.source === 'custom') {
      this.entries.delete(id)
      writeJson(CUSTOM_FILE, this.customServers())
    } else {
      entry.status = {
        ...entry.status,
        connected: false,
        auth: 'signedOut',
        error: null,
        tools: []
      }
    }
    hub.record('mcp', `Signed out of ${entry.status.name}`)
    this.publish()
  }

  /** Saves a remote MCP server by URL and connects; it will ask for sign-in if it needs one. */
  async addServer(name: string, url: string): Promise<string | null> {
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

    const entry = this.add(id, label, 'custom', { url: parsed.toString() }, {}, null)
    writeJson(CUSTOM_FILE, this.customServers())
    await this.open(entry)
    this.publish()
    return null
  }

  toolset(): ToolSet {
    return Object.assign({}, ...[...this.entries.values()].map((e) => e.tools))
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.entries.values()].map((e) => e.client?.close()))
    this.entries.clear()
  }

  private add(
    id: string,
    name: string,
    source: McpServerStatus['source'],
    config: ServerConfig,
    oauth: AuthOptions | null,
    unavailable: string | null
  ): Entry {
    const provider = oauth ? new StoredOAuthProvider(id, oauth) : null
    const entry: Entry = {
      config,
      provider,
      client: null,
      tools: {},
      status: {
        id,
        name,
        source,
        url: 'url' in config ? config.url : null,
        auth: provider ? (provider.hasTokens() ? 'signedIn' : 'signedOut') : 'none',
        unavailable,
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
      { name: 'wisp', version: '0.1.0' },
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
            requestInit: { headers: cfg.headers },
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
        auth: entry.provider ? 'signedIn' : 'none',
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

  private customServers(): CustomServer[] {
    return [...this.entries.values()]
      .filter((e) => e.status.source === 'custom' && e.status.url)
      .map((e) => ({ id: e.status.id, name: e.status.name, url: e.status.url as string }))
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
