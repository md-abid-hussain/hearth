// Lays the music bed under a rendered video's voices and writes the final file.
//
//   node tools/mix.mjs out/demo-voices.mp4 out/hearth-demo-full.mp4
//
// The 75-second bed (public/music/bed.mp3, ElevenLabs Music) is looped with 5-second
// crossfades, faded in and out, kept about 16 dB under the voices, and ducked further whenever
// anyone speaks (a sidechain keyed on the voice track). The result is normalized to -16 LUFS.
import { spawnSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import ffmpeg from 'ffmpeg-static'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('usage: node tools/mix.mjs <video with voices> <output>')
const bed = join(root, 'public', 'music', 'bed.mp3')

const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', input], { encoding: 'utf8' })
const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe.stderr)
if (!m) throw new Error(`could not read the length of ${input}`)
const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])

const BED_SECONDS = 75
const CROSSFADE = 5
const copies = Math.ceil((seconds + CROSSFADE) / (BED_SECONDS - CROSSFADE))
const inputs = [input, ...Array.from({ length: copies }, () => bed)]
let chain = '[1:a]'
const parts = []
for (let i = 2; i <= copies; i++) {
  const out = `[b${i}]`
  parts.push(`${chain}[${i}:a]acrossfade=d=${CROSSFADE}:c1=tri:c2=tri${out}`)
  chain = out
}
/** The mix up to its last stage, which `tail` finishes. */
const filter = (tail) =>
  [
    ...parts,
    `${chain}atrim=0:${seconds.toFixed(2)},asetpts=PTS-STARTPTS,volume=0.12,` +
      `afade=t=in:st=0:d=3,afade=t=out:st=${(seconds - 4).toFixed(2)}:d=4[bed]`,
    '[0:a]asplit=2[voice][key]',
    '[bed][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=700[duck]',
    `[voice][duck]amix=inputs=2:normalize=0:duration=first,${tail}[out]`
  ].join(';')
const ffInputs = inputs.flatMap((f) => ['-i', f])

// Pass 1 measures the mix. A single fixed gain then brings it to -16 LUFS; a dynamic loudness
// filter would lift the music-only stretches as loud as the voices.
const measure = spawnSync(
  ffmpeg,
  ['-hide_banner', ...ffInputs, '-filter_complex', filter('ebur128=framelog=quiet'), '-map', '[out]', '-f', 'null', '-'],
  { encoding: 'utf8' }
)
const integrated = /I:\s+(-?[\d.]+) LUFS/.exec(measure.stderr)
if (!integrated) throw new Error(`could not measure the mix: ${measure.stderr.slice(-400)}`)
const gain = -16 - Number(integrated[1])

const args = [
  '-hide_banner', '-loglevel', 'error', '-y',
  ...ffInputs,
  '-filter_complex', filter(`volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:level=false`),
  '-map', '0:v', '-map', '[out]',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  output
]
const run = spawnSync(ffmpeg, args, { encoding: 'utf8' })
if (run.status !== 0) throw new Error(run.stderr)
console.log(`mixed ${output} (${seconds.toFixed(1)} s, bed looped ${copies}x, gain ${gain.toFixed(1)} dB)`)
