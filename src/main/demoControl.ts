import { randomBytes } from 'crypto'
import { writeFileSync } from 'fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { screen } from 'electron'
import type { Settings } from '../shared/types'
import { isDemo } from './demo'
import { hub } from './hub'
import { dataPath } from './store'
import { vitals } from './vitals'

const PORT = 47_800
const MAX_BODY = 64 * 1024
const SETTABLE: (keyof Settings)[] = [
  'quietMode',
  'nudgesEnabled',
  'measurePulse',
  'measureBreathing',
  'measureHrv',
  'measureBlinks',
  'measureExpressions',
  'theme'
]

export interface DemoControlDeps {
  /** The typed-chat path, as if the user typed the message on the Today page. */
  say: (text: string) => void
  showDashboard: () => void
  requestSensing: (on: boolean) => void
}

type Body = Record<string, unknown>

/**
 * HEARTH_DEMO=1 only: a small HTTP API on 127.0.0.1 that a recording script uses to drive Hearth
 * through the same paths a user would (typed chat, sensing, settings, dashboard pages) and to
 * read its state. Every request needs the token from demo-control.json in the data folder; the
 * custom header also keeps web pages in a browser from calling it.
 */
export function startDemoControl(deps: DemoControlDeps): void {
  if (!isDemo()) return
  const token = randomBytes(16).toString('hex')
  const server = createServer((req, res) => {
    void handle(req, res, token, deps).catch((err: Error) =>
      reply(res, 500, { error: err.message })
    )
  })
  server.on('error', (err) => hub.record('error', `Demo control could not start: ${err.message}`))
  server.listen(PORT, '127.0.0.1', () => {
    writeFileSync(dataPath('demo-control.json'), JSON.stringify({ port: PORT, token }))
    hub.record('session', `Demo control on 127.0.0.1:${PORT}`)
  })
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  deps: DemoControlDeps
): Promise<void> {
  if (req.headers['x-hearth-demo'] !== token) return reply(res, 403, { error: 'bad token' })
  const route = `${req.method} ${req.url}`
  const body = req.method === 'POST' ? await readBody(req) : {}

  switch (route) {
    case 'GET /state':
      return reply(res, 200, state())
    case 'POST /say':
      if (typeof body.text !== 'string' || !body.text.trim())
        return reply(res, 400, { error: 'text required' })
      deps.say(body.text.trim())
      return reply(res, 200, { ok: true })
    case 'POST /sensing':
      deps.requestSensing(body.on === true)
      return reply(res, 200, { ok: true })
    case 'POST /settings': {
      const patch = Object.fromEntries(
        Object.entries(body).filter(([k]) => SETTABLE.includes(k as keyof Settings))
      ) as Partial<Settings>
      return reply(res, 200, { settings: hub.updateSettings(patch) })
    }
    case 'POST /page':
      deps.showDashboard()
      hub.send({ type: 'showPage', page: String(body.page ?? 'today') })
      return reply(res, 200, { ok: true })
    case 'POST /dashboard': {
      const win = hub.window('dashboard')
      if (!win) return reply(res, 404, { error: 'no dashboard window' })
      if (body.bounds && typeof body.bounds === 'object')
        win.setBounds(body.bounds as Electron.Rectangle)
      if (body.show === true) deps.showDashboard()
      if (body.minimize === true) win.minimize()
      return reply(res, 200, { bounds: win.getBounds() })
    }
    case 'POST /pill': {
      const win = hub.window('pill')
      if (!win) return reply(res, 404, { error: 'no widget window' })
      const { width, height } = win.getBounds()
      win.setBounds({ x: Number(body.x), y: Number(body.y), width, height })
      return reply(res, 200, { bounds: win.getBounds() })
    }
    case 'POST /clearLog':
      hub.clearLog()
      return reply(res, 200, { ok: true })
    default:
      return reply(res, 404, { error: `no route ${route}` })
  }
}

function state(): Record<string, unknown> {
  const pill = hub.window('pill')
  const dashboard = hub.window('dashboard')
  const display = screen.getPrimaryDisplay()
  return {
    now: Date.now(),
    mood: hub.mood,
    activity: hub.activity,
    listenMode: hub.listenMode,
    notice: hub.notice,
    lastReply: hub.lastReply,
    partialTranscript: hub.partialTranscript,
    vitals: {
      ...vitals.describe(),
      validationHint: hub.vitals.validationHint,
      pausedAway: hub.vitals.pausedAway,
      expression: hub.vitals.expression?.label ?? null
    },
    reminders: hub.reminders,
    settings: hub.settings,
    log: hub.log.slice(-25),
    display: {
      scaleFactor: display.scaleFactor,
      bounds: display.bounds,
      workArea: display.workArea
    },
    windows: {
      pill: pill?.getBounds() ?? null,
      dashboard: dashboard
        ? {
            bounds: dashboard.getBounds(),
            visible: dashboard.isVisible(),
            minimized: dashboard.isMinimized()
          }
        : null
    }
  }
}

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
      if (raw.length > MAX_BODY) reject(new Error('body too large'))
    })
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Body) : {})
      } catch {
        reject(new Error('body is not JSON'))
      }
    })
    req.on('error', reject)
  })
}

function reply(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}
