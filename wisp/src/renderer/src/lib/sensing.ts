import {
  MetricType,
  ProcessingStatus,
  SmartSpectraErrorCode,
  SmartSpectraSDK,
  ValidationCode,
  breathingMetrics,
  cardioMetrics
} from '@smartspectra/node-sdk/renderer'
import type { Settings } from '@shared/types'
import { reviewConsent } from './consent'

/**
 * Only what Hearth uses: breathing and cardio always, blink and talk detection and facial
 * expressions when switched on in Privacy. The full face bundle would also compute 478
 * landmarks per frame that nothing reads.
 */
function requestedMetrics(settings: Settings): number[] {
  const metrics: number[] = [...breathingMetrics, ...cardioMetrics]
  if (settings.measureBlinks) metrics.push(MetricType.BLINKING, MetricType.TALKING)
  if (settings.measureExpressions) metrics.push(MetricType.EXPRESSIONS)
  return metrics
}

/** Errors that end a running session even when the SDK does not report kError. */
const FATAL_WHILE_RUNNING = new Set<number>([
  SmartSpectraErrorCode.kInputUnavailable,
  SmartSpectraErrorCode.kProcessingFailed,
  SmartSpectraErrorCode.kSustainedLowFrameRate
])

type StreamListener = (stream: MediaStream | null) => void

/**
 * Every frame is copied from this renderer to the main process, so the SDK's default
 * 1280x720 costs about three times the bandwidth of 640x480 and can starve both
 * processes until the frame rate falls below what SmartSpectra accepts.
 */
const CAMERA: MediaTrackConstraints = {
  facingMode: 'user',
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 30 }
}

const CAMERA_KEY = 'hearth.cameraId'

export interface CameraOption {
  id: string
  label: string
}

/** Cameras Windows exposes, including a phone shared through Phone Link. */
export async function listCameras(): Promise<CameraOption[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }))
}

export const chosenCamera = (): string | null => localStorage.getItem(CAMERA_KEY)

export function chooseCamera(id: string | null): void {
  if (id) localStorage.setItem(CAMERA_KEY, id)
  else localStorage.removeItem(CAMERA_KEY)
}

/** Opens the chosen camera (or the default) with the sensing constraints; also used for the widget preview. */
export async function openCamera(): Promise<MediaStream> {
  const id = chosenCamera()
  try {
    if (id) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { ...CAMERA, facingMode: undefined, deviceId: { exact: id } },
          audio: false
        })
      } catch (err) {
        // The chosen camera is gone (a phone that disconnected); fall back to the default.
        if (
          (err as DOMException).name !== 'OverconstrainedError' &&
          (err as DOMException).name !== 'NotFoundError'
        )
          throw err
      }
    }
    return await navigator.mediaDevices.getUserMedia({ video: CAMERA, audio: false })
  } catch (err) {
    const name = (err as DOMException).name
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new SensingError(
        'Camera access was blocked. Allow Hearth to use the camera in Windows privacy settings.',
        null,
        false
      )
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      throw new SensingError(
        'The camera is in use by another app. Close it and try again.',
        null,
        true
      )
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new SensingError('No camera was found.', null, false)
    }
    throw new SensingError(`The camera could not start: ${(err as Error).message}`, null, true)
  }
}

export const stopTracks = (stream: MediaStream | null): void =>
  stream?.getTracks().forEach((t) => t.stop())

type Range = { min: number; max: number }

/** Image Capture extensions to MediaTrackCapabilities. */
interface CameraCapabilities {
  exposureMode?: string[]
  whiteBalanceMode?: string[]
  exposureCompensation?: Range
  brightness?: Range
}

/**
 * Puts the camera back on its automatic modes. The driver keeps manual values after a
 * track closes, including SmartSpectra's own post-start lock, so a stale lock would
 * otherwise carry into the next session and into other apps.
 */
async function restoreAutoModes(track: MediaStreamTrack): Promise<void> {
  if (track.readyState !== 'live') return
  const caps = track.getCapabilities() as CameraCapabilities
  const set: Record<string, unknown> = {}
  if (caps.exposureMode?.includes('continuous')) set.exposureMode = 'continuous'
  if (caps.whiteBalanceMode?.includes('continuous')) set.whiteBalanceMode = 'continuous'
  // Neutral (0) when the camera allows it; the minimum would darken the image, and SmartSpectra
  // needs a well-lit face.
  if (caps.exposureCompensation) {
    const { min, max } = caps.exposureCompensation
    set.exposureCompensation = min <= 0 && max >= 0 ? 0 : (min + max) / 2
  }
  if (caps.brightness) set.brightness = Math.round((caps.brightness.min + caps.brightness.max) / 2)
  if (!Object.keys(set).length) return
  try {
    await track.applyConstraints({ advanced: [set as MediaTrackConstraintSet] })
  } catch {
    // A camera without these controls is already on its defaults.
  }
}

/** Plain-language messages for SmartSpectraErrorCode values, per the Node API reference. */
const MESSAGES: Partial<Record<number, string>> = {
  [SmartSpectraErrorCode.kAuthenticationFailed]:
    'Presage refused the SmartSpectra API key. Check SMARTSPECTRA_API_KEY in .env.',
  [SmartSpectraErrorCode.kCreditExhausted]: 'Your SmartSpectra credit has run out.',
  [SmartSpectraErrorCode.kNetworkError]:
    'SmartSpectra could not reach Presage to check your key. Check your internet connection, then start sensing again.',
  [SmartSpectraErrorCode.kServerError]:
    "Presage's server had a problem. Try starting again in a moment.",
  [SmartSpectraErrorCode.kInputUnavailable]:
    'The camera is unavailable. Close other apps that use it and try again.',
  [SmartSpectraErrorCode.kMetricNotAuthorized]:
    'Your SmartSpectra plan does not include some of the requested metrics.',
  [SmartSpectraErrorCode.kSustainedLowFrameRate]:
    'The camera could not keep up 25 frames a second. More light on your face or closing other camera apps should help.',
  [SmartSpectraErrorCode.kConfigurationFailed]: 'SmartSpectra rejected the session settings.'
}

export class SensingError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly retryable: boolean
  ) {
    super(message)
  }
}

function toSensingError(err: unknown): SensingError {
  if (err instanceof SensingError) return err
  const { code, retryable, message } = (err ?? {}) as {
    code?: unknown
    retryable?: unknown
    message?: string
  }
  const numeric = typeof code === 'number' ? code : null
  return new SensingError(
    (numeric != null && MESSAGES[numeric]) || message || 'SmartSpectra failed to start.',
    numeric,
    retryable === true
  )
}

/** Owns the renderer-side SmartSpectra session and forwards raw packets to the main process. */
class Sensing {
  private sdk: SmartSpectraSDK | null = null
  private listeners = new Set<StreamListener>()
  private lastError: SensingError | null = null
  stream: MediaStream | null = null
  running = false

  /** Calls back immediately with the current stream, then on every change. */
  onStream(listener: StreamListener): () => void {
    this.listeners.add(listener)
    listener(this.stream)
    return () => this.listeners.delete(listener)
  }

  private setStream(stream: MediaStream | null): void {
    this.stream = stream
    this.listeners.forEach((l) => l(stream))
  }

  private create(apiKey: string, settings: Settings): SmartSpectraSDK {
    const sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: requestedMetrics(settings),
      enableTelemetry: settings.telemetry
    })
    sdk.on('metrics', (buf) => window.hearth.pushMetrics(buf))
    sdk.on('insight', (buf, requestId) => window.hearth.pushInsight(buf, requestId))
    sdk.on('validationStatus', (code, _ts, hint) =>
      window.hearth.pushValidation(
        code === ValidationCode.kOk ? null : hint || 'Adjust your position'
      )
    )
    sdk.on('processingStatus', (status) => {
      if (status === ProcessingStatus.kError && this.sdk === sdk && this.running)
        void this.fail(sdk)
    })
    sdk.on('error', (code, message, retryable) => {
      // Invalid-state errors are per-frame fallout of an earlier failure; processingStatus reports that once.
      if (code === SmartSpectraErrorCode.kInvalidState || this.sdk !== sdk) return
      this.lastError = toSensingError({ code, message, retryable })
      window.hearth.reportSdkError(this.lastError.message, false)
      if (this.running && FATAL_WHILE_RUNNING.has(code)) void this.fail(sdk)
    })
    return sdk
  }

  /** One attempt. Per the SDK docs a retryable failure is the user's to retry, never automatic. */
  async start(): Promise<void> {
    if (this.running || this.sdk) return
    const { settings } = await window.hearth.getState()
    if (settings.consentAt == null) {
      reviewConsent()
      throw new SensingError('Accept the consent screen before the camera can start.', null, false)
    }
    const apiKey = await window.hearth.getSmartSpectraKey()
    if (!apiKey) throw new SensingError('SMARTSPECTRA_API_KEY is not set in .env.', null, false)
    if (this.running || this.sdk) return

    this.lastError = null
    const sdk = this.create(apiKey, settings)
    this.sdk = sdk
    // stop() can land during any await below; it clears this.sdk, and start() must not carry on.
    const stopped = (): boolean => this.sdk !== sdk
    try {
      const camera = await openCamera()
      if (stopped()) {
        stopTracks(camera)
        return
      }
      await restoreAutoModes(camera.getVideoTracks()[0])
      this.setStream(camera)
      // A camera that disconnects (a phone over Phone Link, a USB cable) just stops sending frames.
      camera.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (this.sdk === sdk && this.running) {
          this.lastError = new SensingError('The camera disconnected.', null, true)
          void this.fail(sdk)
        }
      })
      sdk.useMediaStream(camera)
      await sdk.start()
      if (stopped()) return
      this.running = true
      window.hearth.setSensing(true)
    } catch (err) {
      if (stopped()) return
      await this.teardown(sdk)
      throw toSensingError(err)
    }
  }

  /** The SDK reached kError mid-session: release the camera and say why once. */
  private async fail(sdk: SmartSpectraSDK): Promise<void> {
    this.running = false
    // destroy() plus a new instance on the next start() is the SDK's documented fresh start.
    await this.teardown(sdk)
    const error = this.lastError
    const reason = error?.message ?? 'SmartSpectra hit an error it could not recover from.'
    const retry =
      error?.retryable && !/start sensing/i.test(reason) ? ' Press Start sensing to try again.' : ''
    window.hearth.setSensing(false)
    window.hearth.reportSdkError(`Sensing stopped. ${reason}${retry}`, true)
  }

  private async teardown(sdk: SmartSpectraSDK): Promise<void> {
    if (this.sdk === sdk) this.sdk = null
    const camera = this.stream
    this.setStream(null)
    try {
      await sdk.stop()
    } catch {
      // Already stopped or in error; destroy below releases it.
    } finally {
      sdk.destroy()
      const track = camera?.getVideoTracks()[0]
      if (track) await restoreAutoModes(track)
      // The SDK never stops a host-supplied stream, so the camera light stays on until we do.
      stopTracks(camera)
    }
  }

  async stop(): Promise<void> {
    const sdk = this.sdk
    this.running = false
    window.hearth.setSensing(false)
    if (sdk) await this.teardown(sdk)
  }

  async requestInsight(token: string, prompt: string): Promise<void> {
    if (!this.sdk || !this.running) {
      window.hearth.failInsight(token)
      return
    }
    try {
      const requestId = await this.sdk.requestInsight(prompt)
      window.hearth.bindInsight(token, requestId)
    } catch {
      window.hearth.failInsight(token)
    }
  }
}

export const sensing = new Sensing()
