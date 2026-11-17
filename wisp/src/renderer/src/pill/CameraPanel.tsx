import { useEffect, useRef, useState } from 'react'
import { ActionIcon, Button } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import type { HearthState } from '@shared/types'
import { openCamera, stopTracks } from '../lib/sensing'

/** How long the panel shows "sensing is on" before tucking itself away. */
const DONE_CLOSE_MS = 2_200
const LIGHT_CHECK_MS = 700
/** Mean brightness (0-255) of the center of the frame, where the face should be. */
const TOO_DARK = 60
const TOO_BRIGHT = 215

type Light = 'ok' | 'dark' | 'bright' | null

interface Status {
  text: string
  tone: 'plain' | 'ok' | 'warn' | 'problem'
}

/**
 * A look through the camera before sensing starts: the user sees how they are framed, gets a
 * light check, and starts sensing from here. The preview is the widget's own stream, closed
 * when the panel closes; the SmartSpectra session runs in the dashboard window.
 */
export function CameraPanel({
  state,
  onClose
}: {
  state: HearthState
  onClose: () => void
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [light, setLight] = useState<Light>(null)
  const [startClicked, setStartClicked] = useState(false)
  const consented = state.settings.consentAt != null
  const sensing = state.vitals.sensing
  const starting = startClicked && !sensing && !state.notice
  const justStarted = startClicked && sensing

  useEffect(() => {
    if (!consented) return undefined
    let stream: MediaStream | null = null
    let closed = false
    openCamera()
      .then((s) => {
        if (closed) return stopTracks(s)
        stream = s
        const el = video.current
        if (el) {
          el.srcObject = s
          void el.play().catch(() => undefined)
        }
      })
      .catch((err: Error) => setPreviewError(err.message))
    return () => {
      closed = true
      stopTracks(stream)
    }
  }, [consented])

  // A cheap light check on the middle of the frame, so a dark face is caught before starting.
  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 24
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const timer = setInterval(() => {
      const el = video.current
      if (!ctx || !el || el.readyState < 2) return
      ctx.drawImage(
        el,
        el.videoWidth * 0.25,
        el.videoHeight * 0.15,
        el.videoWidth * 0.5,
        el.videoHeight * 0.7,
        0,
        0,
        32,
        24
      )
      const data = ctx.getImageData(0, 0, 32, 24).data
      let sum = 0
      for (let i = 0; i < data.length; i += 4)
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      const mean = sum / (data.length / 4)
      setLight(mean < TOO_DARK ? 'dark' : mean > TOO_BRIGHT ? 'bright' : 'ok')
    }, LIGHT_CHECK_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!justStarted) return undefined
    const timer = setTimeout(onClose, DONE_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [justStarted, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const status = ((): Status => {
    if (!consented)
      return { text: 'Accept the consent screen before the camera turns on.', tone: 'warn' }
    if (previewError) return { text: previewError, tone: 'problem' }
    if (startClicked && state.notice) return { text: state.notice, tone: 'problem' }
    if (justStarted) return { text: 'Sensing is on. Hearth will tuck the camera away.', tone: 'ok' }
    if (starting) return { text: 'Starting SmartSpectra…', tone: 'plain' }
    if (sensing && state.vitals.validationHint)
      return { text: state.vitals.validationHint, tone: 'warn' }
    if (light === 'dark')
      return { text: 'Your face looks dark. Turn toward a window or a lamp.', tone: 'warn' }
    if (light === 'bright')
      return {
        text: 'Too much light. Avoid a bright window right behind or beside you.',
        tone: 'warn'
      }
    if (sensing) return { text: 'Sensing is on. Keep your face inside the oval.', tone: 'ok' }
    return { text: 'Center your face in the oval, in even light, then start.', tone: 'plain' }
  })()

  const viewTone =
    status.tone === 'warn' || status.tone === 'problem' ? 'warn' : light === 'ok' ? 'ok' : ''

  return (
    <div className="camera-panel" data-hit>
      <div className={`camera-view ${viewTone}`}>
        <video ref={video} muted playsInline aria-label="Camera preview" />
        <svg className="guide" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden>
          <ellipse cx="200" cy="140" rx="82" ry="104" />
        </svg>
        <span className={sensing ? 'live on' : 'live'}>
          <i />
          {sensing ? 'sensing' : 'preview only'}
        </span>
      </div>
      <div className={`camera-status ${status.tone}`} role="status">
        {status.text}
      </div>
      <div className="camera-actions">
        {!consented ? (
          <Button size="xs" onClick={() => window.hearth.openDashboard()}>
            Review consent
          </Button>
        ) : sensing ? (
          <Button
            size="xs"
            variant="default"
            onClick={() => {
              setStartClicked(false)
              window.hearth.requestSensing(false)
            }}
          >
            Stop sensing
          </Button>
        ) : (
          <Button
            size="xs"
            color="green"
            loading={starting}
            disabled={Boolean(previewError)}
            onClick={() => {
              setStartClicked(true)
              window.hearth.requestSensing(true)
            }}
          >
            Start sensing
          </Button>
        )}
        <span style={{ flex: 1 }} />
        <ActionIcon
          variant="subtle"
          color="gray"
          radius="xl"
          aria-label="Close camera"
          onClick={onClose}
        >
          <IconX size={16} />
        </ActionIcon>
      </div>
    </div>
  )
}
