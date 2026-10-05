export type FomoWindow = '24h' | '7d' | '30d' | 'all'

/** One leaderboard row, with the trader's biggest winner by position PnL. */
export type FomoRow = {
  rank: number
  handle: string
  pnlUsd: number
  volumeUsd: number
  trades: number
  top: { symbol: string; address: string; pnlUsd: number } | null
  /** The X handle their fomo profile links, if any: the only handle ever @-tagged. */
  x?: string | null
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
