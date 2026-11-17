import { useCallback, useEffect, useRef, useState } from 'react'
import { mic } from './mic'
import { onRemotePtt } from './store'

/**
 * Click Hearth's face to talk and click again to send. The global talk keys live in the main
 * process, which starts speech-to-text itself and only asks this window to open or close the
 * microphone; a click while they are listening sends that turn too.
 */
export function usePushToTalk(): {
  holding: boolean
  press: () => void
  release: () => void
  toggle: () => void
  error: string | null
} {
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
    window.hearth.pttStart()
    openMic()
  }, [openMic])

  const release = useCallback(() => {
    if (!orbActive.current) return
    orbActive.current = false
    closeMic()
    window.hearth.pttStop()
  }, [closeMic])

  const toggle = useCallback(() => {
    if (orbActive.current) {
      release()
    } else if (holding) {
      // Listening was started by the talk keys; a click sends it.
      closeMic()
      window.hearth.pttStop()
    } else {
      orbActive.current = true
      window.hearth.pttStart('handsFree')
      openMic()
    }
  }, [holding, release, closeMic, openMic])

  useEffect(
    () =>
      onRemotePtt((on) => {
        orbActive.current = false
        if (on) openMic()
        else closeMic()
      }),
    [openMic, closeMic]
  )

  return { holding, press, release, toggle, error }
}
