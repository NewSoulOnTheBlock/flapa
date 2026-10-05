// When the once-a-day post is due. Pure, on local time.

export type DailyConfig = {
  isOn: boolean
  /** Local hour (0-23) from which the day's post may go out. */
  hour: number
  /** The local day (YYYY-MM-DD) of the last post: never two in one day. */
  lastDay?: string
}

export const DAILY_DEFAULT: DailyConfig = { isOn: false, hour: 17 }

export function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function isDue(cfg: DailyConfig, now: Date): boolean {
  return cfg.isOn && now.getHours() >= cfg.hour && cfg.lastDay !== dayKey(now)
}
