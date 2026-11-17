import type { HotkeyId } from './types'

/** What each talk-key choice is called on this platform's keyboard. */
export function hotkeyLabel(id: HotkeyId, platform: string): string {
  const mac = platform === 'darwin'
  switch (id) {
    case 'right-alt':
      return mac ? 'Right Option' : 'Right Alt'
    case 'right-ctrl':
      return mac ? 'Right Control' : 'Right Ctrl'
    default:
      return mac ? 'Control + Command' : platform === 'linux' ? 'Ctrl + Super' : 'Ctrl + Win'
  }
}

/** MacBook keyboards have no Right Control key, so Macs start with Right Option. */
export const defaultHotkey = (platform: string): HotkeyId =>
  platform === 'darwin' ? 'right-alt' : 'right-ctrl'
