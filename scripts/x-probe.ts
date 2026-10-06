// Read-only probe of what the X API keys can do (GET requests only; nothing is posted).
//   bun scripts/x-probe.ts
import { authorization, credentialsFromEnv, nonce } from '../src/lib/oauth'

const c = credentialsFromEnv(process.env)
if (!c) { console.log('no X keys in .env'); process.exit(0) }
const API = 'https://api.x.com/2'
async function get(path: string) {
  const url = `${API}${path}`
  const r = await fetch(url, { headers: { authorization: authorization(c!, 'GET', url, { nonce: nonce(), timestamp: Math.floor(Date.now() / 1000) }) } })
  const body = await r.json().catch(() => ({}))
  return { status: r.status, body, left: r.headers.get('x-rate-limit-remaining'), limit: r.headers.get('x-rate-limit-limit') }
}
const me = await get('/users/me?user.fields=public_metrics,created_at')
console.log('users/me', me.status, me.status === 200 ? JSON.stringify({ username: me.body.data?.username, metrics: me.body.data?.public_metrics }) : JSON.stringify(me.body).slice(0, 200))
const id = me.body.data?.id
const checks: [string, string][] = [
  ['own timeline + metrics', `/users/${id}/tweets?max_results=5&tweet.fields=public_metrics,created_at`],
  ['own non-public metrics', `/users/${id}/tweets?max_results=5&tweet.fields=non_public_metrics`],
  ['mentions', `/users/${id}/mentions?max_results=5`],
  ['followers list', `/users/${id}/followers?max_results=5`],
  ['user lookup by name', `/users/by/username/elonmusk?user.fields=public_metrics`],
  ['recent search', `/tweets/search/recent?query=memecoin&max_results=10`],
]
for (const [name, path] of checks) {
  if (!id) break
  const r = await get(path)
  const detail = r.status === 200 ? `${(r.body.data ?? []).length ?? 0} items` : JSON.stringify(r.body?.title ?? r.body?.detail ?? r.body).slice(0, 140)
  console.log(`${name.padEnd(24)} ${r.status} ${detail} | rate ${r.left ?? '?'}/${r.limit ?? '?'}`)
}
