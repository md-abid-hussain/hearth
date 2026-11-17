// Formatting, labels and hooks the dashboard pages share. The shared components live in
// shared.tsx: a file of components only keeps React's fast refresh working.
import { useEffect, useMemo, useState } from 'react'
import type { LogEntry, VitalsPoint } from '@shared/types'

export const fmt = (x: number | null | undefined, digits = 0): string =>
  x == null ? '--' : x.toFixed(digits)

export const clock = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

const clockSeconds = (at: number): string =>
  new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })

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
  const [now, setNow] = useState(() => Date.now())
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
