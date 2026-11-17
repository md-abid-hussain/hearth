import { Anchor, Button, Code, Switch, Text } from '@mantine/core'
import { modals } from '@mantine/modals'
import type { Settings, HearthState } from '@shared/types'
import { reviewConsent } from '../../lib/consent'
import { PageHeader } from '../shared'

export function Privacy({ state }: { state: HearthState }): React.JSX.Element {
  const { settings, status } = state
  const update = (patch: Partial<Settings>): void => void window.hearth.updateSettings(patch)

  const confirmWipe = (): void => {
    modals.openConfirmModal({
      title: 'Delete all Hearth data?',
      children: (
        <Text size="sm">
          Conversation, memory, reminders, insights and the event log will be removed from this
          computer. You will be signed out of every connector, and Composio will delete your Google
          connections.
        </Text>
      ),
      labels: { confirm: 'Delete everything', cancel: 'Keep' },
      confirmProps: { color: 'red' },
      onConfirm: () => void window.hearth.wipeData()
    })
  }

  return (
    <div className="page-inner">
      <PageHeader
        eyebrow="Privacy"
        title="Your data, plainly."
        intro="Hearth is opt-in at every step. The camera runs only while sensing is on, and the microphone only while you talk."
      />
      <div className="grid-2-even">
        <div className="card panel">
          <div className="panel-head">
            <h3>Controls</h3>
            <span className="label">stored on this computer</span>
          </div>
          <div className="field">
            <div>
              <div className="name">Quiet mode</div>
              <div className="help">Hearth never speaks first, not even reminders</div>
            </div>
            <Switch
              checked={settings.quietMode}
              onChange={(e) => update({ quietMode: e.currentTarget.checked })}
            />
          </div>
          <div className="field">
            <div>
              <div className="name">Wellness nudges</div>
              <div className="help">break and breathing suggestions</div>
            </div>
            <Switch
              checked={settings.nudgesEnabled}
              onChange={(e) => update({ nudgesEnabled: e.currentTarget.checked })}
            />
          </div>
          <div className="field">
            <div>
              <div className="name">Measure blinks and talking</div>
              <div className="help">
                blink rate, and pausing breathing readings while you speak; applies next start
              </div>
            </div>
            <Switch
              checked={settings.measureBlinks}
              onChange={(e) => update({ measureBlinks: e.currentTarget.checked })}
            />
          </div>
          <div className="field">
            <div>
              <div className="name">Measure facial expressions</div>
              <div className="help">
                off by default; estimates stay on this computer and never go to the language model;
                applies next start
              </div>
            </div>
            <Switch
              checked={settings.measureExpressions}
              onChange={(e) => update({ measureExpressions: e.currentTarget.checked })}
            />
          </div>
          <div className="field">
            <div>
              <div className="name">Share SDK telemetry</div>
              <div className="help">
                off by default; session summaries and device diagnostics (device model, OS) tied to
                the API key, never frames or vitals; applies next start
              </div>
            </div>
            <Switch
              checked={settings.telemetry}
              onChange={(e) => update({ telemetry: e.currentTarget.checked })}
            />
          </div>
          <div className="field">
            <div>
              <div className="name">Consent</div>
              <div className="help">
                {settings.consentAt != null
                  ? `agreed ${new Date(settings.consentAt).toLocaleDateString()}`
                  : 'not given, camera and mic stay off'}
              </div>
            </div>
            <Anchor size="sm" component="button" onClick={reviewConsent}>
              Review consent
            </Anchor>
          </div>
          <div className="field">
            <div>
              <div className="name">Delete all local data</div>
              <div className="help">
                memory, reminders, insights, logs, consent and connector sign-ins, including
                Composio&apos;s
              </div>
            </div>
            <Button size="xs" variant="default" c="var(--red)" onClick={confirmWipe}>
              Delete
            </Button>
          </div>
        </div>

        <div className="card pop panel">
          <div className="panel-head">
            <h3>Where your data goes</h3>
          </div>
          <div className="numbered">
            <div className="row">
              <span className="idx">01</span>
              <div>
                <div className="title">Camera frames</div>
                <div className="sub">
                  processed on this device by the SmartSpectra SDK, never stored or sent
                </div>
              </div>
              <span className="chip">local</span>
            </div>
            <div className="row">
              <span className="idx">02</span>
              <div>
                <div className="title">Derived numbers</div>
                <div className="sub">
                  pulse, breathing and HRV go to Presage only to write insights
                </div>
              </div>
              <span className="chip">presage</span>
            </div>
            <div className="row">
              <span className="idx">03</span>
              <div>
                <div className="title">Your voice</div>
                <div className="sub">streamed to AssemblyAI only while you hold to talk</div>
              </div>
              <span className="chip">assemblyai</span>
            </div>
            <div className="row">
              <span className="idx">04</span>
              <div>
                <div className="title">Your words</div>
                <div className="sub">plus a short signal summary, sent to {status.llmModel}</div>
              </div>
              <span className="chip">{status.llmProvider}</span>
            </div>
            <div className="row">
              <span className="idx">05</span>
              <div>
                <div className="title">Memory and logs</div>
                <div className="sub">
                  <Code>{status.dataDir}</Code>
                </div>
              </div>
              <span className="chip">local</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
