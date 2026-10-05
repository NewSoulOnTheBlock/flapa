/** off: no trades at all. live: real trades, inside the limits. */
export type TradeMode = 'off' | 'live'

/** Where a trade idea came from. */
export type TradeSource = 'own' | 'copy' | 'person' | 'exit'

/** The hard limits. Code enforces them; the agent cannot argue past them. */
export type TradeLimits = {
  /** One buy, in BNB. The helper has its own cap on top (FLAPA_TRADER_MAX_BNB). */
  maxPerTradeBnb: number
  /** All buys in one local day, in BNB. */
  maxDailyBnb: number
  /** Stop buying for the day once realized losses reach this, in BNB. */
  maxDailyLossBnb: number
  maxOpen: number
  /** The PancakeSwap v2 WBNB pool must hold at least this much, in USD. */
  minLiquidityUsd: number
  takeProfitPct: number
  stopLossPct: number
  slippagePct: number
  /** No second buy of the same token within this many minutes. */
  cooldownMin: number
}

export type Position = {
  token: string
  symbol: string
  /** Raw token units, as a decimal string (bigger than a double holds). */
  amountWei: string
  decimals: number
  costBnb: number
  /** BNB per whole token at entry. */
  entryPrice: number
  /** The best price seen since entry. */
  peakPrice: number
  /** The latest price seen, for the tab's PnL. */
  lastPrice: number
  /** Half was sold at the take-profit; the rest now rides a trailing stop. */
  tookProfit?: boolean
  openedAt: number
  source: TradeSource
  thesis: string
}

export type TradeRecord = {
  at: number
  side: 'buy' | 'sell'
  token: string
  symbol: string
  bnb: number
  source: TradeSource
  why: string
  hash?: string
  /** Realized PnL in BNB, on a sell. */
  pnlBnb?: number
  /** Set when it did not go through. */
  error?: string
}

/** One local day's books. */
export type TradeDay = { day: string; spentBnb: number; realizedBnb: number }

/** BNB Chain buys by fomo's top traders, by token. */
export type CopySignal = {
  token: string
  traders: string[]
  usd: number
  lastAt: number
}

declare module 'claude-code' {
  interface PluginState {
    trader: {
      mode: TradeMode
      positions: Position[]
      trades: TradeRecord[]
      day: TradeDay
      signals: CopySignal[]
      status: string
    }
  }
}
