// What the outbound reply engine would pick right now (one read-only search; nothing is posted).
//   bun scripts/reply-preview.ts [handle handle ...]
import { authorization, credentialsFromEnv, nonce, pct } from '../src/lib/oauth'
import { opportunityQuery, opportunityScore, pickOpportunities, type Candidate } from '../src/lib/social'

const c = credentialsFromEnv(process.env)
if (!c) { console.log('no X keys'); process.exit(0) }
const watch = process.argv.slice(2)
const q = pct(opportunityQuery(watch))
const url = `https://api.x.com/2/tweets/search/recent?query=${q}&max_results=20&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username,public_metrics`
const r = await fetch(url, { headers: { authorization: authorization(c, 'GET', url, { nonce: nonce(), timestamp: Math.floor(Date.now() / 1000) }) } })
const j: any = await r.json()
if (!r.ok) { console.log(r.status, JSON.stringify(j).slice(0, 200)); process.exit(0) }
const users = new Map<string, any>((j.includes?.users ?? []).map((u: any) => [u.id, u]))
const cands: Candidate[] = (j.data ?? []).map((t: any) => {
  const u = users.get(t.author_id), m = t.public_metrics ?? {}
  return { id: t.id, author: u?.username ?? '?', authorFollowers: Number(u?.public_metrics?.followers_count) || 0, text: t.text, at: Date.parse(t.created_at), likes: m.like_count ?? 0, replies: m.reply_count ?? 0, reposts: m.retweet_count ?? 0 }
})
const now = Date.now(), w = new Set(watch.map(h => h.replace(/^@/, '').toLowerCase()))
for (const x of cands.map(c => ({ c, ...opportunityScore(c, now, w) })).sort((a, b) => b.score - a.score).slice(0, 6)) {
  console.log(`${String(x.score).padStart(3)} @${x.c.author} (${x.c.authorFollowers} fol) ${JSON.stringify(x.parts)}\n    ${x.c.text.replace(/\s+/g, ' ').slice(0, 110)}`)
}
const pick = pickOpportunities(cands, now, w, { self: 'FlapaKuwai', already: new Set() })[0]
console.log(`\n${cands.length} posts; she would reply to: ${pick ? `@${pick.c.author} (score ${pick.score})` : 'nobody (nothing scored 55+)'}`)
