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
