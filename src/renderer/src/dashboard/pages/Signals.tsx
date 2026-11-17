import { useState } from 'react'
import { Alert, SegmentedControl, Switch } from '@mantine/core'
import { LineChart } from '@mantine/charts'
import type { HearthState, Settings, VitalsPoint } from '@shared/types'
import { TIME_AXIS, clock, fmt, useWindowed } from '../helpers'
import { CameraPicker, CameraPreview, PageHeader, SensingButton, SignalsChart } from '../shared'

export function Signals({
  state,
  history
}: {
  state: HearthState
  history: VitalsPoint[]
}): React.JSX.Element {
  const [range, setRange] = useState('1h')
  const points = useWindowed(history, range)
  const v = state.vitals
  const { measureBlinks, measureExpressions } = state.settings
  const update = (patch: Partial<Settings>): void => void window.hearth.updateSettings(patch)
  const hrv = points.filter((p) => p.hrv != null).map((p) => ({ t: p.t, HRV: p.hrv }))

  return (
    <div className="page-inner">
      <PageHeader
        eyebrow="Signals"
        title="What the camera is reading."
        intro="Estimates from the Presage SmartSpectra SDK, computed on this computer. Confidence bars show how sure the SDK is about each reading."
      />

      <div className="grid-2">
        <div className="card panel">
          <div className="panel-head">
            <h3>Camera</h3>
            <span className="status-row">
              <span className={v.sensing ? (v.present ? 'sq' : 'sq warn') : 'sq off'} />
              {v.sensing ? (v.present ? 'sensing' : 'looking for you') : 'off'}
            </span>
          </div>
          {v.sensing ? (
            <CameraPreview />
          ) : (
            <p className="empty">
              The camera only runs while sensing is on. Frames are never saved.
            </p>
          )}
          {v.sensing && v.validationHint && (
            <Alert color="yellow" variant="light" mt="sm" p="xs">
              {v.validationHint}
            </Alert>
          )}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <SensingButton state={state} size="sm" />
            <div style={{ flex: 1 }}>
              <CameraPicker state={state} />
            </div>
          </div>
          <div className="face-signals">
            <span className="label">Face signals</span>
            <Switch
              size="xs"
              label="Blinks and talking"
              description="Blink rate, and pausing breathing readings while you speak"
              checked={measureBlinks}
              onChange={(e) => update({ measureBlinks: e.currentTarget.checked })}
            />
            <Switch
              size="xs"
              label="Facial expressions"
              description="Estimates stay on this computer and never go to the language model"
              checked={measureExpressions}
              onChange={(e) => update({ measureExpressions: e.currentTarget.checked })}
            />
            {v.sensing && (
              <span className="faint" style={{ fontSize: 12 }}>
                Changes apply the next time sensing starts.
              </span>
            )}
          </div>
        </div>

        <div className="card panel">
          <div className="panel-head">
            <h3>Right now</h3>
            <span className="label">updated {v.updatedAt ? clock(v.updatedAt) : '--'}</span>
          </div>
          <div className="numbered">
            <div className="row">
              <span className="idx">01</span>
              <div>
                <div className="title">Pulse</div>
                <div className="sub">confidence {fmt(v.pulseConfidence)}%</div>
              </div>
              <span className="chip">{fmt(v.pulse)} bpm</span>
            </div>
            <div className="row">
              <span className="idx">02</span>
              <div>
                <div className="title">Breathing</div>
                <div className="sub">confidence {fmt(v.breathingConfidence)}%</div>
              </div>
              <span className="chip">{fmt(v.breathing, 1)} /min</span>
            </div>
            <div className="row">
              <span className="idx">03</span>
              <div>
                <div className="title">Heart rate variability</div>
                <div className="sub">RMSSD, needs a minute of steady signal</div>
              </div>
              <span className="chip">{fmt(v.hrvRmssd)} ms</span>
            </div>
            <div className="row">
              <span className="idx">04</span>
              <div>
                <div className="title">Blinks</div>
                <div className="sub">
                  {measureBlinks ? 'last 60 seconds' : 'turned off in face signals'}
                </div>
              </div>
              <span className="chip">
                {measureBlinks ? `${fmt(v.blinksPerMinute)} /min` : 'off'}
              </span>
            </div>
            <div className="row">
              <span className="idx">05</span>
              <div>
                <div className="title">Talking</div>
                <div className="sub">Hearth stays quiet while you talk</div>
              </div>
              <span className={v.talking ? 'chip amber' : 'chip'}>
                {measureBlinks ? (v.talking ? 'yes' : 'no') : 'off'}
              </span>
            </div>
            {measureExpressions && (
              <div className="row">
                <span className="idx">06</span>
                <div>
                  <div className="title">Expression</div>
                  <div className="sub">an estimate from the SDK, not a feeling</div>
                </div>
                <span className="chip">
                  {v.expression
                    ? `${v.expression.label} ${Math.round(v.expression.confidence * (v.expression.confidence <= 1 ? 100 : 1))}%`
                    : '--'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card panel">
        <div className="panel-head">
          <h3>Pulse and breathing</h3>
          <SegmentedControl
            size="xs"
            value={range}
            onChange={setRange}
            data={['15m', '1h', 'all']}
          />
        </div>
        {points.length > 1 ? (
          <SignalsChart points={points} height={260} />
        ) : (
          <p className="empty">Start sensing to see your signals here.</p>
        )}
      </div>

      {hrv.length > 1 && (
        <div className="card panel">
          <div className="panel-head">
            <h3>Heart rate variability (RMSSD, ms)</h3>
          </div>
          <LineChart
            h={160}
            data={hrv}
            {...TIME_AXIS}
            yAxisProps={{ domain: ['auto', 'auto'], width: 44 }}
            withDots={false}
            curveType="monotone"
            gridAxis="y"
            series={[{ name: 'HRV', color: 'var(--amber)' }]}
          />
        </div>
      )}

      <p className="label" style={{ margin: 0 }}>
        Wellness estimates only. Not a medical device and not for diagnosis.
      </p>
    </div>
  )
}
