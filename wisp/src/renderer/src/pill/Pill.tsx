import { useEffect, useRef, useState } from 'react'
import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import { IconDots, IconLayoutDashboard } from '@tabler/icons-react'
import type { WispState } from '@shared/types'
import { Orb } from '../components/Orb'
import { mic } from '../lib/mic'
import { player } from '../lib/player'
import { useWisp } from '../lib/store'
import { usePushToTalk } from '../lib/usePushToTalk'

const CAPTION_LINGER_MS = 7_000

function headline(state: WispState): { text: string; sub: string } {
  const shortcut = state.status.pttShortcut
  switch (state.mood) {
    case 'listening':
      return state.listenMode === 'handsFree'
        ? { text: 'listening, hands-free', sub: `press ${shortcut} to send, Esc to cancel` }
        : { text: 'listening', sub: 'release to send' }
    case 'thinking':
      return { text: state.activity ?? 'thinking', sub: state.partialTranscript ? `"${state.partialTranscript}"` : '' }
    case 'speaking':
      return { text: 'Wisp', sub: 'speaking' }
    case 'sleeping':
      return { text: 'Wisp', sub: 'asleep' }
    default:
      if (state.settings.quietMode) return { text: 'Wisp', sub: 'quiet mode, ask any time' }
      return { text: 'Wisp', sub: `hold ${shortcut} to talk` }
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
  const state = useWisp()
  const ptt = usePushToTalk()
  const [caption, setCaption] = useState<string | null>(null)

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
  const { text, sub } = headline(state)
  const error = ptt.error ?? state.notice ?? (!state.status.assemblyReady ? 'Add ASSEMBLYAI_API_KEY to talk' : null)

  return (
    <div className="pill-wrap">
      {(caption || error) && <div className={error ? 'caption problem' : 'caption'}>{error ?? caption}</div>}
      <div className="pill">
        <Tooltip label="Hold to talk" openDelay={600}>
          <button
            className="orb-hit"
            onPointerDown={ptt.press}
            onPointerUp={ptt.release}
            onPointerLeave={ptt.release}
            aria-label="Hold to talk to Wisp"
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
          <Tooltip label="Open dashboard" openDelay={400}>
            <ActionIcon variant="subtle" color="gray" radius="xl" onClick={() => window.wisp.openDashboard()}>
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
              <Menu.Item onClick={() => void window.wisp.updateSettings({ quietMode: !state.settings.quietMode })}>
                {state.settings.quietMode ? 'Turn quiet mode off' : 'Quiet mode'}
              </Menu.Item>
              <Menu.Item onClick={() => window.wisp.openDashboard()}>Open dashboard</Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={() => window.wisp.quit()}>
                Quit Wisp
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>
    </div>
  )
}
