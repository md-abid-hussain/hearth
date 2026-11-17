import { useEffect } from 'react'
import { useMantineColorScheme } from '@mantine/core'
import { useHearth } from '../lib/store'

/** Keeps Mantine's color scheme on the theme chosen in Settings. */
export function ThemeSync(): null {
  const state = useHearth()
  const { setColorScheme } = useMantineColorScheme()
  const choice = state?.settings.theme
  useEffect(() => {
    if (choice) setColorScheme(choice)
  }, [choice, setColorScheme])
  return null
}
