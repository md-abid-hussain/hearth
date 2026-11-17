import '@mantine/core/styles.css'
import '@mantine/charts/styles.css'
import '@mantine/notifications/styles.css'
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource/newsreader/400.css'
import '@fontsource/newsreader/500.css'
import '@fontsource/newsreader/400-italic.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/tokens.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'
import { ThemeSync } from './components/ThemeSync'
import { Dashboard } from './dashboard/Dashboard'
import { Pill } from './pill/Pill'
import { connectStore } from './lib/store'
import { cssResolver, theme } from './theme'

const role = window.location.hash.replace('#', '') === 'pill' ? 'pill' : 'dashboard'
if (role === 'pill') document.body.classList.add('pill-body')

void connectStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssResolver} defaultColorScheme="dark">
      <ThemeSync />
      {role === 'pill' ? (
        <Pill />
      ) : (
        <ModalsProvider>
          <Notifications position="top-right" />
          <Dashboard />
        </ModalsProvider>
      )}
    </MantineProvider>
  </StrictMode>
)
