import { Anchor, Button } from '@mantine/core'
import type { AppStatus } from '@shared/types'

interface Item {
  ready: boolean
  name: string
  envVar: string
  why: string
  link: string
}

/**
 * Shown on Today only while a required key is missing: what each one is for, where to get it,
 * and a button that opens the folder holding .env. It disappears once every key is in.
 */
export function SetupChecklist({ status }: { status: AppStatus }): React.JSX.Element | null {
  const openai = status.llmProvider === 'openai'
  const items: Item[] = [
    {
      ready: status.smartspectraReady,
      name: 'Presage SmartSpectra',
      envVar: 'SMARTSPECTRA_API_KEY',
      why: 'camera signals and Presage insights',
      link: 'https://physiology.presagetech.com/auth/register'
    },
    {
      ready: status.assemblyReady,
      name: 'AssemblyAI',
      envVar: 'ASSEMBLYAI_API_KEY',
      why: 'hearing you and Hearth’s voice',
      link: 'https://www.assemblyai.com/dashboard/signup'
    },
    {
      ready: status.llmReady,
      name: openai ? 'OpenAI' : 'Anthropic',
      envVar: openai ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY',
      why: 'what Hearth says back',
      link: openai
        ? 'https://platform.openai.com/api-keys'
        : 'https://console.anthropic.com/settings/keys'
    }
  ]
  const missing = items.filter((i) => !i.ready).length
  if (missing === 0) return null

  return (
    <div className="card panel setup-checklist">
      <div className="panel-head">
        <h3>Finish setting up Hearth</h3>
        <span className="label">
          {items.length - missing} of {items.length} ready
        </span>
      </div>
      <div className="numbered">
        {items.map((item, idx) => (
          <div className="row" key={item.envVar}>
            <span className="idx">{String(idx + 1).padStart(2, '0')}</span>
            <div>
              <div className="title">{item.name}</div>
              <div className="sub">
                {item.why} · <code>{item.envVar}</code>
                {!item.ready && (
                  <>
                    {' · '}
                    <Anchor href={item.link} target="_blank" size="sm">
                      get a key
                    </Anchor>
                  </>
                )}
              </div>
            </div>
            <span className={item.ready ? 'tag ok' : 'tag no'}>
              {item.ready ? 'ready' : 'missing'}
            </span>
          </div>
        ))}
      </div>
      <div className="setup-foot">
        <span className="label">
          Put the keys in <code>{status.envPath}</code>, then restart Hearth.
        </span>
        <Button size="xs" variant="default" onClick={() => window.hearth.openEnvFolder()}>
          Open .env folder
        </Button>
      </div>
    </div>
  )
}
