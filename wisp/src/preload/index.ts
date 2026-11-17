import '@smartspectra/node-sdk/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type { MainToRenderer, Settings } from '../shared/types'
import type { HearthApi } from './index.d'

const api: HearthApi = {
  getState: () => ipcRenderer.invoke('hearth:getState'),
  getHistory: () => ipcRenderer.invoke('hearth:getHistory'),
  getSmartSpectraKey: () => ipcRenderer.invoke('hearth:getSmartSpectraKey'),

  setSensing: (on: boolean) => ipcRenderer.send('hearth:sensing', on),
  requestSensing: (on: boolean) => ipcRenderer.send('hearth:requestSensing', on),
  pushMetrics: (buf: Uint8Array) => ipcRenderer.send('hearth:metrics', buf),
  pushValidation: (hint: string | null) => ipcRenderer.send('hearth:validation', hint),
  pushInsight: (buf: Uint8Array, requestId: number) => ipcRenderer.send('hearth:insight', buf, requestId),
  bindInsight: (token: string, requestId: number) => ipcRenderer.send('hearth:insightBound', token, requestId),
  failInsight: (token: string) => ipcRenderer.send('hearth:insightFailed', token),
  reportSdkError: (message: string, fatal: boolean) => ipcRenderer.send('hearth:sdkError', message, fatal),

  pttStart: () => ipcRenderer.send('hearth:pttStart'),
  pttAudio: (chunk: Uint8Array) => ipcRenderer.send('hearth:pttAudio', chunk),
  pttStop: () => ipcRenderer.send('hearth:pttStop'),
  sendTyped: (text: string) => ipcRenderer.send('hearth:typed', text),
  playbackIdle: () => ipcRenderer.send('hearth:playbackIdle'),
  openDashboard: () => ipcRenderer.send('hearth:openDashboard'),
  setPillInteractive: (on: boolean) => ipcRenderer.send('hearth:pillInteractive', on),
  quit: () => ipcRenderer.send('hearth:quit'),

  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('hearth:updateSettings', patch),
  unpin: (index: number) => ipcRenderer.invoke('hearth:unpin', index),
  cancelReminder: (id: string) => ipcRenderer.invoke('hearth:cancelReminder', id),
  reloadMcp: () => ipcRenderer.invoke('hearth:reloadMcp'),
  mcpSignIn: (id: string) => ipcRenderer.invoke('hearth:mcpSignIn', id),
  mcpCancelSignIn: (id: string) => ipcRenderer.invoke('hearth:mcpCancelSignIn', id),
  mcpSignOut: (id: string) => ipcRenderer.invoke('hearth:mcpSignOut', id),
  mcpAddServer: (name: string, url: string, apiKey?: string) =>
    ipcRenderer.invoke('hearth:mcpAddServer', name, url, apiKey),
  mcpSetKey: (id: string, key: string) => ipcRenderer.invoke('hearth:mcpSetKey', id, key),
  mcpSetEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('hearth:mcpSetEnabled', id, enabled),
  wipeData: () => ipcRenderer.invoke('hearth:wipeData'),

  onEvent: (listener: (msg: MainToRenderer) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, msg: MainToRenderer): void => listener(msg)
    ipcRenderer.on('hearth:event', handler)
    return () => ipcRenderer.removeListener('hearth:event', handler)
  }
}

contextBridge.exposeInMainWorld('hearth', api)
