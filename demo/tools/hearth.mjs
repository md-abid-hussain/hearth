// Client for Hearth's demo control API (only running when Hearth starts with HEARTH_DEMO=1).
import { readFileSync } from 'fs'
import { join } from 'path'

const CONTROL_FILE = join(process.env.APPDATA, 'hearth', 'hearth-demo-data', 'demo-control.json')

function control() {
  return JSON.parse(readFileSync(CONTROL_FILE, 'utf8'))
}

export async function api(method, path, body) {
  const { port, token } = control()
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'x-hearth-demo': token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error ?? res.status}`)
  return data
}

export const state = () => api('GET', '/state')
export const say = (text) => api('POST', '/say', { text })
export const sensing = (on) => api('POST', '/sensing', { on })
export const settings = (patch) => api('POST', '/settings', patch)
export const page = (name) => api('POST', '/page', { page: name })
export const dashboard = (opts) => api('POST', '/dashboard', opts)
export const pill = (x, y) => api('POST', '/pill', { x, y })
export const clearLog = () => api('POST', '/clearLog', {})

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls Hearth's state until `test(state)` is truthy; returns that state. */
export async function waitFor(test, { timeout = 120_000, every = 400, label = 'condition' } = {}) {
  const until = Date.now() + timeout
  for (;;) {
    const s = await state()
    if (test(s)) return s
    if (Date.now() > until) throw new Error(`Timed out waiting for ${label}`)
    await sleep(every)
  }
}

/** Waits until Hearth has finished a reply: thinking, then speaking, then idle again. */
export async function waitForReply({ timeout = 90_000 } = {}) {
  await waitFor((s) => s.mood === 'thinking' || s.mood === 'speaking', {
    timeout: 20_000,
    every: 150,
    label: 'Hearth to start answering'
  })
  return waitFor((s) => s.mood === 'idle' || s.mood === 'sleeping', {
    timeout,
    every: 250,
    label: 'Hearth to finish answering'
  })
}
