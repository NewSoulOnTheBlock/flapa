// What the measure-and-learn loop sees on her real account right now (read-only).
//   bun scripts/learn-preview.ts
import { bestHours, learn, learningNote, statFromTweet, weightNudges } from '../src/lib/analytics'
import { authorization, credentialsFromEnv, nonce } from '../src/lib/oauth'

const c = credentialsFromEnv(process.env)
if (!c) { console.log('no X keys'); process.exit(0) }
const get = async (path: string) => {
  const url = `https://api.x.com/2${path}`
  const r = await fetch(url, { headers: { authorization: authorization(c, 'GET', url, { nonce: nonce(), timestamp: Math.floor(Date.now() / 1000) }) } })
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 150)}`)
  return r.json() as any
}
const me = await get('/users/me')
const r = await get(`/users/${me.data.id}/tweets?max_results=40&exclude=replies,retweets&tweet.fields=created_at,public_metrics,non_public_metrics`)
  .catch(() => get(`/users/${me.data.id}/tweets?max_results=40&exclude=replies,retweets&tweet.fields=created_at,public_metrics`))
const stats = (r.data ?? []).map((t: any) => statFromTweet(t))
const l = learn(stats)
console.log(`${stats.length} posts read; baseline`, l?.baseline)
console.log('hours:', l?.hours.map(h => `${h.tag} x${h.ratio.toFixed(2)} (n=${h.n})`).join(', '))
console.log('best hours:', bestHours(l))
console.log('winners:'); for (const w of l?.winners ?? []) console.log(`  ${w.ratio}x  ${w.text.slice(0, 70)}\n        ${w.why.join(' · ')}`)
console.log('nudges:', weightNudges(l), '\n' + (learningNote(l) || '(no note yet: posts carry no section tags until the engine tags them)'))
