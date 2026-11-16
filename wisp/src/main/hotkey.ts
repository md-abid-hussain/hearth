import { UiohookKey, uIOhook, type UiohookKeyboardEvent } from 'uiohook-napi'
import type { HotkeyId } from '../shared/types'

interface Combo {
  label: string
  /** Every group must have one key down; keys within a group are alternatives. */
  groups: number[][]
}

export const HOTKEYS: Record<HotkeyId, Combo> = {
  'ctrl-win': { label: 'Ctrl + Win', groups: [[UiohookKey.Ctrl, UiohookKey.CtrlRight], [UiohookKey.Meta, UiohookKey.MetaRight]] },
  'right-alt': { label: 'Right Alt', groups: [[UiohookKey.AltRight]] },
  'right-ctrl': { label: 'Right Ctrl', groups: [[UiohookKey.CtrlRight]] }
}

/** Windows reserves this chord for input switching, so it cannot be a registered shortcut; the hook sees it instead. */
export const HANDS_FREE_LABEL = 'Ctrl + Win + Space'

const MODIFIERS = new Set<number>([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight
])

export interface HotkeyHandlers {
  /** Recording should begin. `handsFree` is true when it started from the hands-free shortcut. */
  start(handsFree: boolean): void
  /** Hold became hands-free; keep recording after the keys are released. */
  lock(): void
  /** Recording should end and be sent. */
  stop(): void
  /** Recording should end and be discarded, e.g. the keys were part of another shortcut. */
  cancel(): void
}

/**
 * Wispr Flow style talk keys on Windows: hold the combo to talk, release to send, or press
 * Ctrl + Win + Space for hands-free and the combo again to send. Electron's globalShortcut
 * cannot see key releases or modifier-only combos, so everything comes from a low-level hook.
 */
class Hotkeys {
  private combo: Combo = HOTKEYS['ctrl-win']
  private comboKeys = new Set<number>()
  private down = new Set<number>()
  private state: 'idle' | 'holding' | 'handsFree' = 'idle'
  /** Set after the combo ends hands-free, so the Space of that same chord does not restart it. */
  private ignoreHandsFree = false
  private handlers: HotkeyHandlers | null = null
  private hookRunning = false

  start(id: HotkeyId, handlers: HotkeyHandlers): string | null {
    this.handlers = handlers
    this.use(id)
    try {
      uIOhook.on('keydown', (e) => this.onDown(e))
      uIOhook.on('keyup', (e) => this.onUp(e))
      uIOhook.start()
      this.hookRunning = true
      return null
    } catch (err) {
      return `Talk keys are unavailable because the keyboard hook failed to start (${(err as Error).message}). Hold the orb to talk.`
    }
  }

  use(id: HotkeyId): void {
    this.combo = HOTKEYS[id] ?? HOTKEYS['ctrl-win']
    this.comboKeys = new Set(this.combo.groups.flat())
    this.reset()
  }

  get label(): string {
    return this.combo.label
  }

  /** Called when push-to-talk ended some other way, such as the orb or an error. */
  reset(): void {
    this.state = 'idle'
  }

  stop(): void {
    if (this.hookRunning) uIOhook.stop()
    this.hookRunning = false
  }

  private comboHeld(): boolean {
    return this.combo.groups.every((group) => group.some((k) => this.down.has(k)))
  }

  private otherKeyHeld(): boolean {
    return [...this.down].some((k) => !this.comboKeys.has(k) && !MODIFIERS.has(k))
  }

  private onDown(e: UiohookKeyboardEvent): void {
    if (this.down.has(e.keycode)) return
    this.down.add(e.keycode)
    const inCombo = this.comboKeys.has(e.keycode)

    if (this.state === 'holding') {
      if (e.keycode === UiohookKey.Space && this.ctrlWinHeld()) {
        this.onHandsFree()
        return
      }
      if (!inCombo && !MODIFIERS.has(e.keycode)) {
        this.state = 'idle'
        this.handlers?.cancel()
      }
      return
    }

    if (this.state === 'handsFree') {
      if (e.keycode === UiohookKey.Escape) {
        this.state = 'idle'
        this.handlers?.cancel()
      } else if (inCombo && this.comboHeld()) {
        this.state = 'idle'
        this.ignoreHandsFree = true
        this.handlers?.stop()
      }
      return
    }

    if (e.keycode === UiohookKey.Space && this.ctrlWinHeld()) {
      this.onHandsFree()
      return
    }
    if (inCombo && this.comboHeld() && !this.otherKeyHeld()) {
      this.state = 'holding'
      this.handlers?.start(false)
    }
  }

  private ctrlWinHeld(): boolean {
    return HOTKEYS['ctrl-win'].groups.every((group) => group.some((k) => this.down.has(k)))
  }

  private onUp(e: UiohookKeyboardEvent): void {
    this.down.delete(e.keycode)
    if (!this.comboKeys.has(e.keycode)) return
    if (!this.comboHeld()) this.ignoreHandsFree = false
    if (this.state === 'holding') {
      this.state = 'idle'
      this.handlers?.stop()
    }
  }

  private onHandsFree(): void {
    if (this.ignoreHandsFree) return
    if (this.state === 'holding') {
      this.state = 'handsFree'
      this.handlers?.lock()
    } else if (this.state === 'handsFree') {
      this.state = 'idle'
      this.handlers?.stop()
    } else {
      this.state = 'handsFree'
      this.handlers?.start(true)
    }
  }
}

export const hotkeys = new Hotkeys()
