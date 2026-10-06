// Round trip against mem0 with a throwaway memory: add (no inference), search, delete.
//   bun scripts/mem0-check.ts
const key = process.env.MEM0_API_KEY
if (!key) { console.log('no MEM0_API_KEY'); process.exit(0) }
const H = { authorization: `Token ${key}`, 'content-type': 'application/json' }
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`https://api.mem0.ai${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let json: any; try { json = JSON.parse(text) } catch { json = text }
  return { status: r.status, json }
}
const agent = 'flapa-selftest'
const add = await call('POST', '/v3/memories/add/', { messages: [{ role: 'user', content: 'Selftest: Flapa likes iced oat matcha lattes.' }], agent_id: agent, infer: false, metadata: { kind: 'test' } })
console.log('add', add.status, JSON.stringify(add.json).slice(0, 200))
let hits: any[] = []
for (let i = 0; i < 10 && !hits.length; i++) {
  await Bun.sleep(1500)
  const s = await call('POST', '/v3/memories/search/', { query: 'what drink does flapa like', filters: { AND: [{ agent_id: agent }] }, top_k: 3 })
  hits = s.json?.results ?? (Array.isArray(s.json) ? s.json : [])
  if (i === 0 || hits.length) console.log('search', s.status, JSON.stringify(s.json).slice(0, 240))
}
for (const h of hits) {
  const d = await call('DELETE', `/v1/memories/${h.id}/`)
  console.log('delete', h.id, d.status, JSON.stringify(d.json).slice(0, 120))
}
const list = await call('POST', '/v3/memories/', { filters: { AND: [{ agent_id: agent }] } })
console.log('list v3', list.status, JSON.stringify(list.json).slice(0, 160))
