import { useSyncExternalStore } from 'react'
import type { MainToRenderer, VitalsPoint, HearthState } from '@shared/types'
import { player } from './player'
import { sensing } from './sensing'
import { share } from './share'

const HISTORY_LIMIT = 1_800

let state: HearthState | null = null
let history: VitalsPoint[] = []
/** Set by the first pushed state, which is newer than the snapshot asked for at startup. */
let statePushed = false
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

const stateListeners = new Set<(state: HearthState) => void>()

/** Subscribe to each new state outside React, such as to act the moment consent is withdrawn. */
export function onState(listener: (state: HearthState) => void): () => void {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
}

/** Keeps what a push did not change identical, and skips a push that changed nothing at all. */
function setState(next: HearthState): void {
  const kept = state ? share(state, next) : next
  if (kept === state) return
  state = kept
  emit()
  stateListeners.forEach((l) => l(kept))
}

function handle(msg: MainToRenderer): void {
  switch (msg.type) {
    case 'state':
      statePushed = true
      setState(msg.state)
      break
    case 'vitalsPoint':
      history = [...history.slice(-(HISTORY_LIMIT - 1)), msg.point]
      emit()
      break
    case 'ttsStart':
      player.begin()
      break
    case 'ttsAudio':
      player.push(msg.pcm)
      break
    case 'ttsEnd':
      player.end()
      break
    case 'ttsCancel':
      player.cancel()
      break
    case 'requestInsight':
      void sensing.requestInsight(msg.token, msg.prompt)
      break
    case 'sensingCommand':
      void runSensingCommand(msg.on)
      break
    case 'pttRemote':
      remotePtt.forEach((l) => l(msg.on))
      break
    case 'showPage':
      pageListeners.forEach((l) => l(msg.page))
      break
    case 'react':
      reactListeners.forEach((l) => l(msg.kind))
      break
  }
}

const reactListeners = new Set<(kind: 'dizzy') => void>()

/** Subscribe to brief face reactions, such as dizzy after the widget is shaken. */
export function onReact(listener: (kind: 'dizzy') => void): () => void {
  reactListeners.add(listener)
  return () => reactListeners.delete(listener)
}

const pageListeners = new Set<(page: string) => void>()

/** Subscribe to requests from the main process to open a dashboard page. */
export function onShowPage(listener: (page: string) => void): () => void {
  pageListeners.add(listener)
  return () => pageListeners.delete(listener)
}

/** Sensing started or stopped from the pill; failures go back to the pill as a notice. */
async function runSensingCommand(on: boolean): Promise<void> {
  try {
    if (on) await sensing.start()
    else await sensing.stop()
  } catch (err) {
    window.hearth.reportSdkError(`Sensing could not start. ${(err as Error).message}`, true)
  }
}

const remotePtt = new Set<(on: boolean) => void>()

/** Subscribe to microphone open and close requests from the global talk keys in the main process. */
export function onRemotePtt(listener: (on: boolean) => void): () => void {
  remotePtt.add(listener)
  return () => remotePtt.delete(listener)
}

export async function connectStore(): Promise<void> {
  // The renderer is only useful inside Electron; a plain browser tab on the dev URL has no bridge.
  if (!window.hearth) return
  window.hearth.onEvent(handle)
  const [initial, points] = await Promise.all([
    window.hearth.getState(),
    window.hearth.getHistory()
  ])
  // Pushes that arrived while these were on their way are newer: keep them.
  if (!statePushed) setState(initial)
  const last = points.length ? points[points.length - 1].t : -Infinity
  history = [...points, ...history.filter((p) => p.t > last)].slice(-HISTORY_LIMIT)
  emit()
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useHearth(): HearthState | null {
  return useSyncExternalStore(subscribe, () => state)
}

/**
 * Subscribes to one part of the state, so pushes that leave it alone do not re-render. The
 * selector should return a part of the state or a plain value, not build a new object: unchanged
 * parts keep their identity between pushes (see share), and a new object would differ every time.
 */
export function useHearthSelect<T>(select: (state: HearthState) => T): T | undefined {
  return useSyncExternalStore(subscribe, () => (state ? select(state) : undefined))
}

export function useHistory(): VitalsPoint[] {
  return useSyncExternalStore(subscribe, () => history)
}
