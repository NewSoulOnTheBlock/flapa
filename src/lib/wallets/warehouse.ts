// The wallet warehouse: every trade, token and candle she has seen, in one SQLite file next to her state.
// Nothing is deleted except old candles: dead and faded wallets stay, so rankings are not built only from
// the wallets that happened to survive.
import { Database } from 'bun:sqlite'
import { WBNB } from '../market'

export type Trade = { tx: string; wallet: string; token: string; pool: string; at: number; block: number; side: 'buy' | 'sell'; bnb: number; usd: number; priceUsd: number; amount: number }
export type Token = { token: string; pool: string; symbol: string; launchedAt: number; fdvUsd: number; priceUsd: number; liquidityUsd: number; updatedAt: number }
export type Candle = { ts: number; o: number; h: number; l: number; c: number; v: number }
export type Signal = { id?: number; at: number; wallet: string; token: string; kind: string; score: number; data: any; outcome?: any }

export class Warehouse {
  readonly db: Database
  constructor(path: string) {
    this.db = new Database(path, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, pool TEXT, symbol TEXT, launched_at INTEGER, fdv_usd REAL, price_usd REAL, liquidity_usd REAL, updated_at INTEGER);
      CREATE TABLE IF NOT EXISTS trades (tx TEXT, wallet TEXT, token TEXT, pool TEXT, at INTEGER, block INTEGER, side TEXT, bnb REAL, usd REAL, price_usd REAL, amount REAL, PRIMARY KEY (tx, wallet, token, side));
      CREATE INDEX IF NOT EXISTS trades_wallet ON trades (wallet, at);
      CREATE INDEX IF NOT EXISTS trades_token ON trades (token, at);
      CREATE TABLE IF NOT EXISTS candles (pool TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL, PRIMARY KEY (pool, tf, ts));
      CREATE TABLE IF NOT EXISTS wallets (wallet TEXT PRIMARY KEY, profile TEXT, score REAL, tier TEXT, class TEXT, updated_at INTEGER);
      CREATE TABLE IF NOT EXISTS signals (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, wallet TEXT, token TEXT, kind TEXT, score REAL, data TEXT, outcome TEXT);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    `)
  }

  upsertToken(t: Token) {
    this.db.query(`INSERT INTO tokens VALUES ($token,$pool,$symbol,$launched,$fdv,$price,$liq,$up)
      ON CONFLICT(token) DO UPDATE SET pool=$pool, symbol=$symbol, launched_at=MIN(launched_at,$launched), fdv_usd=$fdv, price_usd=$price, liquidity_usd=$liq, updated_at=$up`)
      .run({ $token: t.token, $pool: t.pool, $symbol: t.symbol, $launched: t.launchedAt, $fdv: t.fdvUsd, $price: t.priceUsd, $liq: t.liquidityUsd, $up: t.updatedAt })
  }

  addTrades(list: readonly Trade[]): number {
    const q = this.db.query(`INSERT OR IGNORE INTO trades VALUES ($tx,$wallet,$token,$pool,$at,$block,$side,$bnb,$usd,$price,$amount)`)
    let n = 0
    this.db.transaction(() => {
      for (const t of list) n += q.run({ $tx: t.tx, $wallet: t.wallet, $token: t.token, $pool: t.pool, $at: t.at, $block: t.block, $side: t.side, $bnb: t.bnb, $usd: t.usd, $price: t.priceUsd, $amount: t.amount }).changes
    })()
    return n
  }

  addCandles(pool: string, tf: string, list: readonly Candle[]) {
    const q = this.db.query(`INSERT OR REPLACE INTO candles VALUES ($pool,$tf,$ts,$o,$h,$l,$c,$v)`)
    this.db.transaction(() => { for (const c of list) q.run({ $pool: pool, $tf: tf, $ts: c.ts, $o: c.o, $h: c.h, $l: c.l, $c: c.c, $v: c.v }) })()
  }

  tokens(): Token[] {
    return this.db.query(`SELECT token, pool, symbol, launched_at AS launchedAt, fdv_usd AS fdvUsd, price_usd AS priceUsd, liquidity_usd AS liquidityUsd, updated_at AS updatedAt FROM tokens`).all() as Token[]
  }
  token(token: string): Token | undefined {
    return this.tokens().find(t => t.token === token.toLowerCase())
  }
  trades(where: { wallet?: string; token?: string; since?: number } = {}): Trade[] {
    const conds: string[] = [], args: Record<string, unknown> = {}
    if (where.wallet) { conds.push('wallet = $wallet'); args.$wallet = where.wallet.toLowerCase() }
    if (where.token) { conds.push('token = $token'); args.$token = where.token.toLowerCase() }
    if (where.since) { conds.push('at >= $since'); args.$since = where.since }
    return this.db.query(`SELECT tx, wallet, token, pool, at, block, side, bnb, usd, price_usd AS priceUsd, amount FROM trades ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY at`).all(args as any) as Trade[]
  }
  candles(pool: string, tf: string): Candle[] {
    return this.db.query(`SELECT ts, o, h, l, c, v FROM candles WHERE pool = $pool AND tf = $tf ORDER BY ts`).all({ $pool: pool, $tf: tf }) as Candle[]
  }
  counts() {
    const one = (sql: string) => (this.db.query(sql).get() as any).n as number
    return { trades: one('SELECT COUNT(*) n FROM trades'), wallets: one('SELECT COUNT(DISTINCT wallet) n FROM trades'), tokens: one('SELECT COUNT(*) n FROM tokens'), candles: one('SELECT COUNT(*) n FROM candles') }
  }
  saveProfiles(rows: readonly { wallet: string; profile: unknown; score: number; tier: string; cls: string }[]) {
    const q = this.db.query(`INSERT OR REPLACE INTO wallets VALUES ($w,$p,$s,$t,$c,$u)`)
    const now = Date.now()
    this.db.transaction(() => { for (const r of rows) q.run({ $w: r.wallet, $p: JSON.stringify(r.profile), $s: r.score, $t: r.tier, $c: r.cls, $u: now }) })()
  }
  profiles(tier?: string): any[] {
    const rows = (tier ? this.db.query('SELECT profile FROM wallets WHERE tier = $t ORDER BY score DESC').all({ $t: tier }) : this.db.query('SELECT profile FROM wallets ORDER BY score DESC').all()) as { profile: string }[]
    return rows.map(r => JSON.parse(r.profile))
  }
  profile(wallet: string): any | undefined {
    const r = this.db.query('SELECT profile FROM wallets WHERE wallet = $w').get({ $w: wallet.toLowerCase() }) as { profile: string } | null
    return r ? JSON.parse(r.profile) : undefined
  }
  addSignal(s: Signal): number {
    return Number(this.db.query('INSERT INTO signals (at, wallet, token, kind, score, data, outcome) VALUES ($at,$w,$t,$k,$s,$d,NULL)')
      .run({ $at: s.at, $w: s.wallet, $t: s.token, $k: s.kind, $s: s.score, $d: JSON.stringify(s.data ?? {}) }).lastInsertRowid)
  }
  signals(limit = 200, open = false): Signal[] {
    return (this.db.query(`SELECT * FROM signals ${open ? 'WHERE outcome IS NULL' : ''} ORDER BY at DESC LIMIT $n`).all({ $n: limit }) as any[])
      .map(r => ({ id: r.id, at: r.at, wallet: r.wallet, token: r.token, kind: r.kind, score: r.score, data: JSON.parse(r.data ?? '{}'), outcome: r.outcome ? JSON.parse(r.outcome) : undefined }))
  }
  setOutcome(id: number, outcome: unknown) { this.db.query('UPDATE signals SET outcome = $o WHERE id = $id').run({ $o: JSON.stringify(outcome), $id: id }) }
  getMeta<T>(key: string, fallback: T): T {
    const r = this.db.query('SELECT value FROM meta WHERE key = $k').get({ $k: key }) as { value: string } | null
    return r ? JSON.parse(r.value) : fallback
  }
  setMeta(key: string, value: unknown) { this.db.query('INSERT OR REPLACE INTO meta VALUES ($k,$v)').run({ $k: key, $v: JSON.stringify(value) }) }
  pruneCandles(olderThan: number) { this.db.query('DELETE FROM candles WHERE ts < $t').run({ $t: olderThan }) }
  close() { this.db.close() }
}

// ---- GeckoTerminal parsers (PancakeSwap v2 pools against WBNB only: the pools hands can trade) ----

export function parsePools(json: any, now: number): Token[] {
  const out: Token[] = []
  for (const p of json?.data ?? []) {
    const a = p?.attributes ?? {}, r = p?.relationships ?? {}
    if (r.dex?.data?.id !== 'pancakeswap_v2' || String(r.quote_token?.data?.id ?? '').toLowerCase() !== `bsc_${WBNB}`) continue
    const token = String(r.base_token?.data?.id ?? '').toLowerCase().replace(/^bsc_/, '')
    if (!/^0x[0-9a-f]{40}$/.test(token)) continue
    out.push({
      token, pool: String(a.address ?? '').toLowerCase(), symbol: String(a.name ?? '').split(' / ')[0]!.replace(/[^\p{L}\p{N}$._-]/gu, '').slice(0, 20) || '?',
      launchedAt: Date.parse(a.pool_created_at) || now, fdvUsd: Number(a.fdv_usd) || 0, priceUsd: Number(a.base_token_price_usd) || 0,
      liquidityUsd: Number(a.reserve_in_usd) || 0, updatedAt: now,
    })
  }
  return out
}

export function parseTrades(json: any, t: Pick<Token, 'token' | 'pool'>): Trade[] {
  const out: Trade[] = []
  for (const d of json?.data ?? []) {
    const a = d?.attributes ?? {}
    const side = a.kind === 'buy' ? 'buy' : a.kind === 'sell' ? 'sell' : null
    const wallet = String(a.tx_from_address ?? '').toLowerCase()
    if (!side || !/^0x[0-9a-f]{40}$/.test(wallet)) continue
    const buy = side === 'buy'
    out.push({
      tx: String(a.tx_hash), wallet, token: t.token, pool: t.pool, at: Date.parse(a.block_timestamp) || 0, block: Number(a.block_number) || 0, side,
      bnb: Number(buy ? a.from_token_amount : a.to_token_amount) || 0, usd: Number(a.volume_in_usd) || 0,
      priceUsd: Number(buy ? a.price_to_in_usd : a.price_from_in_usd) || 0, amount: Number(buy ? a.to_token_amount : a.from_token_amount) || 0,
    })
  }
  return out
}

export function parseCandles(json: any): Candle[] {
  return (json?.data?.attributes?.ohlcv_list ?? []).map((r: number[]) => ({ ts: r[0]! * 1000, o: r[1]!, h: r[2]!, l: r[3]!, c: r[4]!, v: r[5]! }))
    .filter((c: Candle) => Number.isFinite(c.c) && c.c > 0)
    .sort((a: Candle, b: Candle) => a.ts - b.ts)
}
