const isPlainObject = (x: unknown): x is Record<string, unknown> => {
  if (typeof x !== 'object' || x === null) return false
  const proto = Object.getPrototypeOf(x)
  return proto === Object.prototype || proto === null
}

/**
 * Returns `prev` wherever `next` holds the same data, and otherwise `next` rebuilt around the
 * unchanged parts of `prev`. Every state push is a fresh copy from the main process, about 12 a
 * second while Hearth's reply streams in; keeping what did not change identical lets memoized
 * components and selectors skip it.
 */
export function share<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev
  if (prev instanceof Date && next instanceof Date)
    return prev.getTime() === next.getTime() ? prev : next
  if (Array.isArray(prev) && Array.isArray(next)) {
    // Lists such as the log drop their oldest entry as they grow, so match by id where there is one.
    let byId: Map<unknown, unknown> | null = null
    let same = prev.length === next.length
    const out = next.map((item: unknown, i) => {
      let old: unknown = prev[i]
      const id = isPlainObject(item) ? item.id : undefined
      if (id !== undefined && !(isPlainObject(old) && old.id === id)) {
        byId ??= new Map(prev.map((p: unknown) => [isPlainObject(p) ? p.id : undefined, p]))
        old = byId.get(id)
      }
      const kept = share(old, item)
      if (kept !== prev[i]) same = false
      return kept
    })
    return (same ? prev : out) as T
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = Object.keys(next)
    let same = keys.length === Object.keys(prev).length
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      out[key] = share(prev[key], next[key])
      if (out[key] !== prev[key] || !(key in prev)) same = false
    }
    return (same ? prev : out) as T
  }
  return next
}
