// Converts mic audio to 16 kHz mono PCM16 and posts ~50 ms chunks to the main thread.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.carry = 0
    this.out = new Int16Array(800)
    this.len = 0
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (!input) return true
    let pos = this.carry
    while (pos < input.length) {
      const s = Math.max(-1, Math.min(1, input[Math.floor(pos)]))
      this.out[this.len++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.len === this.out.length) {
        this.port.postMessage(this.out.buffer.slice(0))
        this.len = 0
      }
      pos += this.ratio
    }
    this.carry = pos - input.length
    return true
  }
}

registerProcessor('pcm-capture', PcmCapture)
