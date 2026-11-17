import { loadFont as loadSans } from '@remotion/google-fonts/BricolageGrotesque'
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono'
import { loadFont as loadSerif } from '@remotion/google-fonts/Newsreader'

/** Hearth's own type roles: sans for interface, serif for Hearth's voice, mono for numbers. */
export const fonts = {
  sans: loadSans('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] }).fontFamily,
  serif: loadSerif('normal', { weights: ['400', '500'], subsets: ['latin'] }).fontFamily,
  serifItalic: loadSerif('italic', { weights: ['400'], subsets: ['latin'] }).fontFamily,
  mono: loadMono('normal', { weights: ['400', '500'], subsets: ['latin'] }).fontFamily
}

/** The app's dark theme (wisp/src/renderer/src/styles/tokens.css). */
export const color = {
  bg: '#131313',
  surface: '#1a1a1a',
  surface2: '#222222',
  line: '#262626',
  lineStrong: '#3a3a3a',
  text: '#f3efe6',
  muted: '#a19b90',
  faint: '#6a655e',
  amber: '#f0a43a',
  amberSoft: 'rgba(240, 164, 58, 0.26)',
  green: '#3fb27f',
  greenSoft: 'rgba(63, 178, 127, 0.14)',
  red: '#e5675b',
  accent: '#8fb4ff',
  violet: '#8f86f5'
}

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080

/** Seconds to frames. */
export const s = (seconds: number): number => Math.round(seconds * FPS)
