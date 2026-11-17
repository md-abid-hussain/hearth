/**
 * HEARTH_DEMO=1 is for recording a demo video. Hearth keeps its data in a separate folder, so a
 * recording starts from the consent screen without touching real data, and its timers run in
 * minutes instead of hours. The thresholds on the signals stay the same.
 */
export const isDemo = (): boolean => process.env.HEARTH_DEMO === '1'

/** The normal value, or the shorter demo one when HEARTH_DEMO=1. Read at use time, after .env loads. */
export const timing = (normal: number, demo: number): number => (isDemo() ? demo : normal)
