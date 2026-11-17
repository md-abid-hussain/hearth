import { useMemo, useState } from 'react'
import { Button, SegmentedControl, TextInput } from '@mantine/core'
import type { Exchange, InsightEntry, VitalsPoint, HearthState } from '@shared/types'
import { SetupChecklist } from '../../components/SetupChecklist'
import { summarizeInsight } from '../../lib/text'
import {
  RULE_TITLES,
  SensingButton,
  SignalsChart,
  clock,
  durationLabel,
  fmt,
  minutesBetween,
  todaysLog,
  toolLabel,
  useNow,
  useTrend,
  useWindowed
} from '../shared'

interface Props {
  state: HearthState
  history: VitalsPoint[]
  go: (page: string) => void
}

function useHeadline(
  state: HearthState,
  history: VitalsPoint[],
  now: number
): { first: string; mark: string; rest: string; body: string } {
  const pulse = useTrend(history, 'pulse')
  const breathing = useTrend(history, 'breathing')
  const v = state.vitals
  const sitting = minutesBetween(v.sittingSince, now)

  if (!v.sensing && !history.length) {
    return {
      first: 'Nothing recorded yet.',
      mark: 'Start sensing',
      rest: ' to begin.',
      body: 'I read your pulse, breathing and blinking from the camera, right here on this computer, and only speak up when something is worth it.'
    }
  }

  const facts: string[] = []
  if (pulse.baseline && pulse.recent) {
    const diff = pulse.recent - pulse.baseline
    facts.push(
      Math.abs(diff) < 6
        ? 'Your pulse has stayed close to your own baseline.'
        : `Your pulse is about ${Math.round(Math.abs(diff))} bpm ${diff > 0 ? 'above' : 'below'} where you started.`
    )
  } else if (v.pulse) {
    facts.push('I am still learning your baseline for this session.')
  }
  if (breathing.recent)
    facts.push(
      breathing.recent >= 20 ? 'Breathing has been on the quick side.' : 'Breathing looks steady.'
    )
  if (sitting != null)
    facts.push(`You have been at the desk ${durationLabel(sitting)} since your last break.`)

  const pulseUp = pulse.baseline && pulse.recent && pulse.recent - pulse.baseline >= 10
  if (sitting != null && sitting >= 50)
    return {
      first: 'Steady work.',
      mark: 'One long sit',
      rest: ' to break up.',
      body: facts.join(' ')
    }
  if (pulseUp)
    return {
      first: 'A bit revved up.',
      mark: 'A slow breath',
      rest: ' might help.',
      body: facts.join(' ')
    }
  return {
    first: 'A steady session.',
    mark: 'Nothing',
    rest: ' to fix right now.',
    body: facts.join(' ')
  }
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`

function timingSummary(ex: Exchange): string {
  const t = ex.timings
  if (!t) return seconds(ex.latencyMs)
  const parts = [
    t.transcribeMs != null && `heard ${seconds(t.transcribeMs)}`,
    t.firstTextMs != null && `first words ${seconds(t.firstTextMs)}`,
    t.firstAudioMs != null && `spoke ${seconds(t.firstAudioMs)}`,
    t.reasoningTokens ? `${t.reasoningTokens} reasoning tokens` : null
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : seconds(ex.latencyMs)
}

function LastExchange({ state }: { state: HearthState }): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const ex = state.lastExchange
  const send = (): void => {
    const text = typed.trim()
    if (!text) return
    window.hearth.sendTyped(text)
    setTyped('')
  }
  return (
    <div className="card pop" style={{ overflow: 'hidden' }}>
      <div className="log-head">
        <span className="caps">Last exchange</span>
        {ex && <span className="label">{ex.via === 'voice' ? 'spoken' : 'typed'}</span>}
      </div>
      {ex ? (
        <>
          <div className="entry">
            <span className="t">{clock(ex.at)}</span>
            <div>
              <div className="who">You</div>
              <div className="body">{ex.userText}</div>
            </div>
          </div>
          {ex.tools.length > 0 && (
            <div className="entry">
              <span className="t" />
              <div>
                <div className="who dim">
                  Checked {ex.tools.length} {ex.tools.length === 1 ? 'thing' : 'things'}
                </div>
                {[...new Set(ex.tools)].map((t) => (
                  <div key={t} className="check" style={{ fontSize: 'var(--t-sm)' }}>
                    <i />
                    {toolLabel(t)}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="entry">
            <span className="t">{clock(ex.at + ex.latencyMs)}</span>
            <div>
              <div className="who amber">Hearth</div>
              <div className="body voice">{ex.reply}</div>
              <div className="timing">{timingSummary(ex)}</div>
            </div>
          </div>
        </>
      ) : (
        <div className="entry solo">
          <div className="who amber">Hearth</div>
          <div className="body voice">
            Hold {state.status.pttShortcut} from any app and ask me how you are doing. Let go and I
            will answer.
          </div>
        </div>
      )}
      <div className="log-foot">
        <TextInput
          size="sm"
          variant="filled"
          style={{ flex: 1 }}
          placeholder="Or type to Hearth and press Enter"
          value={typed}
          onChange={(e) => setTyped(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  unit,
  note,
  confidence
}: {
  label: string
  value: string
  unit: string
  note: string
  confidence?: number | null
}): React.JSX.Element {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <div className={value === '--' ? 'v waiting' : 'v'}>
        {value}
        <small>{unit}</small>
      </div>
      <div className="d">{note}</div>
      {confidence !== undefined && (
        <div className="conf">
          <b style={{ width: `${confidence ?? 0}%` }} />
        </div>
      )}
    </div>
  )
}

/**
 * The latest insight at a glance: the structured headline and metrics when the LLM has laid it
 * out, otherwise a summary read straight from Presage's markdown. Never the raw table.
 */
function InsightGlance({ insight }: { insight: InsightEntry }): React.JSX.Element {
  const view = useMemo(() => {
    const parsed = summarizeInsight(insight.text)
    const s = insight.structured
    if (!s?.headline) return parsed
    return {
      headline: s.headline,
      metrics: s.metrics.map((m) => ({ name: m.name, value: m.value, note: m.note ?? '' }))
    }
  }, [insight])
  return (
    <>
      <h3>{view.headline}</h3>
      {view.metrics.length > 0 && (
        <div className="glance-metrics">
          {view.metrics.slice(0, 3).map((m) => (
            <span className="chip" key={m.name} title={m.note || undefined}>
              {m.name} <strong>{m.value}</strong>
            </span>
          ))}
        </div>
      )}
    </>
  )
}

export function Today({ state, history, go }: Props): React.JSX.Element {
  const now = useNow()
  const [range, setRange] = useState('1h')
  const points = useWindowed(history, range)
  const headline = useHeadline(state, history, now)
  const { vitals, status } = state
  const today = useMemo(() => todaysLog(state.log), [state.log])
  const nudges = today.filter((e) => e.kind === 'nudge').length
  const heldBack = today.filter((e) => e.kind === 'suppressed').length
  const observer = today
    .filter((e) => ['suppressed', 'nudge', 'reminder'].includes(e.kind))
    .slice(-3)
    .reverse()
  const insight = [...state.insights].reverse().find((i) => !i.isError)
  const sessionMin = minutesBetween(vitals.sessionStartedAt, now)
  const sinceBreak = minutesBetween(vitals.sittingSince, now)
  const nextReminder = [...state.reminders].sort((a, b) => a.dueAt - b.dueAt)[0]

  const day = new Date().toLocaleDateString([], { weekday: 'long' })

  return (
    <div className="page-inner">
      <SetupChecklist status={status} />

      <div className="hero">
        <div>
          <div className="eyebrow">
            {day}
            {sessionMin != null ? `, session ${durationLabel(sessionMin)}` : ''}
          </div>
          <h1 className="display">
            {headline.first}
            <br />
            <span className="hl">{headline.mark}</span>
            {headline.rest}
          </h1>
          <p className="lead">{headline.body}</p>
          <div className="actions">
            <SensingButton state={state} />
            <Button variant="default" onClick={() => go('signals')}>
              See live signals
            </Button>
          </div>
          <div className="meta-dots">
            <span>frames stay on device</span>
            <span>
              {nudges} {nudges === 1 ? 'nudge' : 'nudges'} today
            </span>
            <span>{heldBack} held back</span>
          </div>
        </div>
        <LastExchange state={state} />
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Right now</h2>
          <button className="link" onClick={() => go('signals')}>
            All signals
          </button>
        </div>
        <div className="stats">
          <Stat
            label="Pulse"
            value={fmt(vitals.pulse)}
            unit="bpm"
            note={vitals.pulse ? 'estimated from the camera' : 'waiting for a stable reading'}
            confidence={vitals.pulseConfidence}
          />
          <Stat
            label="Breathing"
            value={fmt(vitals.breathing, 1)}
            unit="per min"
            note={
              vitals.breathing
                ? vitals.breathing >= 20
                  ? 'on the quick side'
                  : 'steady'
                : 'waiting for a stable reading'
            }
            confidence={vitals.breathingConfidence}
          />
          <Stat
            label="Since your last break"
            value={sinceBreak == null ? '--' : String(sinceBreak)}
            unit="min"
            note="Hearth suggests a break after 50"
          />
        </div>
        <div className="substats">
          <span>
            <b>{fmt(vitals.hrvRmssd)}</b>ms heart rate variability
          </span>
          <span>
            <b>{fmt(vitals.blinksPerMinute)}</b>blinks in the last minute
          </span>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>This session</h2>
          <SegmentedControl
            size="xs"
            value={range}
            onChange={setRange}
            data={['15m', '1h', 'all']}
          />
        </div>
        <div className="card panel">
          {points.length > 1 ? (
            <SignalsChart points={points} height={220} />
          ) : (
            <p className="empty" style={{ padding: 'var(--s-6) 0', textAlign: 'center' }}>
              The chart fills in about 15 seconds after sensing starts.
            </p>
          )}
        </div>
      </section>

      <div className="grid-2-even">
        <section className="section">
          <div className="section-head">
            <h2>Presage noticed</h2>
            <button className="link" onClick={() => go('insights')}>
              All insights
            </button>
          </div>
          {insight ? (
            <div className="card quote" style={{ flex: 1 }}>
              <div className="mark">&ldquo;</div>
              <InsightGlance insight={insight} />
              <div className="quote-foot">
                <span className="label">{clock(insight.at)}, {insight.onDemand ? 'from your numbers and question' : 'from your numbers'}</span>
                <span className="chip">{insight.onDemand ? 'asked by Hearth' : 'automatic'}</span>
              </div>
            </div>
          ) : (
            <div className="card dashed panel" style={{ flex: 1 }}>
              <p className="empty">
                Presage&rsquo;s own model writes a short read of your vitals once your pulse is
                stable, then about every minute.
              </p>
            </div>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Hearth&rsquo;s judgement</h2>
            <button className="link" onClick={() => go('timeline')}>
              Full timeline
            </button>
          </div>
          <div className="card panel" style={{ flex: 1 }}>
            {observer.length === 0 ? (
              <p className="empty">
                Hearth checks in every three minutes once a session is five minutes old. Each time it
                speaks or holds back, the reason shows here.
              </p>
            ) : (
              <div className="numbered">
                {observer.map((e, i) => {
                  const rule = String(e.data?.rule ?? '')
                  const reasons = (e.data?.reasons as string[] | undefined)?.join(', ')
                  const spoke = e.kind !== 'suppressed'
                  return (
                    <div className="row" key={e.id}>
                      <span className="idx">{String(i + 1).padStart(2, '0')}</span>
                      <div>
                        <div className="title">{RULE_TITLES[rule] ?? 'Observer check'}</div>
                        <div className={spoke ? 'sub voice' : 'sub'}>
                          {spoke ? e.message : (reasons ?? e.message)}
                        </div>
                      </div>
                      <span className={spoke ? 'chip amber' : 'chip'}>
                        {spoke ? 'spoke' : 'held back'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            {nextReminder && (
              <div
                className="field"
                style={{
                  borderTop: '1px solid var(--line)',
                  paddingTop: 'var(--s-4)',
                  marginTop: 'var(--s-4)'
                }}
              >
                <div>
                  <div className="name">{nextReminder.text}</div>
                  <div className="help">next reminder</div>
                </div>
                <span className="chip">{clock(nextReminder.dueAt)}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
