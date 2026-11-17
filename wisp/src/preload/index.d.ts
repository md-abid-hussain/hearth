import type { MainToRenderer, McpServerStatus, Settings, VitalsPoint, HearthState } from '../shared/types'

export interface HearthApi {
  getState(): Promise<HearthState>
  getHistory(): Promise<VitalsPoint[]>
  getSmartSpectraKey(): Promise<string>

  setSensing(on: boolean): void
  /** Asks the dashboard window, which owns the camera session, to start or stop sensing. */
  requestSensing(on: boolean): void
  pushMetrics(buf: Uint8Array): void
  pushValidation(hint: string | null): void
  pushInsight(buf: Uint8Array, requestId: number): void
  bindInsight(token: string, requestId: number): void
  failInsight(token: string): void
  reportSdkError(message: string, fatal: boolean): void

  pttStart(): void
  pttAudio(chunk: Uint8Array): void
  pttStop(): void
  sendTyped(text: string): void
  playbackIdle(): void
  openDashboard(): void
  /** The pill window passes clicks through except where this says the pointer is over the widget. */
  setPillInteractive(on: boolean): void
  quit(): void

  updateSettings(patch: Partial<Settings>): Promise<Settings>
  unpin(index: number): Promise<void>
  cancelReminder(id: string): Promise<boolean>
  reloadMcp(): Promise<McpServerStatus[]>
  /** Resolves once the browser sign-in finishes, fails or times out. */
  mcpSignIn(id: string): Promise<void>
  mcpCancelSignIn(id: string): Promise<void>
  /** Forgets the stored tokens or key; servers added by URL are removed as well. */
  mcpSignOut(id: string): Promise<void>
  /**
   * Returns an error message, or null once the server is saved. An API key is stored encrypted
   * and sent as a Bearer token instead of signing in with OAuth.
   */
  mcpAddServer(name: string, url: string, apiKey?: string): Promise<string | null>
  /** Saves a pasted key for a key-based connector and connects. Returns an error message or null. */
  mcpSetKey(id: string, key: string): Promise<string | null>
  /** Off hides the connector's tools from the model but keeps its credentials. */
  mcpSetEnabled(id: string, enabled: boolean): Promise<void>
  wipeData(): Promise<void>

  onEvent(listener: (msg: MainToRenderer) => void): () => void
}

declare global {
  interface Window {
    hearth: HearthApi
  }
}
