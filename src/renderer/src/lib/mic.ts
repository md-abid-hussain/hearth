/** Push-to-talk microphone: stays warm after first use so the next press starts instantly. */
class Mic {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null
  private sending = false
  level = 0

  private async ensure(): Promise<void> {
    if (this.ctx) return
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
    this.ctx = new AudioContext()
    await this.ctx.audioWorklet.addModule('./pcm-worklet.js')
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture')
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const pcm = new Int16Array(e.data)
      let peak = 0
      for (let i = 0; i < pcm.length; i += 16) peak = Math.max(peak, Math.abs(pcm[i]))
      this.level = peak / 0x8000
      if (this.sending) window.hearth.pttAudio(new Uint8Array(e.data))
    }
    this.source.connect(this.node)
  }

  async start(): Promise<void> {
    await this.ensure()
    await this.ctx?.resume()
    this.sending = true
  }

  stop(): void {
    this.sending = false
    this.level = 0
  }

  release(): void {
    this.stop()
    this.source?.disconnect()
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close()
    this.ctx = null
    this.node = null
    this.source = null
    this.stream = null
  }
}

export const mic = new Mic()
