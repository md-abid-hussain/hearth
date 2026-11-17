import { useEffect, useState } from 'react'
import { Button, Group, Modal, Text } from '@mantine/core'
import type { HearthState } from '@shared/types'
import { onReviewConsent } from '../lib/consent'
import { sensing } from '../lib/sensing'

const POINTS: { title: string; sub: string; chip: string }[] = [
  {
    title: 'Video stays on this device',
    sub: 'camera frames are processed locally by the SmartSpectra SDK, never stored or sent; facial expression estimates are off unless you turn them on in Privacy',
    chip: 'local'
  },
  {
    title: 'Derived numbers go to Presage',
    sub: 'when sensing starts, the SDK checks the API key with Presage; while it runs, about once a minute it sends your pulse, HRV and breathing numbers, plus any question Hearth asks, so Presage’s language model can write a wellness insight',
    chip: 'presage'
  },
  {
    title: 'SmartSpectra telemetry is off',
    sub: 'if you turn it on in Privacy, the SDK sends session summaries and device diagnostics linked to the API key, never video or vitals',
    chip: 'opt-in'
  },
  {
    title: 'Your voice goes to AssemblyAI',
    sub: 'only while you hold the talk keys or the orb, or in hands-free until you send; it also voices Hearth’s replies',
    chip: 'assemblyai'
  },
  {
    title: 'Your words go to the language model',
    sub: 'plus a short summary of your signals, and Presage’s insights to lay them out, sent to the configured LLM provider',
    chip: 'llm'
  },
  {
    title: 'Connectors are read-only',
    sub: 'Hearth only sees services you sign into, and cannot write to them',
    chip: 'opt-in'
  },
  {
    title: 'Google apps go through Composio',
    sub: 'if you sign in to Gmail, Calendar or Drive, Composio keeps that sign-in and passes along what Hearth reads; some of its web tools use your Composio credits',
    chip: 'composio'
  },
  {
    title: 'Everything else stays local',
    sub: 'memory, reminders, insights and logs live on this computer; wipe them any time from Privacy',
    chip: 'local'
  }
]

export function Consent({ state }: { state: HearthState }): React.JSX.Element {
  const { consentAt } = state.settings
  const [opened, setOpened] = useState(consentAt == null)
  const sensingOn = state.vitals.sensing

  useEffect(() => onReviewConsent(() => setOpened(true)), [])

  // The pill and the talk keys bring this window forward when consent is missing.
  useEffect(() => {
    if (consentAt != null) return undefined
    const open = (): void => setOpened(true)
    window.addEventListener('focus', open)
    return () => window.removeEventListener('focus', open)
  }, [consentAt])

  useEffect(() => {
    if (consentAt == null && sensingOn) void sensing.stop()
  }, [consentAt, sensingOn])

  const agree = (): void => {
    void window.hearth.updateSettings({ consentAt: Date.now() })
    setOpened(false)
  }
  const withdraw = (): void => {
    void window.hearth.updateSettings({ consentAt: null })
    setOpened(false)
  }

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title="Before Hearth turns on the camera or microphone"
      size="lg"
      centered
    >
      <Text size="sm" mb="md">
        Hearth is a wellness companion, not a medical device. Nothing it says is medical advice.
      </Text>
      <div className="numbered">
        {POINTS.map((p, i) => (
          <div className="row" key={p.title}>
            <span className="idx">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <div className="title">{p.title}</div>
              <div className="sub">{p.sub}</div>
            </div>
            <span className="chip">{p.chip}</span>
          </div>
        ))}
      </div>
      {consentAt != null && (
        <Text size="xs" c="dimmed" mt="md">
          You agreed on {new Date(consentAt).toLocaleString()}.
        </Text>
      )}
      <Group justify="flex-end" mt="lg">
        {consentAt != null ? (
          <>
            <Button variant="default" c="var(--red)" onClick={withdraw}>
              Withdraw consent
            </Button>
            <Button onClick={() => setOpened(false)}>Close</Button>
          </>
        ) : (
          <>
            <Button variant="default" onClick={() => setOpened(false)}>
              Not now
            </Button>
            <Button onClick={agree}>I agree</Button>
          </>
        )}
      </Group>
    </Modal>
  )
}
