// Renders Hearth's app icon (the amber face) to PNG and ICO, using Electron's own Chromium.
// Run from the app folder: npx electron scripts/build-icons.mjs
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** The face on a transparent background. Small sizes get larger eyes so they stay readable. */
export function faceSvg(small = false) {
  const eyeW = small ? 58 : 46
  const eyeH = small ? 96 : 82
  const eyeY = small ? 178 : 186
  const eyeGap = small ? 44 : 40
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="shade" cx="38%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#fff" stop-opacity="0.45"/>
      <stop offset="40%" stop-color="#fff" stop-opacity="0.08"/>
      <stop offset="78%" stop-color="#000" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.34"/>
    </radialGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${small ? 6 : 12}"/></filter>
  </defs>
  <ellipse cx="256" cy="470" rx="150" ry="20" fill="#000" opacity="${small ? 0 : 0.32}" filter="url(#soft)"/>
  <circle cx="256" cy="244" r="216" fill="#f0a43a"/>
  <circle cx="256" cy="244" r="216" fill="url(#shade)"/>
  <ellipse cx="180" cy="128" rx="58" ry="30" fill="#fff" opacity="0.5" transform="rotate(-28 180 128)" filter="url(#soft)"/>
  <circle cx="256" cy="244" r="212" fill="none" stroke="#fff" stroke-opacity="0.2" stroke-width="6"/>
  <rect x="${256 - eyeGap - eyeW}" y="${eyeY}" width="${eyeW}" height="${eyeH}" rx="${eyeW / 2}" fill="#161310"/>
  <rect x="${256 + eyeGap}" y="${eyeY}" width="${eyeW}" height="${eyeH}" rx="${eyeW / 2}" fill="#161310"/>
</svg>`
}

/** An .ico holding PNG images, which Windows has read since Vista. */
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<canvas></canvas>')
  const render = async (size) => {
    const svg = faceSvg(size <= 32)
    const url = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const c = document.querySelector('canvas')
        c.width = ${size}; c.height = ${size}
        const ctx = c.getContext('2d')
        ctx.clearRect(0, 0, ${size}, ${size})
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, ${size}, ${size})
        resolve(c.toDataURL('image/png'))
      }
      img.onerror = reject
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))}
    })`)
    return Buffer.from(url.split(',')[1], 'base64')
  }

  const big = await render(512)
  mkdirSync(join(root, 'build'), { recursive: true })
  writeFileSync(join(root, 'build', 'icon.svg'), faceSvg())
  writeFileSync(join(root, 'build', 'icon.png'), big)
  writeFileSync(join(root, 'resources', 'icon.png'), big)
  const pngs = []
  for (const size of ICO_SIZES) pngs.push({ size, data: await render(size) })
  writeFileSync(join(root, 'build', 'icon.ico'), ico(pngs))
  writeFileSync(join(root, 'resources', 'icon.ico'), ico(pngs))
  console.log(
    `icons written: build/icon.png, build/icon.ico (${ICO_SIZES.join(', ')}), resources/icon.png`
  )
  app.quit()
})
