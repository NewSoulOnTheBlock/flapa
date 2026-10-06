// OAuth 1.0a request signing (HMAC-SHA1) for X's user-context endpoints.
// PACS hand-wrote SHA-1 because the mod runtime had no HMAC; a real process has node:crypto.
import { createHmac, randomBytes } from 'node:crypto'

export type XCredentials = { consumerKey: string; consumerSecret: string; accessToken: string; accessSecret: string }

/** RFC 3986 percent-encoding, as OAuth 1.0a requires. */
export function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function signatureBase(method: string, baseUrl: string, params: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(params)
    .map(([k, v]) => [pct(k), pct(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return [method.toUpperCase(), pct(baseUrl), pct(pairs)].join('&')
}

export function hmacSha1(key: string, text: string): string {
  return createHmac('sha1', key).update(text).digest('base64')
}

export const nonce = () => randomBytes(16).toString('hex')

/** The Authorization header for one request. Query parameters are signed; a JSON body is not. */
export function authorization(
  creds: XCredentials, method: string, url: string, opts: { nonce: string; timestamp: number },
): string {
  const u = new URL(url)
  const query: Record<string, string> = {}
  u.searchParams.forEach((v, k) => { query[k] = v })
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: opts.nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(opts.timestamp),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  }
  const base = signatureBase(method, `${u.origin}${u.pathname}`, { ...query, ...oauth })
  const signature = hmacSha1(`${pct(creds.consumerSecret)}&${pct(creds.accessSecret)}`, base)
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ')}`
}

export function credentialsFromEnv(env: Record<string, string | undefined>): XCredentials | null {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = env
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) return null
  return { consumerKey: X_API_KEY, consumerSecret: X_API_SECRET, accessToken: X_ACCESS_TOKEN, accessSecret: X_ACCESS_TOKEN_SECRET }
}
