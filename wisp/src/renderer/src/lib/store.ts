import { useSyncExternalStore } from 'react'
import type { MainToRenderer, VitalsPoint, HearthState } from '@shared/types'
import { player } from './player'
import { sensing } from './sensing'

const HISTORY_LIMIT = 1_800

let state: HearthState | null = null
let history: VitalsPoint[] = []
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

function handle(msg: MainToRenderer): void {
  switch (msg.type) {
    case 'state':
      state = msg.state
      emit()
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
  }
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
  state = initial
  history = points
  emit()
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useHearth(): HearthState | null {
  return useSyncExternalStore(subscribe, () => state)
}

export function useHistory(): VitalsPoint[] {
  return useSyncExternalStore(subscribe, () => history)
}
