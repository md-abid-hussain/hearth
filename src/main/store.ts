import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'

let root = ''

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

export function readJson<T>(name: string, fallback: T): T {
  const file = dataPath(name)
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeJson(name: string, value: unknown): void {
  const file = dataPath(name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2))
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
  writeFileSync(
    dataPath(name),
    values.map((v) => JSON.stringify(v)).join('\n') + (values.length ? '\n' : '')
  )
}

export function wipeData(): void {
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
}
