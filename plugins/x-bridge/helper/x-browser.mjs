// Drives X in the agent's own Chrome profile over the DevTools protocol and
// serves it to x-bridge on 127.0.0.1. Prints `PORT <n>` once ready.
//
//   node x-browser.mjs            headless, for posting and reading
//   node x-browser.mjs --login    a visible window, to sign in once
//
// The profile persists (default ~/.claude/pacs/x-chrome-profile, or
// PACS_X_PROFILE), so a login survives. It is never the person's own Chrome.
// Node 24: global WebSocket and fetch, no npm dependencies.
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const isLogin = process.argv.includes('--login')
const profile = process.env.PACS_X_PROFILE || join(homedir(), '.claude', 'pacs', 'x-chrome-profile')
mkdirSync(profile, { recursive: true })
const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const chromePath = CHROME_PATHS.find(p => existsSync(p))
if (!chromePath) {
  console.log('ERROR no Chrome found; set CHROME_PATH')
  process.exit(1)
}
// A stale DevToolsActivePort from a crashed run would point at a dead port.
rmSync(join(profile, 'DevToolsActivePort'), { force: true })
spawn(chromePath, [
  ...(isLogin ? [] : ['--headless=new']),
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1100,900',
  '--no-first-run', '--no-default-browser-check',
  isLogin ? 'https://x.com/login' : 'about:blank',
], { stdio: 'ignore', detached: process.platform !== 'win32' })

// ---------- shutdown: the exe is a stub on Windows, so reach Chrome by profile ----------

let browserWsUrl = ''
function killByProfile() {
  try {
    if (process.platform === 'win32') {
      const needle = profile.replace(/'/g, "''")
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${needle}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ], { stdio: 'ignore', windowsHide: true })
    } else {
      spawnSync('pkill', ['-f', profile], { stdio: 'ignore' })
    }
  } catch {}
}
let isClosing = false
async function shutdown() {
  if (isClosing) return
  isClosing = true
  try {
    const b = new WebSocket(browserWsUrl)
    await new Promise((res, rej) => { b.onopen = res; b.onerror = rej; setTimeout(rej, 1500) })
    b.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
    await sleep(800)
  } catch {}
  process.exit(0)
}
process.on('exit', killByProfile)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => void shutdown())
process.stdout.on('error', () => void shutdown())
// A hard kill runs no handler of ours: a detached watchdog closes Chrome after us.
spawn(process.execPath, ['-e', `
  const { spawnSync } = require('node:child_process')
  const [pid, needle] = process.argv.slice(1)
  const alive = () => { try { process.kill(Number(pid), 0); return true } catch { return false } }
  const t = setInterval(() => {
    if (alive()) return
    clearInterval(t)
    if (process.platform === 'win32') spawnSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*" + needle.replace(/'/g, "''") + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
      { stdio: 'ignore', windowsHide: true })
    else spawnSync('pkill', ['-f', needle], { stdio: 'ignore' })
  }, 2000)
`, String(process.pid), profile], { detached: true, stdio: 'ignore', windowsHide: true }).unref()

// ---------- CDP ----------

let ws
let seq = 0
const pending = new Map()
const listeners = new Set()
function cdp(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)) }, 30_000)
  })
}

async function connect() {
  const file = join(profile, 'DevToolsActivePort')
  let port = 0
  for (let i = 0; i < 150 && !port; i++) {
    if (existsSync(file)) {
      const [p, path] = readFileSync(file, 'utf8').split('\n')
      if (Number(p)) {
        port = Number(p)
        browserWsUrl = `ws://127.0.0.1:${port}${path?.trim() ?? ''}`
      }
    }
    if (!port) await sleep(100)
  }
  if (!port) throw new Error('Chrome did not start (is another window open on this profile?)')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find(t => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onclose = () => void shutdown()
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data)
    if (msg.method) { for (const l of listeners) l(msg); return }
    const p = msg.id && pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  }
  await cdp('Page.enable')
  await cdp('Network.enable')
}

async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result?.value
}

async function goto(url) {
  await cdp('Page.navigate', { url })
  for (let i = 0; i < 60; i++) {
    await sleep(250)
    if ((await evaluate('document.readyState')) === 'complete') break
  }
}

async function waitFor(expression, ms = 15_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const v = await evaluate(expression)
    if (v) return v
    await sleep(300)
  }
  return null
}

// ---------- X ----------

const PROFILE_LINK = `(() => document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') || '')()`

/** Signed in means X's session cookie is present: no guessing at page layout. */
async function signedIn() {
  const { cookies } = await cdp('Network.getCookies', { urls: ['https://x.com'] })
  return cookies.some(c => c.name === 'auth_token' && c.value)
}

async function status() {
  if (!(await signedIn())) return { loggedIn: false }
  await goto('https://x.com/home')
  const href = await waitFor(`(() => location.pathname.includes('/login') || location.pathname.includes('/i/flow') ? 'out' : ${PROFILE_LINK})()`)
  if (!href || href === 'out') return { loggedIn: false }
  return { loggedIn: true, username: href.replace(/^\//, '') }
}

async function post({ text, replyTo }) {
  if (!(await signedIn())) throw new Error('not signed in: run /x browser login')
  const q = new URLSearchParams({ text: String(text) })
  if (replyTo) q.set('in_reply_to', String(replyTo))
  // X's own share-a-post page: the text arrives prefilled; we only press Post.
  await goto(`https://x.com/intent/post?${q}`)
  const ready = await waitFor(`(() => { const b = document.querySelector('[data-testid="tweetButton"]'); return !!b && b.getAttribute('aria-disabled') !== 'true' })()`)
  if (!ready) {
    throw new Error('the Post button never became ready (X may have changed its page)')
  }
  // The new post's id comes back in X's own CreateTweet response.
  const created = new Promise(resolve => {
    const timer = setTimeout(() => { listeners.delete(onEvent); resolve(null) }, 20_000)
    async function onEvent(msg) {
      if (msg.method !== 'Network.loadingFinished' && msg.method !== 'Network.responseReceived') return
      if (msg.method === 'Network.responseReceived' && /\/CreateTweet/.test(msg.params.response.url)) onEvent.requestId = msg.params.requestId
      if (msg.method === 'Network.loadingFinished' && msg.params.requestId === onEvent.requestId) {
        clearTimeout(timer)
        listeners.delete(onEvent)
        try {
          const body = await cdp('Network.getResponseBody', { requestId: msg.params.requestId })
          const json = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body)
          resolve(json?.data?.create_tweet?.tweet_results?.result?.rest_id ?? null)
        } catch { resolve(null) }
      }
    }
    listeners.add(onEvent)
  })
  await evaluate(`document.querySelector('[data-testid="tweetButton"]').click()`)
  const id = await created
  if (!id) {
    const error = await evaluate(`(() => document.querySelector('[data-testid="toast"]')?.innerText || '')()`)
    throw new Error(error ? `X said: ${error}` : 'no confirmation from X that the post went out')
  }
  return { id }
}

const SCRAPE = `(() => [...document.querySelectorAll('article[data-testid="tweet"]')].map(a => {
  const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href'))
    .find(h => /^\\/[^/]+\\/status\\/\\d+$/.test(h))
  if (!link) return null
  const [, author, , id] = link.split('/')
  const text = (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim()
  const at = a.querySelector('time')?.getAttribute('datetime') || ''
  return { id, author, text, at }
}).filter(Boolean))()`

async function mentions() {
  if (!(await signedIn())) throw new Error('not signed in: run /x browser login')
  await goto('https://x.com/notifications/mentions')
  await waitFor(`document.querySelectorAll('article[data-testid="tweet"]').length > 0`, 12_000)
  await sleep(800)
  return { mentions: (await evaluate(SCRAPE)) ?? [] }
}

// ---------- HTTP API: one request at a time, one tab ----------

let queue = Promise.resolve()
const serial = fn => (queue = queue.then(fn, fn))

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  let body = {}
  try {
    let raw = ''
    for await (const chunk of req) raw += chunk
    body = raw ? JSON.parse(raw) : {}
  } catch {}
  try {
    if (u.pathname === '/quit') { send(200, { ok: true }); return void shutdown() }
    const route = { '/status': status, '/post': () => post(body), '/mentions': mentions }[u.pathname]
    if (!route) return send(404, { error: 'unknown' })
    send(200, await serial(route))
  } catch (err) {
    send(500, { error: String(err?.message ?? err) })
  }
})

await connect()
server.listen(0, '127.0.0.1', () => console.log(`PORT ${server.address().port}${isLogin ? ' LOGIN' : ''}`))
