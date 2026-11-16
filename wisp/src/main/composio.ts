import { Composio } from '@composio/core'
import { VercelProvider } from '@composio/vercel'
import type { ToolSet } from 'ai'
import { shell } from 'electron'
import type { ConnectedApp } from '../shared/types'
import { loadConfig } from './config'
import { hub } from './hub'

/** One desktop, one person: every connection belongs to this local user. */
const USER_ID = 'wisp-local'
const APPS = ['gmail', 'googlecalendar', 'github', 'slack', 'notion', 'googledrive', 'linear']
const SIGN_IN_WAIT_MS = 5 * 60_000

type Client = Composio<VercelProvider>
type Session = Awaited<ReturnType<Client['create']>>

/**
 * Sessions only expose tools Composio tags read-only and never destructive, and Composio enforces
 * the same filter when a tool runs. The sandbox, raw proxy calls and in-chat sign-in are off, so
 * the model can search for and run read tools on apps the user linked here, nothing else.
 */
function sessionFor(client: Client, toolkits: string[]): Promise<Session> {
  return client.create(USER_ID, {
    toolkits,
    tags: { enable: ['readOnlyHint'], disable: ['destructiveHint'] },
    manageConnections: false,
    sandbox: { enable: false },
    proxyExecute: false
  })
}

class AppConnections {
  private client: Client | null = null
  private catalog: Session | null = null
  private tools: ToolSet = {}
  private accounts = new Map<string, string>()
  private pending = new Set<string>()

  async load(): Promise<void> {
    const key = loadConfig().composioKey
    if (!key) {
      hub.apps = { configured: false, apps: [], error: null }
      hub.changed()
      return
    }
    this.client = new Composio({
      apiKey: key,
      provider: new VercelProvider(),
      allowTracking: false,
      disableVersionCheck: true
    })
    await this.refresh()
  }

  /** Re-reads which apps are linked and rebuilds the agent's tools around them. */
  async refresh(): Promise<void> {
    if (!this.client) return
    try {
      this.catalog ??= await sessionFor(this.client, APPS)
      const { items } = await this.catalog.toolkits()
      this.accounts.clear()
      const apps: ConnectedApp[] = items.map((item) => {
        const account = item.connection?.connectedAccount
        const connected = Boolean(item.connection?.isActive)
        if (connected && account) this.accounts.set(item.slug, account.id)
        return {
          slug: item.slug,
          name: item.name,
          connected,
          pending: this.pending.has(item.slug)
        }
      })
      const linked = apps.filter((a) => a.connected).map((a) => a.slug)
      this.tools = linked.length ? await (await sessionFor(this.client, linked)).tools() : {}
      hub.apps = { configured: true, apps, error: null }
    } catch (err) {
      this.tools = {}
      hub.apps = { ...hub.apps, configured: true, error: `Composio: ${(err as Error).message}` }
      hub.record('error', `Composio could not load apps: ${(err as Error).message}`)
    }
    hub.changed()
  }

  /** Opens Composio's hosted sign-in in the browser and waits for the user to finish it. */
  async connect(slug: string): Promise<void> {
    if (!this.client || !APPS.includes(slug) || this.pending.has(slug)) return
    this.pending.add(slug)
    this.showPending()
    try {
      this.catalog ??= await sessionFor(this.client, APPS)
      const request = await this.catalog.authorize(slug)
      const url = new URL(request.redirectUrl ?? '')
      if (url.protocol !== 'https:')
        throw new Error('Composio returned a sign-in link that is not https')
      await shell.openExternal(url.toString())
      await request.waitForConnection(SIGN_IN_WAIT_MS)
      hub.record('mcp', `Connected ${slug} through Composio`)
    } catch (err) {
      hub.record('error', `Could not connect ${slug}: ${(err as Error).message}`)
    } finally {
      this.pending.delete(slug)
      await this.refresh()
    }
  }

  async disconnect(slug: string): Promise<void> {
    const id = this.accounts.get(slug)
    if (!this.client || !id) return
    try {
      await this.client.connectedAccounts.delete(id)
      hub.record('mcp', `Disconnected ${slug}`)
    } catch (err) {
      hub.record('error', `Could not disconnect ${slug}: ${(err as Error).message}`)
    }
    await this.refresh()
  }

  private showPending(): void {
    hub.apps = {
      ...hub.apps,
      apps: hub.apps.apps.map((a) => ({ ...a, pending: this.pending.has(a.slug) }))
    }
    hub.changed()
  }

  toolset(): ToolSet {
    return this.tools
  }
}

export const apps = new AppConnections()
