// Starts the built app with a throwaway profile, checks that the dashboard and the widget both
// render, saves a screenshot of each to smoke-shots/, and quits. CI runs it on Windows, macOS and
// Linux; locally: npx electron-vite build && node scripts/smoke.mjs
import { execSync, spawn } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import electron from 'electron'

const PORT = 9339
const SHOTS = 'smoke-shots'
const profile = mkdtempSync(join(tmpdir(), 'hearth-smoke-'))
const args = ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`]
// GitHub's Linux runners cannot use Chromium's setuid sandbox.
if (process.platform === 'linux') args.push('--no-sandbox')
const app = spawn(electron, args, { stdio: 'inherit' })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function pages() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json`)
    return (await res.json()).filter((p) => p.type === 'page')
  } catch {
    return []
  }
}

/** Evaluates an expression in a page and optionally saves a screenshot of it. */
function inspect(page, expression, shot) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    const replies = new Map()
    let id = 0
    const send = (method, params = {}) =>
      new Promise((res) => {
        replies.set(++id, res)
        ws.send(JSON.stringify({ id, method, params }))
      })
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      replies.get(msg.id)?.(msg)
    }
    ws.onerror = () => reject(new Error(`could not connect to ${page.url}`))
    ws.onopen = async () => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true })
      if (shot) {
        const image = await send('Page.captureScreenshot', { format: 'png' })
        if (image.result?.data)
          writeFileSync(join(SHOTS, shot), Buffer.from(image.result.data, 'base64'))
      }
      ws.close()
      resolve(result.result?.result?.value)
    }
  })
}

let ok = false
try {
  mkdirSync(SHOTS, { recursive: true })
  let found = []
  for (let i = 0; i < 90 && found.length < 2; i++) {
    await wait(1000)
    found = await pages()
  }
  await wait(5000)
  found = await pages()
  const dashboard = found.find((p) => p.url.includes('#dashboard'))
  const widget = found.find((p) => p.url.includes('#pill'))
  if (!dashboard || !widget)
    throw new Error(`expected two windows, found: ${found.map((p) => p.url).join(', ')}`)

  const os = process.platform
  const nav = await inspect(
    dashboard,
    `document.querySelectorAll('.nav-item').length`,
    `${os}-dashboard.png`
  )
  const face = await inspect(
    widget,
    `Boolean(document.querySelector('[data-hit]'))`,
    `${os}-widget.png`
  )
  console.log(`dashboard nav items: ${nav}, widget face: ${face}`)
  ok = nav === 9 && face === true
  if (!ok) throw new Error('a window did not render as expected')
  console.log('smoke test passed')
} catch (err) {
  console.error(`smoke test failed: ${err.message}`)
} finally {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${app.pid} /T /F`, { stdio: 'ignore' })
    } catch {
      // Already gone.
    }
  } else app.kill('SIGKILL')
  await wait(1000)
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
  process.exit(ok ? 0 : 1)
}
