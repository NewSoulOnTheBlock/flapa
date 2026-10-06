import { expect, test } from 'bun:test'
import { buildGraph } from '../src/lib/wallets/graph'
import type { Position } from '../src/lib/wallets/metrics'

const pos = (wallet: string, token: string, at: number) => ({ wallet, token, firstBuyAt: at } as unknown as Position)

test('a wallet that moves first, again and again, is the leader of its cluster', () => {
  const ps: Position[] = []
  for (let i = 0; i < 6; i++) {
    const t0 = i * 3_600_000
    ps.push(pos('A', `t${i}`, t0), pos('B', `t${i}`, t0 + 22_000), pos('C', `t${i}`, t0 + 41_000))
    ps.push(pos('Z', `z${i}`, t0)) // a loner with its own tokens
  }
  const g = buildGraph(ps)
  const ab = g.follows.find(f => f.leader === 'A' && f.follower === 'B')!
  expect(ab).toMatchObject({ shared: 6, followRate: 1, medianDelaySec: 22 })
  expect(g.clusters).toHaveLength(1)
  expect(g.clusters[0]!.leader).toBe('A')
  expect(g.clusterOf.get('Z')).toBeUndefined()
  expect(g.influence.get('A')!).toBeGreaterThan(g.influence.get('B') ?? 0)
})

test('far-apart entries and thin wallets do not link', () => {
  const ps: Position[] = []
  for (let i = 0; i < 6; i++) ps.push(pos('A', `t${i}`, i * 3_600_000), pos('B', `t${i}`, i * 3_600_000 + 30 * 60_000))
  expect(buildGraph(ps).follows).toHaveLength(0)
  expect(buildGraph(ps.slice(0, 4), 5).follows).toHaveLength(0)
})
