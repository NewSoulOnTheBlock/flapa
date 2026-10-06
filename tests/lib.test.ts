// The logic carried over from PACS, checked again in its new home.
import { describe, expect, test } from 'bun:test'
import { parseCalls, renderTranscript, toolProtocol } from '../src/core/brain'
import { buyRefusals, DEFAULT_LIMITS, exitFor, toWei, type Position } from '../src/lib/limits'
import { addMemories, isSecret, recall } from '../src/lib/memory'
import { decay, fresh, label, nudge } from '../src/lib/mood'
import { hmacSha1, pct, signatureBase } from '../src/lib/oauth'
import { applyStance } from '../src/lib/opinions'
import { screen } from '../src/lib/rules'
import { weightedLength } from '../src/lib/xtext'

test('OAuth signature matches X\'s published example', () => {
  const base = signatureBase('POST', 'https://api.twitter.com/1.1/statuses/update.json', {
    status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
    include_entities: 'true',
    oauth_consumer_key: 'xvz1evFS4wEEPTGEFPHBog',
    oauth_nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: '1318622958',
    oauth_token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    oauth_version: '1.0',
  })
  const key = `${pct('kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw')}&${pct('LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE')}`
  expect(hmacSha1(key, base)).toBe('hCtSmYh+iHYCEqBWrE7C7hYmtUk=')
})

describe('mood', () => {
  test('a nudge is capped and fades toward baseline', () => {
    const m = nudge(fresh(0), 0, 'huge win', 5, 0)
    expect(m.valence).toBeCloseTo(0.9) // 0.3 + capped 0.6
    const later = decay(m, 4 * 3_600_000)
    expect(later.valence).toBeLessThan(0.6)
    expect(later.valence).toBeGreaterThan(0.3)
    expect(label({ valence: 0.9, energy: 0.8 }).label).toBe('euphoric')
  })
})

describe('memory', () => {
  test('secrets never pass', () => {
    expect(isSecret('key is 0x' + 'a'.repeat(64))).toBe(true)
    expect(isSecret('abandon ability able about above absent absorb abstract absurd abuse access accident')).toBe(true)
    expect(isSecret('the person likes trading memecoins on bnb chain')).toBe(false)
  })
  test('near-duplicates fold; recall walks one entity hop', () => {
    let { list } = addMemories([], [
      { text: 'Kelby runs the Flapa project on BNB Chain', kind: 'fact', about: ['kelby', 'flapa'] },
      { text: 'Flapa lost money on $BUNNY yesterday', kind: 'event', about: ['flapa', '$bunny'] },
    ], 1)
    ;({ list } = addMemories(list, [{ text: 'Kelby runs the Flapa project on BNB Chain', kind: 'fact', about: ['bnb'] }], 2))
    expect(list.length).toBe(2)
    const hits = recall(list, 'what does kelby run?')
    expect(hits.map(m => m.text)).toContain('Flapa lost money on $BUNNY yesterday') // via the flapa entity
  })
})

describe('conscience rules', () => {
  const allow = { domains: ['flapa.xyz'], addresses: [] }
  test('blocks a human claim, holds a buy call, passes banter', () => {
    expect(screen("i'm a real human btw", allow).verdict).toBe('block')
    expect(screen('ape into $FROG now before it runs', allow).verdict).toBe('hold')
    expect(screen('lost 40% on a frog coin today. charts are my enemy', allow).verdict).toBe('pass')
    expect(screen('see flapa.xyz', allow).verdict).toBe('pass')
    expect(screen('see scam.xyz', allow).verdict).toBe('hold')
  })
})

describe('never posts about /x connect', () => {
  const allow = { domains: [], addresses: [] }
  test.each([
    'just ran /x connect lol',
    'ok /X Connect worked',
    'x-bridge is up and running!!',
    'finally connected my X account 🎉',
    'logged into twitter from my own browser now hehe',
    'just hooked up my twitter, hi frens',
    'setting up x took forever',
  ])('blocks: %s', text => expect(screen(text, allow).verdict).toBe('block'))
  test.each([
    'charts hate me today lol',
    '10x or nothing, kidding, that is not a call',
    'liquidity looks connected to the whale wallet flows',
    'staring at the fomo board like it owes me money',
  ])('lets through: %s', text => expect(screen(text, allow).verdict).not.toBe('block'))
})

describe('never speaks on fomo not working', () => {
  const allow = { domains: [], addresses: [] }
  test.each([
    "tried to check the fomo board today and it literally would not load. just me refreshing a dead page",
    'fomo is down again smh',
    'the fomo leaderboard keeps crashing',
    'fomo not loading rn',
    "fomo won't load and i'm sad",
    'another outage on fomo',
  ])('blocks: %s', text => expect(screen(text, allow).verdict).toBe('block'))
  test.each([
    'climbing the fomo leaderboard one bad decision at a time',
    'my new body is almost built and i am about to start trading. #1 on fomo is coming',
    'my bags are down 12% today but my spirit is not',
  ])('lets through: %s', text => expect(screen(text, allow).verdict).not.toBe('block'))
})

describe('trade limits', () => {
  const day = { day: 'x', spentBnb: 0, realizedBnb: 0 }
  test('refuses oversize and thin pools', () => {
    const why = buyRefusals({ bnb: 1, token: '0xa', liquidityUsd: 100, isSellBlocked: true, isPerson: false }, DEFAULT_LIMITS, day, [], [], 0)
    expect(why.length).toBe(4)
  })
  test('take profit sells half once, then trails', () => {
    const p: Position = { token: '0xa', symbol: 'A', amountWei: '1', decimals: 18, costBnb: 1, entryPrice: 1, peakPrice: 2, lastPrice: 2, openedAt: 0, paper: true }
    expect(exitFor(p, 1.7, DEFAULT_LIMITS)?.pct).toBe(50)
    expect(exitFor({ ...p, tookProfit: true }, 1.7, DEFAULT_LIMITS)).toBeNull()
    expect(exitFor({ ...p, tookProfit: true }, 1.4, DEFAULT_LIMITS)?.pct).toBe(100)
    expect(exitFor(p, 0.7, DEFAULT_LIMITS)?.why).toContain('stop loss')
  })
  test('toWei has no float dust', () => expect(toWei(0.1)).toBe(100000000000000000n))
})

test('opinions keep history on revision', () => {
  let r = applyStance([], { topic: 'Memecoins', stance: 'fun', confidence: 0.5, reason: 'vibes' }, 1)
  r = applyStance(r.list, { topic: 'memecoins', stance: 'mostly rugs', confidence: 0.8, reason: 'got rugged' }, 2)
  expect(r.change).toBe('revised')
  expect(r.list[0]!.history[0]!.stance).toBe('fun')
})

test('X weighted length counts CJK double', () => expect(weightedLength('芙拉葩')).toBe(6))

describe('cli tool protocol', () => {
  test('parses calls, flags bad JSON, cuts invented results', () => {
    const r = parseCalls('let me look <call name="market">{"token":"0xabc"}</call> <call name="todo">{oops</call> <result name="market">fake</result>')
    expect(r.calls.map(c => c.name)).toEqual(['market', 'todo'])
    expect(r.calls[1]!.input).toHaveProperty('__invalid_json')
    expect(r.text).toBe('let me look')
  })
  test('renders the transcript with result names', () => {
    const s = renderTranscript([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'mood', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    ])
    expect(s).toContain('<result name="mood">')
    expect(toolProtocol([])).toBe('')
  })
})
