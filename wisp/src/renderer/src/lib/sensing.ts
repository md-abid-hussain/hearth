import {
  ProcessingStatus,
  SmartSpectraErrorCode,
  SmartSpectraSDK,
  ValidationCode,
  breathingMetrics,
  cardioMetrics,
  faceMetrics
} from '@smartspectra/node-sdk/renderer'

type StreamListener = (stream: MediaStream | null) => void

const START_RETRY_DELAY_MS = 2_000
const NETWORK_RETRY_DELAY_MS = 3_000

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

const CAMERA_KEY = 'wisp.cameraId'

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

async function openCamera(): Promise<MediaStream> {
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
        'Camera access was blocked. Allow Wisp to use the camera in Windows privacy settings.',
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

const stopTracks = (stream: MediaStream | null): void =>
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
  if (caps.exposureCompensation) set.exposureCompensation = caps.exposureCompensation.min
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
  private telemetry = false
  /** One automatic restart per user-started session, so a dead network does not loop. */
  private retriedNetwork = false
  /** Bumped by stop(), so a pending automatic restart is abandoned. */
  private generation = 0
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

  private create(apiKey: string, telemetry: boolean): SmartSpectraSDK {
    const sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...faceMetrics],
      enableTelemetry: telemetry
    })
    sdk.on('metrics', (buf) => window.wisp.pushMetrics(buf))
    sdk.on('insight', (buf, requestId) => window.wisp.pushInsight(buf, requestId))
    sdk.on('validationStatus', (code, _ts, hint) =>
      window.wisp.pushValidation(
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
      window.wisp.reportSdkError(this.lastError.message, false)
    })
    return sdk
  }

  start(telemetry: boolean): Promise<void> {
    this.retriedNetwork = false
    return this.begin(telemetry)
  }

  private async begin(telemetry: boolean): Promise<void> {
    if (this.running || this.sdk) return
    const apiKey = await window.wisp.getSmartSpectraKey()
    if (!apiKey) throw new SensingError('SMARTSPECTRA_API_KEY is not set in .env.', null, false)

    this.telemetry = telemetry
    this.lastError = null
    for (let attempt = 0; ; attempt++) {
      const sdk = this.create(apiKey, telemetry)
      this.sdk = sdk
      try {
        const camera = await openCamera()
        await restoreAutoModes(camera.getVideoTracks()[0])
        this.setStream(camera)
        sdk.useMediaStream(camera)
        await sdk.start()
        this.running = true
        window.wisp.setSensing(true)
        return
      } catch (err) {
        const failure = toSensingError(err)
        await this.teardown(sdk)
        if (failure.retryable && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, START_RETRY_DELAY_MS))
          continue
        }
        throw failure
      }
    }
  }

  /**
   * The SDK reached kError mid-session. A failed key check over the network gets one
   * quiet fresh start; anything else stops the camera and says why once.
   */
  private async fail(sdk: SmartSpectraSDK): Promise<void> {
    const error = this.lastError
    this.running = false
    // No reset(): it rebuilds the pipeline, and the next start() creates a fresh session anyway.
    await this.teardown(sdk)
    if (error?.code === SmartSpectraErrorCode.kNetworkError && !this.retriedNetwork) {
      this.retriedNetwork = true
      const generation = this.generation
      await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS))
      if (generation !== this.generation) return
      try {
        await this.begin(this.telemetry)
        return
      } catch (err) {
        this.lastError = toSensingError(err)
      }
    }
    const reason = this.lastError?.message ?? 'SmartSpectra hit an error it could not recover from.'
    window.wisp.setSensing(false)
    window.wisp.reportSdkError(`Sensing stopped. ${reason}`, true)
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
    this.generation++
    const sdk = this.sdk
    this.running = false
    window.wisp.setSensing(false)
    if (sdk) await this.teardown(sdk)
  }

  async requestInsight(token: string, prompt: string): Promise<void> {
    if (!this.sdk || !this.running) {
      window.wisp.failInsight(token)
      return
    }
    try {
      const requestId = await this.sdk.requestInsight(prompt)
      window.wisp.bindInsight(token, requestId)
    } catch {
      window.wisp.failInsight(token)
    }
  }
}

export const sensing = new Sensing()
