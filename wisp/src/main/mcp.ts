import { readFileSync } from 'fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { dynamicTool, jsonSchema, type ToolSet } from 'ai'
import { z } from 'zod'
import type { McpServerStatus, McpToolInfo } from '../shared/types'
import { hub } from './hub'

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
  'send', 'write', 'delete', 'del', 'create', 'update', 'patch', 'put', 'post', 'remove', 'trash',
  'modify', 'move', 'rename', 'insert', 'upload', 'edit', 'set', 'add', 'append', 'archive',
  'publish', 'reply', 'forward', 'draft', 'submit', 'execute', 'exec', 'run', 'push', 'merge',
  'close', 'assign', 'invite', 'share', 'schedule', 'cancel', 'approve', 'revoke', 'grant', 'drop'
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
export function gateTool(tool: ToolMeta, server: ServerConfig): { allowed: boolean; reason: string } {
  if (server.allowTools?.includes(tool.name)) return { allowed: true, reason: 'explicitly allowed in mcp.json' }
  const hints = tool.annotations ?? {}
  if (hints.destructiveHint === true) return { allowed: false, reason: 'server marks it destructive' }
  if (hints.readOnlyHint === false) return { allowed: false, reason: 'server marks it not read-only' }
  const verb = nameWords(tool.name).find((w) => WRITE_WORDS.has(w))
  if (verb) return { allowed: false, reason: `name contains write verb "${verb}"` }
  if (server.requireReadOnlyHint && hints.readOnlyHint !== true) {
    return { allowed: false, reason: 'readOnlyHint required but missing' }
  }
  return { allowed: true, reason: hints.readOnlyHint ? 'server marks it read-only' : 'no write signals found' }
}

const safeName = (s: string): string => s.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60)

class McpManager {
  private clients: Client[] = []
  private tools: ToolSet = {}

  async load(configPath: string | null): Promise<void> {
    await this.close()
    if (!configPath) {
      hub.mcp = []
      hub.changed()
      return
    }

    let parsed: z.infer<typeof configSchema>
    try {
      parsed = configSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')))
    } catch (err) {
      hub.mcp = [{ name: 'mcp.json', connected: false, error: `Invalid config: ${(err as Error).message}`, tools: [] }]
      hub.record('error', 'mcp.json could not be parsed')
      return
    }

    const statuses = await Promise.all(
      Object.entries(parsed.mcpServers)
        .filter(([, cfg]) => !cfg.disabled)
        .map(([name, cfg]) => this.connect(name, cfg))
    )
    hub.mcp = statuses
    hub.changed()
  }

  private async connect(name: string, cfg: ServerConfig): Promise<McpServerStatus> {
    const client = new Client({ name: 'wisp', version: '0.1.0' })
    try {
      const transport =
        'command' in cfg
          ? new StdioClientTransport({
              command: cfg.command,
              args: cfg.args,
              env: { ...(process.env as Record<string, string>), ...cfg.env },
              cwd: cfg.cwd,
              stderr: 'ignore'
            })
          : new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } })
      await client.connect(transport)
      this.clients.push(client)

      const { tools } = await client.listTools()
      const infos: McpToolInfo[] = tools.map((t) => {
        const verdict = gateTool(t as ToolMeta, cfg)
        const exposedAs = `${safeName(name)}__${safeName(t.name)}`
        if (verdict.allowed) {
          this.tools[exposedAs] = dynamicTool({
            description: `[${name}, read-only] ${t.description ?? t.name}`,
            inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
            execute: async (input) => {
              hub.record('tool', `MCP ${name}.${t.name}`)
              const result = await client.callTool({ name: t.name, arguments: input as Record<string, unknown> })
              return JSON.stringify(result.content ?? result).slice(0, 8_000)
            }
          })
        }
        return { server: name, name: t.name, exposedAs, allowed: verdict.allowed, reason: verdict.reason }
      })
      const blocked = infos.filter((i) => !i.allowed).length
      hub.record('mcp', `Connected ${name}: ${infos.length - blocked} read tools, ${blocked} blocked`)
      return { name, connected: true, error: null, tools: infos }
    } catch (err) {
      hub.record('error', `MCP ${name} failed: ${(err as Error).message}`)
      return { name, connected: false, error: (err as Error).message, tools: [] }
    }
  }

  toolset(): ToolSet {
    return this.tools
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.clients.map((c) => c.close()))
    this.clients = []
    this.tools = {}
  }
}

export const mcp = new McpManager()
