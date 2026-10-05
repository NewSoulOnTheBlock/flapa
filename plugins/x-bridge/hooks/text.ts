// X's weighted post length (twitter-text v3 defaults): most characters count
// 1, wide ones (CJK, emoji) count 2, every URL counts 23; the limit is 280.

export const MAX_WEIGHT = 280
const URL_WEIGHT = 23
const URL = /https?:\/\/[^\s]+/g
const LIGHT: readonly [number, number][] = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]]

export function weightedLength(text: string): number {
  let total = 0
  const rest = text.normalize('NFC').replace(URL, () => {
    total += URL_WEIGHT
    return ''
  })
  for (const ch of rest) {
    const cp = ch.codePointAt(0)!
    total += LIGHT.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2
  }
  return total
}
