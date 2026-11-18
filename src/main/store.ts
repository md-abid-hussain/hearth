import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { basename, dirname, join } from 'path'
import { randomUUID } from 'crypto'

let root = ''

/** Tries for a file that Windows reports as busy, usually an antivirus or indexer scanning it. */
const RENAME_TRIES = 5
const RENAME_RETRY_MS = 25

/** Problems found before anyone could hear about them, such as a settings file that would not parse. */
const pending: string[] = []
let report: ((message: string) => void) | null = null

/** Sends store problems, including any found already, to the timeline. */
export function reportStoreProblems(to: (message: string) => void): void {
  report = to
  for (const message of pending.splice(0)) to(message)
}

function problem(message: string): void {
  console.warn(`[hearth] ${message}`)
  if (report) report(message)
  else pending.push(message)
}

export function initStore(dataDir: string): void {
  root = dataDir
  mkdirSync(root, { recursive: true })
}

export function dataPath(name: string): string {
  return join(root, name)
}

export function newId(): string {
  return randomUUID()
}

/**
 * A file that exists but does not parse is moved aside as name.corrupt-<time> rather than being
 * overwritten by the next save: composio.json, for one, holds the id that Google sign-ins are
 * linked to, and the copy is the only way back to them.
 */
export function readJson<T>(name: string, fallback: T): T {
  const file = dataPath(name)
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (err) {
    const aside = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      renameSync(file, aside)
    } catch {
      try {
        copyFileSync(file, aside)
      } catch {
        problem(
          `${name} could not be read (${(err as Error).message}) or set aside; using defaults`
        )
        return fallback
      }
    }
    problem(
      `${name} could not be read (${(err as Error).message}), so Hearth started it afresh. The old file is kept as ${basename(aside)}.`
    )
    return fallback
  }
}

const pause = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Writes the whole file or nothing: the text goes to a temporary file in the same folder, is
 * flushed to disk, and then replaces the target in one rename. A crash mid-write leaves the old
 * file as it was instead of a half-written one.
 */
function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, text, { flush: true })
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(temp, file)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const busy = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
      if (busy && attempt < RENAME_TRIES) {
        pause(RENAME_RETRY_MS)
        continue
      }
      rmSync(temp, { force: true })
      throw err
    }
  }
}

export function writeJson(name: string, value: unknown): void {
  writeAtomic(dataPath(name), JSON.stringify(value, null, 2))
}

export function appendJsonl(name: string, value: unknown): void {
  appendFileSync(dataPath(name), JSON.stringify(value) + '\n')
}

export function readJsonl<T>(name: string): T[] {
  const file = dataPath(name)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T]
      } catch {
        return []
      }
    })
}

export function writeJsonl(name: string, values: unknown[]): void {
  writeAtomic(
    dataPath(name),
    values.map((v) => JSON.stringify(v)).join('\n') + (values.length ? '\n' : '')
  )
}

export function wipeData(): void {
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
}
