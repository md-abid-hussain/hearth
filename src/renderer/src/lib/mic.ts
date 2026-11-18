/**
 * After a turn ends the microphone stays open this long, so a quick follow-up starts instantly.
 * Then it closes, and the system's microphone indicator goes off with it.
 */
const IDLE_RELEASE_MS = 45_000

const stopTracks = (stream: MediaStream): void => stream.getTracks().forEach((t) => t.stop())

/** Push-to-talk microphone: warm for a short while after each turn, closed otherwise. */
class Mic {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null
  /** The open in progress, shared by every press that lands before it finishes. */
  private opening: Promise<void> | null = null
  /** Bumped by release(); an open that began earlier closes what it got instead of keeping it. */
  private generation = 0
  /** Bumped by every start(), stop() and release(); a start() only sends while it is the latest. */
  private request = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private sending = false
  level = 0

  /** One open at a time: two quick presses would otherwise each open a stream and leak one. */
  private ensure(): Promise<void> {
    if (!this.opening) {
      const opening = this.open().catch((err: unknown) => {
        if (this.opening === opening) this.opening = null
        throw err
      })
      this.opening = opening
    }
    return this.opening
  }

  private async open(): Promise<void> {
    const generation = this.generation
    const released = (): boolean => generation !== this.generation
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
    if (released()) {
      stopTracks(stream)
      return
    }
    const ctx = new AudioContext()
    const close = (): void => {
      stopTracks(stream)
      void ctx.close()
    }
    try {
      await ctx.audioWorklet.addModule('./pcm-worklet.js')
    } catch (err) {
      close()
      throw err
    }
    // Released while opening: the press that asked for it has already ended.
    if (released()) {
      close()
      return
    }
    try {
      const source = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'pcm-capture')
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        const pcm = new Int16Array(e.data)
        let peak = 0
        for (let i = 0; i < pcm.length; i += 16) peak = Math.max(peak, Math.abs(pcm[i]))
        this.level = peak / 0x8000
        if (this.sending) window.hearth.pttAudio(new Uint8Array(e.data))
      }
      source.connect(node)
      // An unplugged headset ends its track. Closing then lets the next press open whichever
      // microphone the system offers instead of holding on to a dead one.
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (this.stream === stream) this.release()
      })
      this.stream = stream
      this.ctx = ctx
      this.source = source
      this.node = node
    } catch (err) {
      close()
      throw err
    }
  }

  async start(): Promise<void> {
    const request = ++this.request
    this.cancelIdleRelease()
    await this.ensure()
    // stop() or release() came while the microphone was opening; this press is over.
    if (request !== this.request) return
    await this.ctx?.resume()
    if (request !== this.request) return
    this.sending = true
  }

  stop(): void {
    this.request++
    this.sending = false
    this.level = 0
    this.cancelIdleRelease()
    this.idleTimer = setTimeout(() => this.release(), IDLE_RELEASE_MS)
  }

  /** Closes the microphone now. The next start() opens it again. */
  release(): void {
    this.request++
    this.generation++
    this.cancelIdleRelease()
    this.sending = false
    this.level = 0
    this.opening = null
    if (this.node) this.node.port.onmessage = null
    this.source?.disconnect()
    this.node?.disconnect()
    if (this.stream) stopTracks(this.stream)
    void this.ctx?.close()
    this.ctx = null
    this.node = null
    this.source = null
    this.stream = null
  }

  private cancelIdleRelease(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}

export const mic = new Mic()
