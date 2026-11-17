/** Flattens markdown to one line of plain prose, for previews that are cut short. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

export function preview(markdown: string, max: number): string {
  const text = plainText(markdown)
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}

/** Emoji and their variation selectors, which read badly inside one-line summaries. */
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu

const clean = (s: string): string => plainText(s).replace(EMOJI, '').replace(/\s+/g, ' ').trim()

export interface InsightSummary {
  headline: string
  metrics: { name: string; value: string; note: string }[]
}

/**
 * A one-glance view of an insight written in markdown, without an LLM: the first sentence of
 * prose (not a heading, table or rule) and the rows of its first table.
 */
export function summarizeInsight(markdown: string, max = 160): InsightSummary {
  const lines = markdown.split('\n').map((l) => l.trim())
  const metrics: InsightSummary['metrics'] = []
  let header = true
  for (const line of lines) {
    if (!line.startsWith('|')) {
      if (metrics.length) break
      continue
    }
    if (/^\|?[\s:|-]+$/.test(line)) continue
    const cells = line.split('|').slice(1, -1).map(clean)
    if (header) {
      header = false
      continue
    }
    if (cells.length >= 2 && cells[0]) {
      metrics.push({ name: cells[0], value: cells[1], note: cells[2] ?? '' })
    }
  }
  // Skip headings, table rows, rules, quotes and lead-ins that end in a colon.
  const prose = lines.find(
    (l) =>
      l &&
      !/^(#{1,6}\s|\||[-*_]{3,}$|>)/.test(l) &&
      !/:\s*$/.test(clean(l)) &&
      clean(l).split(' ').length > 3
  )
  const heading = lines.find((l) => /^#{1,6}\s/.test(l))
  let headline = clean(prose ?? heading ?? markdown)
  const sentence = /^(.+?[.!?])(\s|$)/.exec(headline)
  if (sentence && sentence[1].length >= 30) headline = sentence[1]
  if (headline.length > max) headline = `${headline.slice(0, max - 1).trimEnd()}…`
  return { headline, metrics }
}
