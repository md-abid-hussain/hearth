import { useEffect, useRef, useState } from 'react'
import { Button, Select } from '@mantine/core'
import { LineChart } from '@mantine/charts'
import { notifications } from '@mantine/notifications'
import type { VitalsPoint, HearthState } from '@shared/types'
import { chooseCamera, chosenCamera, listCameras, sensing, type CameraOption } from '../lib/sensing'
import { TIME_AXIS } from './helpers'

export function SensingButton({
  state,
  size = 'md'
}: {
  state: HearthState
  size?: 'sm' | 'md'
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const on = state.vitals.sensing
  const toggle = async (): Promise<void> => {
    setBusy(true)
    try {
      if (on) await sensing.stop()
      else await sensing.start()
    } catch (err) {
      notifications.show({
        color: 'red',
        title: 'Sensing could not start',
        message: (err as Error).message
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button
      size={size}
      variant={on ? 'default' : 'filled'}
      loading={busy}
      disabled={!state.status.smartspectraReady}
      onClick={toggle}
    >
      {on ? 'Stop sensing' : 'Start sensing'}
    </Button>
  )
}

const DEFAULT_CAMERA = 'default'

/** Lists the cameras the system exposes; switching while sensing restarts on the new one. */
export function CameraPicker({ state }: { state: HearthState }): React.JSX.Element {
  const [cameras, setCameras] = useState<CameraOption[]>([])
  const [chosen, setChosen] = useState(chosenCamera() ?? DEFAULT_CAMERA)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const refresh = (): void =>
      void listCameras()
        .then(setCameras)
        .catch(() => setCameras([]))
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [state.vitals.sensing])

  const change = async (value: string | null): Promise<void> => {
    const next = value ?? DEFAULT_CAMERA
    setChosen(next)
    chooseCamera(next === DEFAULT_CAMERA ? null : next)
    if (!state.vitals.sensing) return
    setBusy(true)
    try {
      await sensing.stop()
      await sensing.start()
    } catch (err) {
      notifications.show({
        color: 'red',
        title: 'Sensing could not start',
        message: (err as Error).message
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Select
      size="sm"
      label="Camera"
      disabled={busy}
      value={chosen}
      onChange={(value) => void change(value)}
      data={[
        { value: DEFAULT_CAMERA, label: 'System default' },
        ...cameras.map((c) => ({ value: c.id, label: c.label }))
      ]}
      allowDeselect={false}
    />
  )
}

export function CameraPreview(): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(
    () =>
      sensing.onStream((stream) => {
        if (ref.current) ref.current.srcObject = stream
      }),
    []
  )
  return <video ref={ref} className="video" autoPlay muted playsInline />
}

export function SignalsChart({
  points,
  height = 200
}: {
  points: VitalsPoint[]
  height?: number
}): React.JSX.Element {
  const data = points.map((p) => ({ t: p.t, Pulse: p.pulse, Breathing: p.breathing }))
  return (
    <>
      <LineChart
        h={height}
        data={data}
        {...TIME_AXIS}
        withDots={false}
        curveType="monotone"
        connectNulls
        gridAxis="y"
        strokeDasharray="0"
        withRightYAxis
        yAxisLabel="Pulse (bpm)"
        rightYAxisLabel="Breathing (/min)"
        yAxisProps={{ domain: ['auto', 'auto'], width: 44 }}
        rightYAxisProps={{ domain: [0, 'auto'], width: 44 }}
        series={[
          { name: 'Pulse', color: 'var(--red)' },
          { name: 'Breathing', color: 'var(--accent)', yAxisId: 'right' }
        ]}
      />
      <div className="legend">
        <span>
          <i style={{ background: 'var(--red)' }} />
          pulse, bpm
        </span>
        <span>
          <i style={{ background: 'var(--accent)' }} />
          breathing, per min
        </span>
      </div>
    </>
  )
}

export function PageHeader({
  eyebrow,
  title,
  intro
}: {
  eyebrow: string
  title: string
  intro?: string
}): React.JSX.Element {
  return (
    <div>
      <div className="eyebrow">{eyebrow}</div>
      <h1 className="page-title">{title}</h1>
      {intro && (
        <p className="lead" style={{ maxWidth: 640 }}>
          {intro}
        </p>
      )}
    </div>
  )
}
