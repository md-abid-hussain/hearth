import { Button, SegmentedControl } from '@mantine/core'
import type { HotkeyId, ReasoningEffort, Settings, ThemeChoice, HearthState } from '@shared/types'
import { PageHeader } from '../shared'

/** Everyday settings up front; the model and voice details sit under Advanced. */
export function VoiceModel({ state }: { state: HearthState }): React.JSX.Element {
  const { status, settings } = state
  const update = (patch: Partial<Settings>): void => void window.hearth.updateSettings(patch)
  const effort = settings.reasoningEffort ?? status.envReasoningEffort ?? 'medium'

  return (
    <div className="page-inner">
      <PageHeader
        eyebrow="Settings"
        title="Make Hearth yours."
        intro="How you talk to Hearth, where it sits and how it looks."
      />
      <div className="grid-2-even">
        <div className="card panel">
          <div className="panel-head">
            <h3>Talking</h3>
          </div>
          <div className="field stack">
            <div>
              <div className="name">Talk keys</div>
              <div className="help">
                Hold them from any app, speak, and let go to send. Or click Hearth&apos;s face:
                click to talk, click again to send.
              </div>
            </div>
            <SegmentedControl
              size="xs"
              value={settings.hotkey}
              onChange={(value) => update({ hotkey: value as HotkeyId })}
              data={[
                { value: 'right-ctrl', label: 'Right Ctrl' },
                { value: 'right-alt', label: 'Right Alt' },
                { value: 'ctrl-win', label: 'Ctrl + Win' }
              ]}
            />
          </div>
          <div className="field">
            <div>
              <div className="name">Hands-free</div>
              <div className="help">
                Press once to keep listening, press {status.pttShortcut} to send or Esc to cancel
              </div>
            </div>
            <span className="chip">{status.handsFreeShortcut}</span>
          </div>
        </div>

        <div className="card panel">
          <div className="panel-head">
            <h3>Look and place</h3>
          </div>
          <div className="field">
            <div>
              <div className="name">Widget position</div>
              <div className="help">Drag Hearth to move it. Lost it off screen? Bring it back.</div>
            </div>
            <Button
              size="xs"
              variant="default"
              style={{ flex: 'none' }}
              onClick={() => window.hearth.resetPill()}
            >
              Bring back
            </Button>
          </div>
          <div className="field">
            <div>
              <div className="name">Theme</div>
              <div className="help">applies to the widget and dashboard</div>
            </div>
            <SegmentedControl
              size="xs"
              value={settings.theme}
              onChange={(value) => update({ theme: value as ThemeChoice })}
              data={['dark', 'light', 'auto']}
            />
          </div>
        </div>
      </div>

      <details className="advanced">
        <summary className="label">Advanced: model and voice</summary>
        <div className="card panel" style={{ marginTop: 12 }}>
          <div className="field">
            <div>
              <div className="name">Provider</div>
              <div className="help">set LLM_PROVIDER in .env to swap</div>
            </div>
            <span className="chip">{status.llmProvider}</span>
          </div>
          <div className="field">
            <div>
              <div className="name">Model</div>
              <div className="help">conversation and tool use, from .env</div>
            </div>
            <span className="chip">{status.llmModel}</span>
          </div>
          <div className="field stack">
            <div>
              <div className="name">Reasoning effort</div>
              <div className="help">
                lower is faster to speak. .env says {status.envReasoningEffort ?? 'nothing'};
                background jobs always use low.
              </div>
            </div>
            <SegmentedControl
              size="xs"
              value={effort}
              disabled={status.llmProvider !== 'openai'}
              onChange={(value) => update({ reasoningEffort: value as ReasoningEffort })}
              data={['none', 'low', 'medium', 'high']}
            />
          </div>
          <div className="field">
            <div>
              <div className="name">Voice</div>
              <div className="help">AssemblyAI text to speech, set HEARTH_TTS_VOICE in .env</div>
            </div>
            <span className="chip">{status.ttsVoice}</span>
          </div>
        </div>
      </details>
    </div>
  )
}
