import { useEffect, useRef, useState } from 'react'
import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import { IconCamera, IconCameraOff, IconDots, IconLayoutDashboard } from '@tabler/icons-react'
import type { HearthState } from '@shared/types'
import { Orb } from '../components/Orb'
import { mic } from '../lib/mic'
import { player } from '../lib/player'
import { useHearth } from '../lib/store'
import { usePushToTalk } from '../lib/usePushToTalk'

const CAPTION_LINGER_MS = 7_000
/** How long the pill says "starting camera" before giving up on hearing back. */
const SENSING_START_MS = 30_000

function headline(state: HearthState, starting: boolean): { text: string; sub: string } {
  const shortcut = state.status.pttShortcut
  if (starting && state.mood === 'idle') return { text: 'Hearth', sub: 'starting the camera…' }
  switch (state.mood) {
    case 'listening':
      return state.listenMode === 'handsFree'
        ? { text: 'listening, hands-free', sub: `press ${shortcut} to send, Esc to cancel` }
        : { text: 'listening', sub: 'release to send' }
    case 'thinking':
      return {
        text: state.activity ?? 'thinking',
        sub: state.partialTranscript ? `"${state.partialTranscript}"` : ''
      }
    case 'speaking':
      return { text: 'Hearth', sub: 'speaking' }
    case 'sleeping':
      return { text: 'Hearth', sub: 'asleep' }
    default:
      if (state.settings.quietMode) return { text: 'Hearth', sub: 'quiet mode, ask any time' }
      return { text: 'Hearth', sub: `hold ${shortcut} to talk` }
  }
}

/** Voice-level bars; heights are driven straight from the audio level each frame. */
function Bars({ source, color }: { source: 'mic' | 'player'; color: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    const tick = (time: number): void => {
      const level = source === 'mic' ? mic.level : player.level()
      const bars = ref.current?.children
      if (bars) {
        for (let i = 0; i < bars.length; i++) {
          const wave = 0.5 + 0.5 * Math.sin(time / 120 + i * 1.7)
          ;(bars[i] as HTMLElement).style.height = `${4 + Math.min(1, level * 2.2) * wave * 14}px`
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [source])
  return (
    <div className="bars" ref={ref} style={{ color }}>
      {Array.from({ length: 7 }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  )
}

export function Pill(): React.JSX.Element | null {
  const state = useHearth()
  const ptt = usePushToTalk()
  const [caption, setCaption] = useState<string | null>(null)
  const [startRequested, setStartRequested] = useState(false)

  useEffect(() => {
    if (!startRequested) return undefined
    const timer = setTimeout(() => setStartRequested(false), SENSING_START_MS)
    return () => clearTimeout(timer)
  }, [startRequested])

  const mood = state?.mood
  const reply = state?.lastReply
  const partial = state?.partialTranscript

  useEffect(() => {
    if (mood === 'listening' && partial) setCaption(partial)
    else if (mood === 'speaking' && reply) setCaption(reply)
    if (mood === 'idle' || mood === 'sleeping') {
      const timer = setTimeout(() => setCaption(null), CAPTION_LINGER_MS)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [mood, reply, partial])

  if (!state) return null
  const consented = state.settings.consentAt != null
  const sensingOn = state.vitals.sensing
  const starting = startRequested && !sensingOn && !state.notice
  const { text, sub } = consented
    ? headline(state, starting)
    : { text: 'Hearth', sub: 'click to review consent in the dashboard' }
  const press = consented ? ptt.press : () => window.hearth.openDashboard()
  const error =
    ptt.error ??
    state.notice ??
    (!state.status.assemblyReady ? 'Add ASSEMBLYAI_API_KEY to talk' : null)
  // SmartSpectra's own guidance ("Move closer", "Not enough light"), shown only while sensing.
  const hint =
    sensingOn && state.vitals.validationHint ? `Camera: ${state.vitals.validationHint}` : null
  const toggleSensing = (): void => {
    setStartRequested(!sensingOn)
    window.hearth.requestSensing(!sensingOn)
  }

  return (
    <div className="pill-wrap">
      {error ? (
        <div className="caption problem">{error}</div>
      ) : caption ? (
        <div className="caption">{caption}</div>
      ) : (
        hint && <div className="caption hint">{hint}</div>
      )}
      <div className="pill">
        <Tooltip label={consented ? 'Hold to talk' : 'Review consent'} openDelay={600}>
          <button
            className="orb-hit"
            onPointerDown={press}
            onPointerUp={ptt.release}
            onPointerLeave={ptt.release}
            aria-label="Hold to talk to Hearth"
          >
            <Orb mood={state.mood} breathing={state.vitals.breathing} size={34} />
          </button>
        </Tooltip>

        {state.mood === 'listening' && <Bars source="mic" color="var(--green)" />}
        {state.mood === 'speaking' && <Bars source="player" color="var(--amber)" />}

        <div style={{ minWidth: 0, flex: 1, paddingRight: 4 }}>
          <div className="pill-text">{text}</div>
          {sub && <div className="pill-sub">{sub}</div>}
        </div>

        <div className="pill-actions">
          <Tooltip
            label={sensingOn ? 'Camera on: stop sensing' : 'Start sensing with the camera'}
            openDelay={400}
          >
            <ActionIcon
              variant={sensingOn ? 'light' : 'subtle'}
              color={sensingOn ? 'green' : 'gray'}
              radius="xl"
              loading={starting}
              aria-pressed={sensingOn}
              aria-label={sensingOn ? 'Camera on, stop sensing' : 'Start sensing'}
              onClick={toggleSensing}
            >
              {sensingOn ? <IconCamera size={17} /> : <IconCameraOff size={17} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Open dashboard" openDelay={400}>
            <ActionIcon
              variant="subtle"
              color="gray"
              radius="xl"
              onClick={() => window.hearth.openDashboard()}
            >
              <IconLayoutDashboard size={17} />
            </ActionIcon>
          </Tooltip>
          <Menu position="top-end" withinPortal={false} shadow="none">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" radius="xl" aria-label="More">
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                onClick={() =>
                  void window.hearth.updateSettings({ quietMode: !state.settings.quietMode })
                }
              >
                {state.settings.quietMode ? 'Turn quiet mode off' : 'Quiet mode'}
              </Menu.Item>
              <Menu.Item onClick={() => window.hearth.openDashboard()}>Open dashboard</Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={() => window.hearth.quit()}>
                Quit Hearth
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>
    </div>
  )
}
