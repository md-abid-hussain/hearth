// Checks Claude Code session transcripts for leaked secrets and personal details, and writes
// cleaned copies for DEV's optional "Agent Session" upload.
//
//   node tools/agent-session.mjs scan  [file.jsonl ...]   report what would leak (masked)
//   node tools/agent-session.mjs clean [file.jsonl ...]   write agent-session/<name>.clean.jsonl
//
// With no files, it uses every session of this project in ~/.claude/projects. It looks for the
// exact values in the .env files Hearth reads, common API-key shapes, email addresses, and
// screenshots (which can show anything on screen). Cleaning replaces each with a [REDACTED ...]
// marker or "[screenshot removed]", then scans the result again.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = join(root, '..')
const PROJECT_DIR = join(homedir(), '.claude', 'projects', 'C--Users-abid1-Desktop-presage-dev-to')
const OUT_DIR = join(root, 'agent-session')

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

/** Redacts every string in a parsed transcript line, and swaps images for a text note. */
function redact(node, secrets) {
  if (typeof node === 'string') {
    let s = node
    for (const [name, value] of secrets) s = s.split(value).join(`[REDACTED ${name}]`)
    for (const [kind, re] of PATTERNS) s = s.replace(re, `[REDACTED ${kind}]`)
    s = s.replace(EMAIL, (m) => (HARMLESS_EMAIL.test(m) ? m : '[REDACTED email]'))
    return s
  }
  if (Array.isArray(node)) return node.map((n) => redact(n, secrets))
  if (node && typeof node === 'object') {
    if (node.type === 'image') return { type: 'text', text: '[screenshot removed]' }
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, redact(v, secrets)]))
  }
  return node
}

function clean(file, secrets) {
  mkdirSync(OUT_DIR, { recursive: true })
  const lines = readFileSync(file, 'utf8').split('\n')
  const out = lines.map((line) => {
    if (!line.trim()) return line
    try {
      return JSON.stringify(redact(JSON.parse(line), secrets))
    } catch {
      return JSON.stringify({ type: 'note', text: '[line removed: not valid JSON]' })
    }
  })
  const target = join(OUT_DIR, basename(file).replace(/\.jsonl$/, '.clean.jsonl'))
  writeFileSync(target, out.join('\n'))
  console.log(`\nwrote ${target}`)
  return target
}

const [cmd, ...args] = process.argv.slice(2)
const secrets = envSecrets()
console.log(`.env values checked: ${[...secrets.keys()].join(', ') || 'none found'}`)
if (cmd === 'scan') for (const f of sessionFiles(args)) scan(f, secrets)
else if (cmd === 'clean') {
  let left = 0
  for (const f of sessionFiles(args)) left += scan(clean(f, secrets), secrets)
  console.log(left ? '\nSomething is still left above; check it before posting.' : '\nClean copies have nothing left to redact.')
} else console.log('usage: node tools/agent-session.mjs scan|clean [file.jsonl ...]')
