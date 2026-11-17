import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Select } from '@mantine/core'
import { LineChart } from '@mantine/charts'
import { notifications } from '@mantine/notifications'
import type { LogEntry, VitalsPoint, HearthState } from '@shared/types'
import { chooseCamera, chosenCamera, listCameras, sensing, type CameraOption } from '../lib/sensing'

export const fmt = (x: number | null | undefined, digits = 0): string =>
  x == null ? '--' : x.toFixed(digits)

export const clock = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

const clockSeconds = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

/** A real time axis: ticks spaced by time, never the same minute twice, tooltips to the second. */
export const TIME_AXIS = {
  dataKey: 't',
  xAxisProps: {
    type: 'number' as const,
    scale: 'time' as const,
    domain: ['dataMin', 'dataMax'],
    tickFormatter: clock,
    minTickGap: 56
  },
  tooltipProps: { labelFormatter: (t: unknown) => clockSeconds(Number(t)) },
  valueFormatter: (v: number) => (Number.isFinite(v) ? Math.round(v).toString() : '')
}

export function minutesBetween(from: number | null, to = Date.now()): number | null {
  return from == null ? null : Math.max(0, Math.floor((to - from) / 60_000))
}

export function durationLabel(minutes: number | null): string {
  if (minutes == null) return '--'
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

const startOfToday = (): number => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function todaysLog(log: LogEntry[]): LogEntry[] {
  const since = startOfToday()
  return log.filter((e) => e.at >= since)
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Session baseline and recent average, computed from the streamed history. */
export function useTrend(
  history: VitalsPoint[],
  key: 'pulse' | 'breathing'
): { baseline: number | null; recent: number | null } {
  return useMemo(() => {
    if (!history.length) return { baseline: null, recent: null }
    const start = history[0].t
    const now = history[history.length - 1].t
    const pick = (from: number, to: number): number[] =>
      history
        .filter((p) => p.t >= from && p.t <= to)
        .map((p) => p[key])
        .filter((x): x is number => x != null)
    const early = pick(start, start + 10 * 60_000)
    const recent = pick(now - 5 * 60_000, now)
    return {
      baseline: early.length >= 30 ? median(early) : null,
      recent: recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null
    }
  }, [history, key])
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export const TOOL_LABELS: Record<string, string> = {
  get_vitals: 'Read your live signals',
  ask_presage_insight: 'Asked Presage about your vitals',
  recent_insights: 'Read recent Presage insights',
  set_reminder: 'Set a reminder',
  cancel_reminder: 'Cancelled a reminder',
  remember: 'Pinned something to memory',
  quiet_mode: 'Changed quiet mode'
}

export const toolLabel = (name: string): string =>
  TOOL_LABELS[name] ?? `Read from ${name.split('__')[0]} (${name.split('__')[1] ?? name})`

export const RULE_TITLES: Record<string, string> = {
  sit_break: 'Wanted to suggest a break',
  pulse_up: 'Pulse above your baseline',
  fast_breathing: 'Breathing on the quick side',
  reminder: 'A reminder came due'
}

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
      else await sensing.start(state.settings.telemetry)
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

/** Lists cameras as Windows exposes them; switching while sensing restarts on the new one. */
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
      await sensing.start(state.settings.telemetry)
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
        { value: DEFAULT_CAMERA, label: 'Windows default' },
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

const WINDOWS: Record<string, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  all: Number.POSITIVE_INFINITY
}

export function useWindowed(history: VitalsPoint[], range: string): VitalsPoint[] {
  return useMemo(() => {
    const span = WINDOWS[range] ?? WINDOWS['1h']
    const end = history.length ? history[history.length - 1].t : 0
    const points = history.filter((p) => end - p.t <= span)
    const step = Math.max(1, Math.ceil(points.length / 400))
    return points.filter((_, i) => i % step === 0)
  }, [history, range])
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
