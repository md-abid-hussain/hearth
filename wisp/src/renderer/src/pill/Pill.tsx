import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import { IconCamera, IconCameraOff, IconDots, IconLayoutDashboard } from '@tabler/icons-react'
import type { HearthState } from '@shared/types'
import { Orb } from '../components/Orb'
import { useHearth } from '../lib/store'
import { usePushToTalk } from '../lib/usePushToTalk'
import { CameraPanel } from './CameraPanel'
import { VoiceMeter } from './VoiceMeter'

const CAPTION_LINGER_MS = 7_000
/** Leaving the widget collapses it after this pause, so a slip of the pointer does not. */
const COLLAPSE_DELAY_MS = 450
/** A press that moves further than this is a drag that moves the widget, not a click. */
const DRAG_THRESHOLD_PX = 5

function headline(state: HearthState): { text: string; sub: string } {
  const shortcut = state.status.pttShortcut
  switch (state.mood) {
    case 'listening':
      return state.listenMode === 'handsFree'
        ? { text: 'listening', sub: `click Hearth or press ${shortcut} to send` }
        : { text: 'listening', sub: 'release to send' }
    case 'thinking':
      return {
        text: state.activity ?? 'thinking',
        sub: state.partialTranscript ? `"${state.partialTranscript}"` : ''
      }
    case 'speaking':
      return { text: 'Hearth', sub: 'speaking' }
    case 'sleeping':
      return { text: 'Hearth', sub: `asleep · click me or hold ${shortcut}` }
    default:
      if (state.settings.quietMode) return { text: 'Hearth', sub: 'quiet mode, ask any time' }
      if (state.vitals.sensing)
        return { text: 'Hearth', sub: `sensing · click me or hold ${shortcut}` }
      return { text: 'Hearth', sub: `click me or hold ${shortcut} to talk` }
  }
}

/**
 * Tells the main process whether the pointer is over the widget. The window is transparent and
 * click-through; mouse moves are still forwarded, so this can hit-test them.
 */
function useHover(): boolean {
  const [hovered, setHovered] = useState(false)
  useEffect(() => {
    let interactive = false
    let collapse: ReturnType<typeof setTimeout> | null = null
    const set = (inside: boolean): void => {
      if (inside !== interactive) {
        interactive = inside
        window.hearth.setPillInteractive(inside)
      }
      if (inside) {
        if (collapse) clearTimeout(collapse)
        collapse = null
        setHovered(true)
      } else if (!collapse) {
        collapse = setTimeout(() => {
          collapse = null
          setHovered(false)
        }, COLLAPSE_DELAY_MS)
      }
    }
    const onMove = (e: MouseEvent): void => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      set(Boolean(el?.closest('[data-hit]')))
    }
    const onLeave = (): void => set(false)
    window.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      if (collapse) clearTimeout(collapse)
    }
  }, [])
  return hovered
}

/**
 * A caption above the widget at a fixed height. Longer text scrolls: it follows the newest words
 * while Hearth speaks, and can be scrolled back while the pointer is over it.
 */
function Caption({ text, tone }: { text: string; tone?: 'problem' | 'hint' }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const hovering = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (el && !hovering.current) el.scrollTop = el.scrollHeight
  }, [text])
  return (
    <div
      ref={ref}
      className={tone ? `caption ${tone}` : 'caption'}
      data-hit
      onMouseEnter={() => (hovering.current = true)}
      onMouseLeave={() => (hovering.current = false)}
    >
      {text}
    </div>
  )
}

export function Pill(): React.JSX.Element | null {
  const state = useHearth()
  const ptt = usePushToTalk()
  const hovered = useHover()
  const [caption, setCaption] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [micSilent, setMicSilent] = useState(false)
  const closeCamera = useCallback(() => setCameraOpen(false), [])
  const drag = useRef<{ x: number; y: number; moved: boolean; onFace: boolean } | null>(null)

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
  const listening = state.mood === 'listening'
  const heading = consented
    ? headline(state)
    : { text: 'Hearth', sub: 'review consent in the dashboard' }
  // The meter says whether anything reaches the mic; a silent mic gets a hint instead.
  const text = heading.text
  const sub = listening && micSilent ? "can't hear you, check your microphone" : heading.sub
  const click = consented ? ptt.toggle : () => window.hearth.openDashboard()

  /**
   * Press anywhere on the widget and drag to move it; once a drag starts, the main process moves
   * the window with the real cursor. A press on the face that stays put is a click that toggles
   * talking. The buttons and the menu keep their own clicks.
   */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const onFace = Boolean(target.closest('.face-hit'))
    if (!onFace && target.closest('button, a, [role="menu"], [role="menuitem"]')) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false, onFace }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.moved) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD_PX) return
    d.moved = true
    window.hearth.dragPill('start')
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d) return
    if (d.moved) window.hearth.dragPill('end')
    else if (d.onFace) click()
  }
  const problem = ptt.error ?? state.notice
  const hint = sensingOn ? state.vitals.validationHint : null
  const busy = state.mood === 'listening' || state.mood === 'thinking' || state.mood === 'speaking'
  const expanded = hovered || busy || cameraOpen || menuOpen || Boolean(problem) || !consented
  // Lower priority notes show only while the widget is open, so the face can stay small.
  const note =
    problem ?? (expanded && !state.status.assemblyReady ? 'Add ASSEMBLYAI_API_KEY to talk' : null)

  return (
    <div className="widget-wrap">
      {cameraOpen ? (
        <CameraPanel state={state} onClose={closeCamera} />
      ) : note ? (
        <Caption text={note} tone="problem" />
      ) : caption ? (
        <Caption text={caption} />
      ) : (
        expanded && hint && <Caption text={`Camera: ${hint}`} tone="hint" />
      )}

      <div
        className={[
          'hearth-bar',
          expanded ? 'expanded' : 'compact',
          sensingOn ? 'sensing' : ''
        ].join(' ')}
        data-hit
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <Tooltip
          label={
            !consented
              ? 'Review consent'
              : state.mood === 'listening'
                ? 'Click to send'
                : 'Click to talk · drag to move'
          }
          openDelay={700}
          disabled={!expanded}
        >
          <button className="face-hit" aria-label={consented ? 'Talk to Hearth' : 'Review consent'}>
            <span className="face-wrap">
              <Orb
                mood={state.mood}
                breathing={state.vitals.breathing}
                size={expanded ? 42 : 46}
                alert={problem ? 'problem' : 'none'}
                expression={state.vitals.expression?.label ?? null}
              />
              {sensingOn && (
                <span className="face-badge camera" title="Camera on">
                  <IconCamera size={10} stroke={2.4} />
                </span>
              )}
              {!expanded && hint && <span className="face-badge hint" title={hint} />}
            </span>
          </button>
        </Tooltip>

        <div className="bar-info" aria-hidden={!expanded}>
          <div className="bar-text">{text}</div>
          {sub && <div className={listening && micSilent ? 'bar-sub warn' : 'bar-sub'}>{sub}</div>}
        </div>

        {listening && <VoiceMeter onSilentChange={setMicSilent} />}

        <div className="bar-actions" aria-hidden={!expanded}>
          <Tooltip
            label={
              cameraOpen ? 'Hide camera' : sensingOn ? 'Camera on: check framing' : 'Open camera'
            }
            openDelay={400}
          >
            <ActionIcon
              variant={sensingOn || cameraOpen ? 'light' : 'subtle'}
              color={sensingOn ? 'green' : 'gray'}
              radius="xl"
              aria-pressed={cameraOpen}
              aria-label={cameraOpen ? 'Hide camera' : 'Open camera'}
              onClick={() => setCameraOpen((open) => !open)}
            >
              {sensingOn ? <IconCamera size={17} /> : <IconCameraOff size={17} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Open dashboard" openDelay={400}>
            <ActionIcon
              variant="subtle"
              color="gray"
              radius="xl"
              aria-label="Open dashboard"
              onClick={() => window.hearth.openDashboard()}
            >
              <IconLayoutDashboard size={17} />
            </ActionIcon>
          </Tooltip>
          <Menu
            position="top-end"
            withinPortal={false}
            shadow="none"
            opened={menuOpen}
            onChange={setMenuOpen}
          >
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
              {sensingOn && (
                <Menu.Item onClick={() => window.hearth.requestSensing(false)}>
                  Stop sensing
                </Menu.Item>
              )}
              <Menu.Item onClick={() => window.hearth.openDashboard()}>Open dashboard</Menu.Item>
              <Menu.Item onClick={() => window.hearth.resetPill()}>
                Move back to the bottom
              </Menu.Item>
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
