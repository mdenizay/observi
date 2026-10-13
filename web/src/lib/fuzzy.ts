/**
 * Tiny fuzzy matcher: every query character must appear in order. Higher score =
 * better (prefix and consecutive matches win). Returns -1 when there is no match.
 */
export function fuzzyScore(query: string, text: string, locale?: string): number {
  const q = query.trim().toLocaleLowerCase(locale)
  if (!q) return 0
  const s = text.toLocaleLowerCase(locale)
  const direct = s.indexOf(q)
  if (direct >= 0) return 1000 - direct * 2 - (s.length - q.length) * 0.1
  let score = 0
  let last = -1
  let si = 0
  for (const ch of q) {
    if (ch === ' ') continue
    const i = s.indexOf(ch, si)
    if (i < 0) return -1
    score += i === last + 1 ? 8 : 1
    if (i === 0 || /[\s./:_-]/.test(s[i - 1])) score += 4
    last = i
    si = i + 1
  }
  return score
}
