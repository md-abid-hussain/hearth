import { useEffect } from 'react'
import { useMantineColorScheme } from '@mantine/core'
import type { HearthState } from '@shared/types'
import { useHearthSelect } from '../lib/store'

const selectTheme = (state: HearthState): HearthState['settings']['theme'] => state.settings.theme

/** Keeps Mantine's color scheme on the theme chosen in Settings. */
export function ThemeSync(): null {
  const choice = useHearthSelect(selectTheme)
  const { setColorScheme } = useMantineColorScheme()
  useEffect(() => {
    if (choice) setColorScheme(choice)
  }, [choice, setColorScheme])
  return null
}
