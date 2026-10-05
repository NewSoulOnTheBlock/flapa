export type FomoWindow = '24h' | '7d' | '30d' | 'all'

/** One leaderboard row, with the trader's biggest winner by position PnL. */
export type FomoRow = {
  rank: number
  handle: string
  pnlUsd: number
  volumeUsd: number
  trades: number
  top: { symbol: string; address: string; pnlUsd: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    fomo: {
      window: FomoWindow
      board: FomoRow[]
      updatedAt: number
      status: string
    }
  }
}
