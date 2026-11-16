import { useCallback, useEffect, useRef, useState } from 'react'
import { mic } from './mic'
import { onRemotePtt } from './store'

/**
 * Hold the orb to talk. The global talk keys live in the main process, which starts
 * speech-to-text itself and only asks this window to open or close the microphone.
 */
export function usePushToTalk(): { holding: boolean; press: () => void; release: () => void; error: string | null } {
  const [holding, setHolding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const orbActive = useRef(false)

  const openMic = useCallback(() => {
    setHolding(true)
    setError(null)
    mic.start().catch((err: Error) => setError(`Microphone unavailable: ${err.message}`))
  }, [])

  const closeMic = useCallback(() => {
    setHolding(false)
    mic.stop()
  }, [])

  const press = useCallback(() => {
    if (orbActive.current) return
    orbActive.current = true
    window.wisp.pttStart()
    openMic()
  }, [openMic])

  const release = useCallback(() => {
    if (!orbActive.current) return
    orbActive.current = false
    closeMic()
    window.wisp.pttStop()
  }, [closeMic])

  useEffect(
    () =>
      onRemotePtt((on) => {
        orbActive.current = false
        if (on) openMic()
        else closeMic()
      }),
    [openMic, closeMic]
  )

  return { holding, press, release, error }
}
