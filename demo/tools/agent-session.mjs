// Checks agent session transcripts for leaked secrets and personal details, and writes cleaned
// copies for DEV's optional "Agent Session" upload.
//
//   node tools/agent-session.mjs scan  [file.jsonl ...]   report what would leak (masked)
//   node tools/agent-session.mjs clean [file.jsonl ...]   write agent-session/<name>.clean.jsonl
//   node tools/agent-session.mjs clean --slim            the same, with long texts trimmed and the
//                                                        app's bookkeeping lines dropped
//   node tools/agent-session.mjs merge                   Cursor's transcript of this project, then
//                                                        the Claude Code session, as one Claude Code
//                                                        file under 10 MB: agent-session/hearth-build.jsonl
//
// With no files, it uses every Claude Code session of this project in ~/.claude/projects. It looks
// for the exact values in the .env files Hearth reads, common API-key shapes, email addresses, and
// screenshots (which can show anything on screen). Cleaning replaces each with a [REDACTED ...]
// marker or "[screenshot removed]", then scans the result again.
//
// DEV's parser reads Claude Code, Codex, Gemini CLI, Pi and Copilot CLI sessions, not Cursor's, so
// the merge rewrites Cursor's lines in Claude Code's format. Uploads over 10 MB have been reported
// to fail, so the merge trims long texts harder until it fits.
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = join(root, '..')
const PROJECT_DIR = join(homedir(), '.claude', 'projects', 'C--Users-abid1-Desktop-presage-dev-to')
const CURSOR_DIR = join(homedir(), '.cursor', 'projects', 'c-Users-abid1-Desktop-presage-dev-to', 'agent-transcripts')
const OUT_DIR = join(root, 'agent-session')
const MERGED = join(OUT_DIR, 'hearth-build.jsonl')
/** A little under the 10 MB that uploads have been reported to fail above. */
const MAX_UPLOAD_BYTES = 9_500_000

/** Every value from the .env files Hearth reads, by variable name; short or boolean ones skipped. */
function envSecrets() {
  const found = new Map()
  for (const file of [join(repo, '.env'), join(repo, 'wisp', '.env')]) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n#]*)"?/.exec(line)
      if (m && m[2].trim().length >= 12) found.set(m[1], m[2].trim())
    }
  }
  return found
}

const PATTERNS = [
  // Not preceded by a letter, so "desk-companion" or "risk-based" are not keys.
  ['openai-key', /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/g],
  ['composio-key', /\b(?:ak|ck)_[A-Za-z0-9_-]{10,}/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['aws-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['bearer', /Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/g],
  // A literal value, not code that reads one (apiKey: process.env.X, token = this.x).
  ['assignment', /\b(?:api[_-]?key|secret|token|password)\b["']?\s*[:=]\s*["']?(?!process\.env|env\.|this\.|config\.)[A-Za-z0-9_\-./+]{20,}/gi]
]
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
/** Addresses that are not anyone's: examples, placeholders and package scopes. */
const HARMLESS_EMAIL = /@(example\.(com|org)|company\.com|users\.noreply\.github\.com)$|^git@|^noreply@/i

const mask = (s) => `${s.slice(0, 4)}… (${s.length} chars)`

function sessionFiles(args) {
  if (args.length) return args
  return readdirSync(PROJECT_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(PROJECT_DIR, f))
}

/** Every finding in a text, as [kind, value]. */
function findings(text, secrets) {
  const out = []
  for (const [name, value] of secrets) {
    let at = text.indexOf(value)
    while (at !== -1) {
      out.push([`.env ${name}`, value])
      at = text.indexOf(value, at + value.length)
    }
  }
  for (const [kind, re] of PATTERNS) for (const m of text.matchAll(re)) out.push([kind, m[0]])
  for (const m of text.matchAll(EMAIL)) if (!HARMLESS_EMAIL.test(m[0])) out.push(['email', m[0]])
  return out
}

function scan(file, secrets) {
  const text = readFileSync(file, 'utf8')
  const images = (text.match(/"type":\s*"image"/g) ?? []).length
  const byKind = new Map()
  for (const [kind, value] of findings(text, secrets)) {
    const entry = byKind.get(kind) ?? { count: 0, values: new Set() }
    entry.count++
    entry.values.add(value)
    byKind.set(kind, entry)
  }
  console.log(`\n${basename(file)} (${(text.length / 1e6).toFixed(1)} MB)`)
  if (!byKind.size && !images) console.log('  nothing found')
  for (const [kind, { count, values }] of byKind)
    console.log(`  ${kind}: ${count} hit(s), ${values.size} distinct: ${[...values].slice(0, 4).map(mask).join(', ')}`)
  if (images) console.log(`  screenshots/images: ${images}`)
  return byKind.size + images
}

/** How long a text may stay when slimming (a big tool output, a whole file keeps only its start). */
const SLIM_LIMITS = [3_000, 2_000, 1_200, 800, 500]
/** With --slim, only the conversation itself is kept: the app's own bookkeeping lines go. */
const SLIM_TYPES = new Set(['user', 'assistant', 'system', 'summary'])
/** With --slim, fields that repeat what the message already holds, or describe the app, go too. */
const SLIM_DROP = ['toolUseResult', 'wireToolInputs', 'serverClassifierContext', 'snapshot']

/**
 * Redacts every string in a parsed transcript line, and swaps images for a text note. With a
 * `limit`, a longer string keeps only its start.
 */
function redact(node, secrets, limit) {
  if (typeof node === 'string') {
    let s = node
    for (const [name, value] of secrets) s = s.split(value).join(`[REDACTED ${name}]`)
    for (const [kind, re] of PATTERNS) s = s.replace(re, `[REDACTED ${kind}]`)
    s = s.replace(EMAIL, (m) => (HARMLESS_EMAIL.test(m) ? m : '[REDACTED email]'))
    if (limit && s.length > limit) s = `${s.slice(0, limit)}\n[… ${s.length - limit} more characters trimmed for upload]`
    return s
  }
  if (Array.isArray(node)) return node.map((n) => redact(n, secrets, limit))
  if (node && typeof node === 'object') {
    if (node.type === 'image') return { type: 'text', text: '[screenshot removed]' }
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, redact(v, secrets, limit)]))
  }
  return node
}

/** A Claude Code transcript's lines; slimmed, only the conversation, still linked end to end. */
function claudeRows(file, slim) {
  /** A dropped line's id, mapped to its own parent, so the thread stays linked past it. */
  const skipped = new Map()
  const parentOf = (id) => {
    while (id && skipped.has(id)) id = skipped.get(id)
    return id
  }
  const rows = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      if (!slim) rows.push({ type: 'note', text: '[line removed: not valid JSON]' })
      continue
    }
    if (slim) {
      if (!SLIM_TYPES.has(entry.type)) {
        if (entry.uuid) skipped.set(entry.uuid, entry.parentUuid ?? null)
        continue
      }
      if (entry.parentUuid) entry.parentUuid = parentOf(entry.parentUuid)
      for (const key of SLIM_DROP) delete entry[key]
    }
    rows.push(entry)
  }
  return rows
}

const toJsonl = (rows, secrets, limit) => rows.map((r) => JSON.stringify(redact(r, secrets, limit))).join('\n')

function clean(file, secrets, slim) {
  mkdirSync(OUT_DIR, { recursive: true })
  const target = join(OUT_DIR, basename(file).replace(/\.jsonl$/, slim ? '.slim.jsonl' : '.clean.jsonl'))
  writeFileSync(target, toJsonl(claudeRows(file, slim), secrets, slim ? SLIM_LIMITS[0] : 0))
  console.log(`\nwrote ${target}`)
  return target
}

/** Cursor's "<timestamp>Monday, Nov 16, 2026, 7:09 PM (UTC+5:30)</timestamp>", as epoch ms. */
function cursorTime(text) {
  const m = /<timestamp>\w+, (\w{3}) (\d+), (\d{4}), (\d+):(\d+) (AM|PM) \(UTC([+-])(\d+):(\d+)\)<\/timestamp>/.exec(text)
  if (!m) return null
  const month = 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(m[1]) / 3
  const hour = (Number(m[4]) % 12) + (m[6] === 'PM' ? 12 : 0)
  const offset = (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]))
  return Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5])) - offset * 60_000
}

/** A prompt Cursor writes itself when a background task ends; nobody typed it. */
const CURSOR_AUTO = /^Briefly inform the user about the task result/

/**
 * Cursor's agent transcript as Claude Code lines, stopping at the first prompt from `until` on.
 * Cursor keeps the prompts, replies and tool calls, but not tool results or reply times, so each
 * reply is dated a second after the line before it. Lines Cursor adds on its own (timestamps
 * alone, task-finished prompts, its subagent list) are left out.
 */
function cursorRows(file, until) {
  const rows = []
  let at = null
  let calls = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const parts = entry.message?.content ?? []
    if (entry.role === 'user') {
      const text = parts.map((p) => p.text ?? '').join('\n')
      const time = cursorTime(text)
      if (time && time >= until) break
      // Cursor dates prompts to the minute, so a burst of replies can run past the next one.
      if (time) at = Math.max(time, (at ?? 0) + 1000)
      const query = /<user_query>([\s\S]*?)<\/user_query>/.exec(text)?.[1].trim()
      if (!query || CURSOR_AUTO.test(query)) continue
      const said = text.includes('<image_files>') ? `[screenshot removed]\n${query}` : query
      rows.push({ type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'text', text: said }] } })
    } else if (entry.role === 'assistant' && at) {
      at += 1000
      const content = parts.map((p) =>
        p.type === 'tool_use' ? { type: 'tool_use', id: `toolu_cursor_${++calls}`, name: p.name, input: p.input ?? {} } : p
      )
      rows.push({
        type: 'assistant',
        timestamp: at,
        message: { id: `msg_cursor_${rows.length}`, type: 'message', role: 'assistant', model: 'cursor', content, stop_reason: null, stop_sequence: null }
      })
    }
  }
  return rows
}

const firstTime = (rows) => Date.parse(rows.find((r) => r.timestamp)?.timestamp ?? '') || Infinity

/**
 * The project's Claude Code sessions, oldest first, minus any another one already holds (a resumed
 * session carries the whole earlier one).
 */
function claudeSessions() {
  const sessions = sessionFiles([]).map((file) => {
    const rows = claudeRows(file, true)
    return { file, rows, ids: new Set(rows.map((r) => r.uuid).filter(Boolean)) }
  })
  const held = (s, t) => t !== s && t.ids.size > s.ids.size && [...s.ids].filter((id) => t.ids.has(id)).length >= s.ids.size * 0.95
  return sessions.filter((s) => !sessions.some((t) => held(s, t))).sort((a, b) => firstTime(a.rows) - firstTime(b.rows))
}

/**
 * Cursor's half of the build (up to where the Claude Code half starts), then the Claude Code
 * session, as one Claude Code session file, linked end to end.
 */
function merge(secrets) {
  const claude = claudeSessions()
  if (!claude.length) throw new Error(`no Claude Code sessions in ${PROJECT_DIR}`)
  const start = firstTime(claude[0].rows)
  const cursorFiles = existsSync(CURSOR_DIR)
    ? readdirSync(CURSOR_DIR)
        .map((id) => join(CURSOR_DIR, id, `${id}.jsonl`))
        .filter(existsSync)
    : []
  const cursor = cursorFiles.map((file) => cursorRows(file, start)).sort((a, b) => (a[0]?.timestamp ?? 0) - (b[0]?.timestamp ?? 0))

  const sample = claude[0].rows.find((r) => r.cwd && r.sessionId)
  const base = { isSidechain: false, userType: 'external', cwd: sample.cwd, sessionId: sample.sessionId, version: sample.version, gitBranch: sample.gitBranch }
  const note = (content, timestamp) => ({ type: 'system', subtype: 'informational', level: 'info', content, timestamp })
  const cursorPart = cursor.flat()
  const made = [
    ...(cursorPart.length
      ? [
          note("Part 1: the first half of Hearth, built in Cursor. Converted from Cursor's transcript, which keeps prompts, replies and tool calls but not tool results.", cursorPart[0].timestamp - 1000),
          ...cursorPart,
          note('Part 2: the build continues in Claude Code.', start - 1000)
        ]
      : [])
  ]
  let previous = null
  for (const row of made) {
    Object.assign(row, base, { parentUuid: previous, uuid: randomUUID(), timestamp: new Date(row.timestamp).toISOString() })
    previous = row.uuid
  }
  const rows = [...made]
  for (const session of claude) {
    const first = session.rows.find((r) => r.uuid)
    if (first && !first.parentUuid) first.parentUuid = previous
    for (const row of session.rows) if (row.sessionId) row.sessionId = base.sessionId
    rows.push(...session.rows)
    previous = session.rows.findLast((r) => r.uuid)?.uuid ?? previous
  }

  mkdirSync(OUT_DIR, { recursive: true })
  let text = ''
  let limit = 0
  for (limit of SLIM_LIMITS) {
    text = toJsonl(rows, secrets, limit)
    if (Buffer.byteLength(text) <= MAX_UPLOAD_BYTES) break
  }
  writeFileSync(MERGED, text)
  const mb = (Buffer.byteLength(text) / 1e6).toFixed(1)
  console.log(`\nCursor: ${cursorFiles.length} transcript(s), ${cursorPart.length} lines, up to ${new Date(start).toISOString()}`)
  console.log(`Claude Code: ${claude.map((s) => basename(s.file)).join(', ')} (${rows.length - made.length} lines)`)
  console.log(`wrote ${MERGED}: ${mb} MB, texts kept to ${limit} characters`)
  if (Buffer.byteLength(text) > MAX_UPLOAD_BYTES) console.log('  still over 10 MB even at the tightest trim')
  return MERGED
}

const [cmd, ...rest] = process.argv.slice(2)
const slim = rest.includes('--slim')
const args = rest.filter((a) => a !== '--slim')
const secrets = envSecrets()
console.log(`.env values checked: ${[...secrets.keys()].join(', ') || 'none found'}`)
if (cmd === 'scan') for (const f of sessionFiles(args)) scan(f, secrets)
else if (cmd === 'clean' || cmd === 'merge') {
  let left = 0
  if (cmd === 'merge') left = scan(merge(secrets), secrets)
  else for (const f of sessionFiles(args)) left += scan(clean(f, secrets, slim), secrets)
  console.log(left ? '\nSomething is still left above; check it before posting.' : '\nClean copies have nothing left to redact.')
} else console.log('usage: node tools/agent-session.mjs scan|clean [--slim] [file.jsonl ...] | merge')
