// The posting calendar, pure: a few posting times a day, placed at the hours her numbers say work best.
// A slot that was missed by more than two hours is skipped, not posted late.

/** Used until her own numbers say otherwise: morning, lunch, evening, then fill-ins. */
export const DEFAULT_SLOTS = [9, 13, 20, 11, 17, 22]
export const SLOT_GRACE_MS = 2 * 3_600_000

/** Posting hours for the day: the best hour blocks first (each block's second hour), then defaults, 2h+ apart. */
export function slotHours(bestBlocks: readonly string[], perDay: number): number[] {
  const fromData = bestBlocks.map(b => Number(b.slice(0, 2)) + 1).filter(h => h >= 0 && h <= 23)
  const out: number[] = []
  for (const h of [...fromData, ...DEFAULT_SLOTS]) {
    if (out.length >= perDay) break
    if (out.every(o => Math.abs(o - h) >= 2 && Math.abs(o - h) <= 22)) out.push(h)
  }
  return out.sort((a, b) => a - b)
}

const at = (base: number, dayOffset: number, hour: number) => { const d = new Date(base); d.setDate(d.getDate() + dayOffset); d.setHours(hour, 0, 0, 0); return d.getTime() }

/** The most recent slot time at or before now (today's or yesterday's). */
export function lastSlot(now: number, hours: readonly number[]): number | undefined {
  const times = [-1, 0].flatMap(d => hours.map(h => at(now, d, h))).filter(t => t <= now)
  return times.length ? Math.max(...times) : undefined
}

export function nextSlots(now: number, hours: readonly number[], count = 6): number[] {
  return [0, 1, 2].flatMap(d => hours.map(h => at(now, d, h))).filter(t => t > now).sort((a, b) => a - b).slice(0, count)
}

/** Due when the latest slot has passed, nothing went out since it, it is not stale, and no try is in cooldown. */
export function slotDue(now: number, hours: readonly number[], lastPostAt: number, lastTryAt: number, retryMs: number): boolean {
  const s = lastSlot(now, hours)
  return s !== undefined && lastPostAt < s && now - s <= SLOT_GRACE_MS && now - lastTryAt >= retryMs
}
