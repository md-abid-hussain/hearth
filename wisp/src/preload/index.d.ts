import type { MainToRenderer, McpServerStatus, Settings, VitalsPoint, WispState } from '../shared/types'

export interface WispApi {
  getState(): Promise<WispState>
  getHistory(): Promise<VitalsPoint[]>
  getSmartSpectraKey(): Promise<string>

  setSensing(on: boolean): void
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
  quit(): void

  updateSettings(patch: Partial<Settings>): Promise<Settings>
  unpin(index: number): Promise<void>
  cancelReminder(id: string): Promise<boolean>
  reloadMcp(): Promise<McpServerStatus[]>
  /** Resolves once the browser sign-in finishes, fails or times out. */
  connectApp(slug: string): Promise<void>
  disconnectApp(slug: string): Promise<void>
  refreshApps(): Promise<void>
  wipeData(): Promise<void>

  onEvent(listener: (msg: MainToRenderer) => void): () => void
}

declare global {
  interface Window {
    wisp: WispApi
  }
}
