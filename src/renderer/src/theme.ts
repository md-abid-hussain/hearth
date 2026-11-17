import { createTheme, type CSSVariablesResolver } from '@mantine/core'

export const theme = createTheme({
  fontFamily: "'Bricolage Grotesque Variable', system-ui, sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', ui-monospace, monospace",
  headings: { fontFamily: "'Bricolage Grotesque Variable', system-ui, sans-serif", fontWeight: '800' },
  primaryColor: 'hearthBlue',
  defaultRadius: 'md',
  colors: {
    hearthBlue: ['#eef3ff', '#dce6ff', '#b8ccff', '#8fb4ff', '#6f9bf5', '#4f7fe6', '#2453c9', '#1d44a6', '#173783', '#112960'],
    amber: ['#fff6e8', '#ffe9c7', '#fcd394', '#f7bd60', '#f0a43a', '#e08f1f', '#bb7412', '#935a0d', '#6c4209', '#462a05']
  },
  components: {
    Button: { defaultProps: { radius: 'md' }, styles: { root: { fontWeight: 650, fontSize: 14 } } },
    Switch: { defaultProps: { color: 'teal', size: 'md' } },
    SegmentedControl: { defaultProps: { radius: 'md' }, styles: { label: { fontSize: 13, fontWeight: 550, paddingInline: 12 } } },
    TextInput: { styles: { input: { fontSize: 15 } } }
  }
})

/** Lets Mantine components inherit the Hearth surface and text tokens. */
export const cssResolver: CSSVariablesResolver = () => ({
  variables: {},
  dark: {
    '--mantine-color-body': '#131313',
    '--mantine-color-text': '#f3efe6',
    '--mantine-color-dimmed': '#8e897f',
    '--mantine-color-default': '#1a1a1a',
    '--mantine-color-default-border': '#3a3a3a',
    '--mantine-color-default-hover': '#202020',
    '--mantine-primary-color-filled': '#8fb4ff',
    '--mantine-primary-color-filled-hover': '#a6c3ff',
    '--mantine-primary-color-contrast': '#0d1a33'
  },
  light: {
    '--mantine-color-body': '#f6f3ec',
    '--mantine-color-text': '#161616',
    '--mantine-color-dimmed': '#6d675d',
    '--mantine-color-default': '#ffffff',
    '--mantine-color-default-border': '#1b1b1b',
    '--mantine-color-default-hover': '#fbf9f4',
    '--mantine-primary-color-filled': '#2453c9',
    '--mantine-primary-color-filled-hover': '#1d44a6',
    '--mantine-primary-color-contrast': '#ffffff'
  }
})
