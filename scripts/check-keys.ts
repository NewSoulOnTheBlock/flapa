// Read-only check of the keys in .env (Bun loads it): who the X keys sign in as, and which wallet the
// trading key controls. Posts nothing, trades nothing, never prints a secret.
import { authorization, credentialsFromEnv, nonce } from '../src/lib/oauth'

const creds = credentialsFromEnv(process.env)
if (!creds) console.log('X: keys missing')
else {
  const url = 'https://api.x.com/2/users/me'
  const r = await fetch(url, { headers: { authorization: authorization(creds, 'GET', url, { nonce: nonce(), timestamp: Math.floor(Date.now() / 1000) }) } })
  const body: any = await r.json().catch(() => ({}))
  console.log(r.ok ? `X: keys work, signed in as @${body.data?.username}` : `X: ${r.status} ${JSON.stringify(body.title ?? body.detail ?? body).slice(0, 160)}`)
}

if (!process.env.FLAPA_TRADER_KEY) console.log('trader: key missing')
else {
  const p = Bun.spawn(['node', new URL('../helper/trade.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), 'balance', '{}'], { stdout: 'pipe', stderr: 'pipe', env: process.env })
  const out = (await new Response(p.stdout).text()).trim().split('\n').pop() ?? ''
  await p.exited
  try {
    const v = JSON.parse(out)
    console.log(v.error ? `trader: ${v.error}` : `trader: wallet ${v.address}, ${(Number(BigInt(v.bnbWei)) / 1e18).toFixed(5)} BNB on BNB Chain`)
  } catch { console.log(`trader: helper said ${out.slice(0, 160)}`) }
}
