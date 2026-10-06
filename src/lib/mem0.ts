// A small client for the mem0 Platform API (https://api.mem0.ai), her long-term memory store.
// Scopes: agent_id is the persona; user_id is who a memory is about ("x:<handle>" for people on X).
export type Mem0Hit = { id: string; memory: string; score?: number; user_id?: string | null; metadata?: Record<string, unknown> | null; created_at?: string }
export type Mem0Scope = { agent_id: string; user_id?: string }
export type Mem0 = {
  add(input: string | { role: 'user' | 'assistant'; content: string }[], scope: Mem0Scope, opts?: { infer?: boolean; metadata?: Record<string, unknown> }): Promise<string[]>
  search(query: string, scope: Mem0Scope, topK?: number): Promise<Mem0Hit[]>
  list(scope: Mem0Scope, pageSize?: number): Promise<Mem0Hit[]>
  remove(id: string): Promise<void>
}

const BASE = 'https://api.mem0.ai'

/** Filters for one scope: always the persona, and the person/account too when given. */
export function scopeFilters(s: Mem0Scope): Record<string, unknown> {
  return { AND: [{ agent_id: s.agent_id }, ...(s.user_id ? [{ user_id: s.user_id }] : [])] }
}

export function mem0Client(apiKey: string, fetcher: typeof fetch = fetch): Mem0 {
  async function call(method: string, path: string, body?: unknown): Promise<any> {
    const r = await fetcher(`${BASE}${path}`, {
      method,
      headers: { authorization: `Token ${apiKey}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await r.text()
    if (!r.ok) throw new Error(`mem0 answered ${r.status}: ${text.slice(0, 160)}`)
    try { return JSON.parse(text) } catch { return {} }
  }
  const hits = (j: any): Mem0Hit[] => (j?.results ?? (Array.isArray(j) ? j : []))
    .map((h: any) => ({ id: String(h.id), memory: String(h.memory ?? h.data?.memory ?? ''), score: h.score, user_id: h.user_id, metadata: h.metadata, created_at: h.created_at }))
    .filter((h: Mem0Hit) => h.memory)

  return {
    async add(input, scope, opts = {}) {
      const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input
      const j = await call('POST', '/v3/memories/add/', { messages, ...scope, infer: opts.infer ?? true, ...(opts.metadata ? { metadata: opts.metadata } : {}) })
      return (j?.results ?? []).map((r: any) => String(r.id)).filter(Boolean)
    },
    async search(query, scope, topK = 8) {
      return hits(await call('POST', '/v3/memories/search/', { query: query.slice(0, 1000), filters: scopeFilters(scope), top_k: topK, threshold: 0.25 }))
    },
    async list(scope, pageSize = 50) {
      return hits(await call('POST', `/v3/memories/?page_size=${pageSize}`, { filters: scopeFilters(scope) }))
    },
    async remove(id) {
      await call('DELETE', `/v1/memories/${encodeURIComponent(id)}/`)
    },
  }
}

export const mem0FromEnv = (env: Record<string, string | undefined>, fetcher?: typeof fetch): Mem0 | null =>
  env.MEM0_API_KEY ? mem0Client(env.MEM0_API_KEY, fetcher) : null
