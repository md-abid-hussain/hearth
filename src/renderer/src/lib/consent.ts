const listeners = new Set<() => void>()

/** Opens the consent screen in this window, for example from the Privacy page. */
export function reviewConsent(): void {
  listeners.forEach((l) => l())
}

export function onReviewConsent(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
