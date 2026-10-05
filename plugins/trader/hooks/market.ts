// Market data from DexScreener's keyless API, pure: picking the pool trades go through.
export const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'

export type Market = {
  token: string
  symbol: string
  name: string
  pair: string
  /** BNB per whole token, in the PancakeSwap v2 WBNB pool. */
  priceBnb: number
  priceUsd: number
  liquidityUsd: number
  volume24hUsd: number
  change1hPct: number
  change24hPct: number
  buys24h: number
  sells24h: number
  marketCapUsd: number
  ageHours: number
}

export function dexUrl(token: string): string {
  return `https://api.dexscreener.com/latest/dex/tokens/${token}`
}

/** The token's PancakeSwap v2 pool against WBNB, the deepest if several: the only pool trades use. */
export function pickPool(json: any, token: string, now: number): Market | null {
  const t = token.toLowerCase()
  const pools = (json?.pairs ?? []).filter((p: any) =>
    p.chainId === 'bsc' && p.dexId === 'pancakeswap' && (p.labels ?? []).includes('v2') &&
    p.baseToken?.address?.toLowerCase() === t && p.quoteToken?.address?.toLowerCase() === WBNB,
  )
  const p = pools.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]
  if (!p) return null
  return {
    token: p.baseToken.address,
    symbol: p.baseToken.symbol ?? '?',
    name: p.baseToken.name ?? '',
    pair: p.pairAddress,
    priceBnb: Number(p.priceNative) || 0,
    priceUsd: Number(p.priceUsd) || 0,
    liquidityUsd: p.liquidity?.usd ?? 0,
    volume24hUsd: p.volume?.h24 ?? 0,
    change1hPct: p.priceChange?.h1 ?? 0,
    change24hPct: p.priceChange?.h24 ?? 0,
    buys24h: p.txns?.h24?.buys ?? 0,
    sells24h: p.txns?.h24?.sells ?? 0,
    marketCapUsd: p.marketCap ?? p.fdv ?? 0,
    ageHours: p.pairCreatedAt ? Math.max(0, (now - p.pairCreatedAt) / 3_600_000) : 0,
  }
}

export function marketLine(m: Market): string {
  const k = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`)
  return `$${m.symbol}: mc ${k(m.marketCapUsd)} · liq ${k(m.liquidityUsd)} · vol24h ${k(m.volume24hUsd)} · ` +
    `1h ${m.change1hPct >= 0 ? '+' : ''}${m.change1hPct}% · 24h ${m.change24hPct >= 0 ? '+' : ''}${m.change24hPct}% · ` +
    `${m.buys24h} buys/${m.sells24h} sells · pool age ${m.ageHours < 48 ? `${m.ageHours.toFixed(0)}h` : `${(m.ageHours / 24).toFixed(0)}d`}`
}
