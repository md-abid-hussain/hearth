import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { dirname } from 'path'
import { safeStorage, shell } from 'electron'
import type {
  OAuthClientProvider,
  OAuthDiscoveryState
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { dataPath } from './store'

/** Fixed so a client registered once with a server keeps a valid redirect URI. */
const CALLBACK_PORT = 33418
const CALLBACK_PATH = '/oauth/callback'
const REDIRECT_URL = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`
const SIGN_IN_TIMEOUT_MS = 3 * 60_000

export interface AuthOptions {
  /** For servers without dynamic client registration, such as Google's. */
  client?: OAuthClientInformationMixed
  /** Replaces the scope the server advertises, so Wisp only asks for read access. */
  scope?: string
  /** Extra query parameters for the authorization URL. */
  authParams?: Record<string, string>
}

interface Saved {
  client?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  verifier?: string
  discovery?: OAuthDiscoveryState
}

/**
 * OAuth state for one MCP server, persisted with Electron safeStorage (DPAPI on Windows,
 * Keychain on macOS). Without OS encryption the tokens live in memory only.
 */
export class StoredOAuthProvider implements OAuthClientProvider {
  /** Off during startup, so a 401 marks the server signed out instead of opening a browser. */
  interactive = false
  private saved: Saved
  private readonly file: string
  private pendingState: string | null = null

  constructor(
    id: string,
    private readonly options: AuthOptions = {}
  ) {
    this.file = dataPath(`mcp-auth/${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`)
    this.saved = readSecret(this.file)
  }

  get redirectUrl(): string {
    return REDIRECT_URL
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Wisp',
      redirect_uris: [REDIRECT_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.options.client?.client_secret
        ? 'client_secret_post'
        : 'none',
      ...(this.options.scope ? { scope: this.options.scope } : {})
    }
  }

  state(): string {
    this.pendingState = randomBytes(16).toString('hex')
    return this.pendingState
  }

  get expectedState(): string | null {
    return this.pendingState
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.options.client ?? this.saved.client
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.saved.client = info
    this.persist()
  }

  tokens(): OAuthTokens | undefined {
    return this.saved.tokens
  }

  saveTokens(tokens: OAuthTokens): void {
    this.saved.tokens = tokens
    this.persist()
  }

  hasTokens(): boolean {
    return Boolean(this.saved.tokens)
  }

  saveCodeVerifier(verifier: string): void {
    this.saved.verifier = verifier
    this.persist()
  }

  codeVerifier(): string {
    if (!this.saved.verifier) throw new Error('No sign-in is in progress')
    return this.saved.verifier
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.saved.discovery = state
    this.persist()
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.saved.discovery
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') this.saved = {}
    else if (scope === 'client') delete this.saved.client
    else if (scope === 'tokens') delete this.saved.tokens
    else if (scope === 'verifier') delete this.saved.verifier
    else delete this.saved.discovery
    this.persist()
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    if (!this.interactive) return
    if (url.protocol !== 'https:') throw new Error('The sign-in page is not https')
    if (this.options.scope) url.searchParams.set('scope', this.options.scope)
    for (const [key, value] of Object.entries(this.options.authParams ?? {}))
      url.searchParams.set(key, value)
    await shell.openExternal(url.toString())
  }

  forget(): void {
    this.saved = {}
    rmSync(this.file, { force: true })
  }

  private persist(): void {
    if (!safeStorage.isEncryptionAvailable()) return
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, safeStorage.encryptString(JSON.stringify(this.saved)))
  }
}

function readSecret(file: string): Saved {
  if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return {}
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(file))) as Saved
  } catch {
    return {}
  }
}

const PAGE = (message: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Wisp</title><body style="font-family:system-ui;padding:48px;background:#161616;color:#f3efe6"><h2>${message}</h2><p>You can close this tab and go back to Wisp.</p></body>`

export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in was cancelled')
  }
}

export interface AuthCodeWait {
  code: Promise<string>
  cancel(): void
}

let activeWait: AuthCodeWait | null = null

/**
 * Listens on the loopback redirect for one authorization response. Start it before the
 * browser opens; the response must carry the state the provider generated.
 */
export function waitForAuthCode(provider: StoredOAuthProvider): AuthCodeWait {
  activeWait?.cancel()
  let finish: (err: Error | null, code?: string) => void = () => {}
  const code = new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URL)
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end()
        return
      }
      const error = url.searchParams.get('error')
      const received = url.searchParams.get('code')
      const ok = !error && received && url.searchParams.get('state') === provider.expectedState
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(PAGE(ok ? 'Signed in.' : 'Sign-in did not complete.'))
      if (ok) finish(null, received)
      else
        finish(
          new Error(
            error ? `Sign-in was declined (${error})` : 'The sign-in response did not match'
          )
        )
    })
    const timer = setTimeout(() => finish(new Error('Sign-in timed out')), SIGN_IN_TIMEOUT_MS)
    let settled = false
    finish = (err, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      if (activeWait === wait) activeWait = null
      if (err) reject(err)
      else resolve(value as string)
    }
    server.on('error', (err) => finish(err))
    server.listen(CALLBACK_PORT, '127.0.0.1')
  })
  code.catch(() => {})
  const wait: AuthCodeWait = { code, cancel: () => finish(new SignInCancelled()) }
  activeWait = wait
  return wait
}
