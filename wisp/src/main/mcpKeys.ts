import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { safeStorage } from 'electron'
import { dataPath } from './store'

/**
 * An API key or access token for one MCP server, persisted with Electron safeStorage like the
 * OAuth tokens. Without OS encryption the key lives in memory only and never touches disk.
 */
export class StoredApiKey {
  private key: string | null
  private readonly file: string

  constructor(id: string) {
    this.file = dataPath(`mcp-keys/${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`)
    this.key = readKey(this.file)
  }

  get(): string | null {
    return this.key
  }

  has(): boolean {
    return Boolean(this.key)
  }

  save(key: string): void {
    this.key = key
    if (!safeStorage.isEncryptionAvailable()) return
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, safeStorage.encryptString(key))
  }

  forget(): void {
    this.key = null
    rmSync(this.file, { force: true })
  }
}

function readKey(file: string): string | null {
  if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(readFileSync(file)) || null
  } catch {
    return null
  }
}
