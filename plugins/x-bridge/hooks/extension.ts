// The person's own open Chrome, through the Claude in Chrome extension: page
// scripts the extension runs, and parsing what it hands back. Pure: no `$`.

export const EXT = 'mcp__claude-in-chrome__'

const SLEEP = 'const sleep = ms => new Promise(r => setTimeout(r, ms));'

/** Signed in? Read the sidebar's profile link, the account's own handle. */
export const STATUS_JS = `await (async () => { ${SLEEP}
  for (let i = 0; i < 20; i++) {
    const h = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')
    if (h) return JSON.stringify({ loggedIn: true, username: h.replace(/^\\//, '') })
    if (location.pathname.includes('/login') || location.pathname.includes('/i/flow')) break
    await sleep(500)
  }
  return JSON.stringify({ loggedIn: false })
})()`

/** On X's share-a-post page: press Post, then read the new post's id from X's own "View" toast. */
export const POST_JS = `await (async () => { ${SLEEP}
  let button = null
  for (let i = 0; i < 30; i++) {
    const b = document.querySelector('[data-testid="tweetButton"]')
    if (b && b.getAttribute('aria-disabled') !== 'true') { button = b; break }
    if (location.pathname.includes('/login') || location.pathname.includes('/i/flow')) {
      return JSON.stringify({ error: 'not signed in to X in this Chrome' })
    }
    await sleep(500)
  }
  if (!button) return JSON.stringify({ error: 'the Post button never became ready (X may have changed its page)' })
  button.click()
  for (let i = 0; i < 30; i++) {
    const link = document.querySelector('[data-testid="toast"] a[href*="/status/"]')?.getAttribute('href')
    const id = link && link.match(/\\/status\\/(\\d+)/)?.[1]
    if (id) return JSON.stringify({ id })
    const toast = document.querySelector('[data-testid="toast"]')?.innerText
    if (toast && /went wrong|already|limit|try again/i.test(toast)) return JSON.stringify({ error: 'X said: ' + toast })
    await sleep(500)
  }
  // No toast seen: if the composer closed, the post went; the id is just unknown.
  const open = document.querySelector('[data-testid="tweetButton"]')
  return JSON.stringify(open ? { error: 'no confirmation from X that the post went out' } : { id: null })
})()`

export const MENTIONS_JS = `await (async () => { ${SLEEP}
  for (let i = 0; i < 24 && !document.querySelector('article[data-testid="tweet"]'); i++) await sleep(500)
  await sleep(800)
  return JSON.stringify({ mentions: [...document.querySelectorAll('article[data-testid="tweet"]')].map(a => {
    const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href'))
      .find(h => /^\\/[^/]+\\/status\\/\\d+$/.test(h))
    if (!link) return null
    const [, author, , id] = link.split('/')
    const text = (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim()
    const at = a.querySelector('time')?.getAttribute('datetime') || ''
    return { id, author, text, at }
  }).filter(Boolean).slice(0, 40) })
})()`

export function intentUrl(text: string, replyTo?: string): string {
  const q = new URLSearchParams({ text })
  if (replyTo) q.set('in_reply_to', replyTo)
  return `https://x.com/intent/post?${q}`
}

/** The JSON a page script returned, out of the extension's reply (which trails a "Tab Context" note). */
export function parseExtJson(text: string): unknown {
  const body = text.split(/\n\s*\nTab Context/)[0]!.replace(/^\[[^\]]*\]\s*/, '').trim()
  let value: unknown = JSON.parse(body)
  if (typeof value === 'string') value = JSON.parse(value)
  return value
}

/** The extension's tab for this session, from tabs_context_mcp's reply. */
export function firstTabId(text: string): number | undefined {
  const start = text.indexOf('{')
  const end = text.indexOf('\n\nTab Context')
  try {
    const json = JSON.parse(text.slice(start, end > start ? end : undefined).trim()) as { availableTabs?: { tabId: number }[] }
    return json.availableTabs?.[0]?.tabId
  } catch {
    return /tabId (\d+)/.exec(text)?.[1] ? Number(/tabId (\d+)/.exec(text)![1]) : undefined
  }
}
