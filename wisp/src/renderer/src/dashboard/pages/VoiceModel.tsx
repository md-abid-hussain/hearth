import { SegmentedControl } from '@mantine/core'
import type { HotkeyId, ReasoningEffort, Settings, ThemeChoice, HearthState } from '@shared/types'
import { PageHeader } from '../shared'

export function VoiceModel({ state }: { state: HearthState }): React.JSX.Element {
  const { status, settings } = state
  const update = (patch: Partial<Settings>): void => void window.hearth.updateSettings(patch)
  const effort = settings.reasoningEffort ?? status.envReasoningEffort ?? 'medium'

  return (
    <div className="page-inner">
      <PageHeader
        eyebrow="Voice and model"
        title="How Hearth thinks and sounds."
        intro="Settings that are not secrets live here. API keys stay in the .env file and never reach this window."
      />
      <div className="grid-2-even">
        <div className="card panel">
          <div className="panel-head"><h3>Model</h3><span className="chip">from .env</span></div>
          <div className="field">
            <div><div className="name">Provider</div><div className="help">set LLM_PROVIDER in .env to swap</div></div>
            <span className="chip">{status.llmProvider}</span>
          </div>
          <div className="field">
            <div><div className="name">Model</div><div className="help">conversation and tool use</div></div>
            <span className="chip">{status.llmModel}</span>
          </div>
          <div className="field stack">
            <div>
              <div className="name">Reasoning effort</div>
              <div className="help">
                lower is faster to speak. .env says {status.envReasoningEffort ?? 'nothing'}; background jobs always use low.
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
        </div>

        <div className="card panel">
          <div className="panel-head"><h3>Voice and look</h3></div>
          <div className="field">
            <div><div className="name">Voice</div><div className="help">AssemblyAI text to speech, set HEARTH_TTS_VOICE</div></div>
            <span className="chip">{status.ttsVoice}</span>
          </div>
          <div className="field stack">
            <div><div className="name">Hold to talk</div><div className="help">Hold the keys from any app, speak, and let go to send. Holding the orb works too.</div></div>
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
            <div><div className="name">Hands-free</div><div className="help">Press once to keep listening, press {status.pttShortcut} to send or Esc to cancel</div></div>
            <span className="chip">{status.handsFreeShortcut}</span>
          </div>
          <div className="field">
            <div><div className="name">Theme</div><div className="help">applies to the pill and dashboard</div></div>
            <SegmentedControl
              size="xs"
              value={settings.theme}
              onChange={(value) => update({ theme: value as ThemeChoice })}
              data={['dark', 'light', 'auto']}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
