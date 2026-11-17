import { hub } from './hub'

/** No face in view for this long pauses sensing. */
const AWAY_PAUSE_MS = 10_000

type SensingRequest = (on: boolean) => void

/**
 * Stops SmartSpectra once the user has left the camera, so it does not process an empty
 * chair, and starts it again at the first key press or mouse movement after they return.
 * Only a pause it made itself is resumed; sensing the user stopped stays stopped.
 */
class Away {
  private request: SensingRequest = () => {}
  private timer: NodeJS.Timeout | null = null
  /** When the face was last lost, for the pause in progress. */
  private lostAt: number | null = null
  private pausing = false
  paused = false

  init(request: SensingRequest): void {
    this.request = request
  }

  /** From SmartSpectra's validation status: whether a face is in view. */
  faceSeen(seen: boolean): void {
    if (seen) this.clearTimer()
    else this.arm(() => true)
  }

  /** Metrics stopped arriving without a no-face status; pauses only if they stay stopped. */
  presenceLost(): void {
    this.arm(() => !hub.vitals.present)
  }

  private arm(stillAway: () => boolean): void {
    if (this.timer || !hub.vitals.sensing || this.pausing) return
    const lostAt = Date.now()
    this.timer = setTimeout(() => {
      this.timer = null
      if (!hub.vitals.sensing || !stillAway()) return
      this.lostAt = lostAt
      this.pausing = true
      hub.record(
        'session',
        'You stepped away, so sensing paused. It starts again when you use the keyboard or mouse.'
      )
      this.request(false)
    }, AWAY_PAUSE_MS)
  }

  /** Any keyboard or mouse input. */
  input(): void {
    if (!this.paused) return
    this.paused = false
    this.request(true)
  }

  /**
   * Sensing started. Returns when the user left if this start resumes an away pause, so the
   * session carries on instead of starting over.
   */
  started(): number | null {
    this.clearTimer()
    const lostAt = this.paused || this.lostAt != null ? this.lostAt : null
    this.paused = false
    this.pausing = false
    this.lostAt = null
    return lostAt
  }

  /** Sensing stopped, by this pause or by the user. */
  stopped(): void {
    this.clearTimer()
    this.paused = this.pausing
    this.pausing = false
    if (!this.paused) this.lostAt = null
    hub.vitals = { ...hub.vitals, pausedAway: this.paused }
    hub.changed()
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

export const away = new Away()
