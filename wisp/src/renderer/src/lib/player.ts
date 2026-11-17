const SAMPLE_RATE = 24_000

/** Gapless playback of streamed PCM16 chunks; reports idle once the queue drains. */
class Player {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private playhead = 0
  private sources = new Set<AudioBufferSourceNode>()
  private streamEnded = true
  private levelBuf = new Uint8Array(256)

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.connect(this.ctx.destination)
    }
    return this.ctx
  }

  begin(): void {
    this.streamEnded = false
    void this.context().resume()
  }

  push(bytes: Uint8Array): void {
    const ctx = this.context()
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
    const buffer = ctx.createBuffer(1, pcm.length, SAMPLE_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(this.analyser!)
    const startAt = Math.max(ctx.currentTime + 0.03, this.playhead)
    src.start(startAt)
    this.playhead = startAt + buffer.duration
    this.sources.add(src)
    src.onended = () => {
      this.sources.delete(src)
      this.maybeIdle()
    }
  }

  end(): void {
    this.streamEnded = true
    this.maybeIdle()
  }

  cancel(): void {
    this.sources.forEach((s) => {
      s.onended = null
      s.stop()
    })
    this.sources.clear()
    this.playhead = 0
    this.streamEnded = true
    window.hearth.playbackIdle()
  }

  level(): number {
    if (!this.analyser || this.sources.size === 0) return 0
    this.analyser.getByteTimeDomainData(this.levelBuf)
    let peak = 0
    for (const v of this.levelBuf) peak = Math.max(peak, Math.abs(v - 128))
    return peak / 128
  }

  private maybeIdle(): void {
    if (this.streamEnded && this.sources.size === 0) window.hearth.playbackIdle()
  }
}

export const player = new Player()
