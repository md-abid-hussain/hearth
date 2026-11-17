import '@smartspectra/node-sdk/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type { MainToRenderer, Settings } from '../shared/types'
import type { WispApi } from './index.d'

const api: WispApi = {
  getState: () => ipcRenderer.invoke('wisp:getState'),
  getHistory: () => ipcRenderer.invoke('wisp:getHistory'),
  getSmartSpectraKey: () => ipcRenderer.invoke('wisp:getSmartSpectraKey'),

  setSensing: (on: boolean) => ipcRenderer.send('wisp:sensing', on),
  pushMetrics: (buf: Uint8Array) => ipcRenderer.send('wisp:metrics', buf),
  pushValidation: (hint: string | null) => ipcRenderer.send('wisp:validation', hint),
  pushInsight: (buf: Uint8Array, requestId: number) => ipcRenderer.send('wisp:insight', buf, requestId),
  bindInsight: (token: string, requestId: number) => ipcRenderer.send('wisp:insightBound', token, requestId),
  failInsight: (token: string) => ipcRenderer.send('wisp:insightFailed', token),
  reportSdkError: (message: string, fatal: boolean) => ipcRenderer.send('wisp:sdkError', message, fatal),

  pttStart: () => ipcRenderer.send('wisp:pttStart'),
  pttAudio: (chunk: Uint8Array) => ipcRenderer.send('wisp:pttAudio', chunk),
  pttStop: () => ipcRenderer.send('wisp:pttStop'),
  sendTyped: (text: string) => ipcRenderer.send('wisp:typed', text),
  playbackIdle: () => ipcRenderer.send('wisp:playbackIdle'),
  openDashboard: () => ipcRenderer.send('wisp:openDashboard'),
  quit: () => ipcRenderer.send('wisp:quit'),

  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('wisp:updateSettings', patch),
  unpin: (index: number) => ipcRenderer.invoke('wisp:unpin', index),
  cancelReminder: (id: string) => ipcRenderer.invoke('wisp:cancelReminder', id),
  reloadMcp: () => ipcRenderer.invoke('wisp:reloadMcp'),
  mcpSignIn: (id: string) => ipcRenderer.invoke('wisp:mcpSignIn', id),
  mcpCancelSignIn: (id: string) => ipcRenderer.invoke('wisp:mcpCancelSignIn', id),
  mcpSignOut: (id: string) => ipcRenderer.invoke('wisp:mcpSignOut', id),
  mcpAddServer: (name: string, url: string, apiKey?: string) =>
    ipcRenderer.invoke('wisp:mcpAddServer', name, url, apiKey),
  mcpSetKey: (id: string, key: string) => ipcRenderer.invoke('wisp:mcpSetKey', id, key),
  mcpSetEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('wisp:mcpSetEnabled', id, enabled),
  wipeData: () => ipcRenderer.invoke('wisp:wipeData'),

  onEvent: (listener: (msg: MainToRenderer) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, msg: MainToRenderer): void => listener(msg)
    ipcRenderer.on('wisp:event', handler)
    return () => ipcRenderer.removeListener('wisp:event', handler)
  }
}

contextBridge.exposeInMainWorld('wisp', api)
