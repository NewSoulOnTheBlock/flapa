// OAuth 1.0a request signing (HMAC-SHA1) for X's user-context endpoints, on
// Web Crypto: no `$`, no Node. Checked against X's published signing example.

export type XCredentials = {
  consumerKey: string
  consumerSecret: string
  accessToken: string
  accessSecret: string
}

/** RFC 3986 percent-encoding, as OAuth 1.0a requires. */
export function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function signatureBase(method: string, baseUrl: string, params: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(params)
    .map(([k, v]) => [pct(k), pct(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return [method.toUpperCase(), pct(baseUrl), pct(pairs)].join('&')
}

// A mod's environment offers crypto.subtle.digest but no HMAC, so SHA-1 and
// HMAC (RFC 3174, RFC 2104) are written out here: small, exact, and testable.
function sha1(msg: Uint8Array): Uint8Array {
  const ml = msg.length
  const withPad = new Uint8Array(((ml + 9 + 63) >> 6) << 6)
  withPad.set(msg)
  withPad[ml] = 0x80
  const view = new DataView(withPad.buffer)
  view.setUint32(withPad.length - 4, ml * 8)
  view.setUint32(withPad.length - 8, Math.floor((ml * 8) / 2 ** 32))
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!
      w[i] = (x << 1) | (x >>> 31)
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20 ? [(b & c) | (~b & d), 0x5a827999]
        : i < 40 ? [b ^ c ^ d, 0x6ed9eba1]
        : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
        : [b ^ c ^ d, 0xca62c1d6]
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0
      e = d
      d = c
      c = ((b << 30) | (b >>> 2)) >>> 0
      b = a
      a = t
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  const out = new Uint8Array(20)
  const ov = new DataView(out.buffer)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h))
  return out
}

export async function hmacSha1(key: string, text: string): Promise<string> {
  const enc = new TextEncoder()
  let k = enc.encode(key)
  if (k.length > 64) k = sha1(k)
  const block = new Uint8Array(64)
  block.set(k)
  const inner = new Uint8Array(64 + enc.encode(text).length)
  const outer = new Uint8Array(64 + 20)
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i]! ^ 0x36
    outer[i] = block[i]! ^ 0x5c
  }
  inner.set(enc.encode(text), 64)
  outer.set(sha1(inner), 64)
  return toBase64(sha1(outer))
}

export function nonce(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The Authorization header for one request. Query parameters are signed; a
 * JSON body is not (OAuth 1.0a signs only form-encoded bodies).
 */
export async function authorization(
  creds: XCredentials,
  method: string,
  url: string,
  opts: { nonce: string; timestamp: number; extra?: Readonly<Record<string, string>> },
): Promise<string> {
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
  const base = signatureBase(method, `${u.origin}${u.pathname}`, { ...query, ...(opts.extra ?? {}), ...oauth })
  const signature = await hmacSha1(`${pct(creds.consumerSecret)}&${pct(creds.accessSecret)}`, base)
  const header = { ...oauth, oauth_signature: signature }
  return `OAuth ${Object.entries(header).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ')}`
}
