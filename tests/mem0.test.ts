import { expect, test } from 'bun:test'
import { mem0Client, scopeFilters } from '../src/lib/mem0'

function fakeFetch(answers: Record<string, unknown>) {
  const calls: { url: string; method: string; body: any; auth: string }[] = []
  const f = (async (url: string, init: any) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.authorization })
    const key = Object.keys(answers).find(k => url.includes(k))
    return new Response(JSON.stringify(key ? answers[key] : {}), { status: 200 })
  }) as unknown as typeof fetch
  return { f, calls }
}

test('scopes always include the persona, and the person when given', () => {
  expect(scopeFilters({ agent_id: 'flapa' })).toEqual({ AND: [{ agent_id: 'flapa' }] })
  expect(scopeFilters({ agent_id: 'flapa', user_id: 'x:bob' })).toEqual({ AND: [{ agent_id: 'flapa' }, { user_id: 'x:bob' }] })
})

test('add, search and remove speak the v3/v1 API with a token header', async () => {
  const { f, calls } = fakeFetch({
    '/v3/memories/add/': { results: [{ id: 'm1', data: { memory: 'x' } }] },
    '/v3/memories/search/': { results: [{ id: 'm1', memory: 'Bob loves cats', score: 0.8 }, { id: 'm2', memory: '' }] },
  })
  const m = mem0Client('k', f)
  expect(await m.add('Bob loves cats', { agent_id: 'flapa', user_id: 'x:bob' }, { infer: false, metadata: { kind: 'person' } })).toEqual(['m1'])
  expect(calls[0]).toMatchObject({ method: 'POST', auth: 'Token k', body: { agent_id: 'flapa', user_id: 'x:bob', infer: false, metadata: { kind: 'person' }, messages: [{ role: 'user', content: 'Bob loves cats' }] } })
  const hits = await m.search('cats', { agent_id: 'flapa' })
  expect(hits.map(h => h.memory)).toEqual(['Bob loves cats'])
  expect(calls[1]!.body.filters).toEqual({ AND: [{ agent_id: 'flapa' }] })
  await m.remove('m1')
  expect(calls[2]).toMatchObject({ method: 'DELETE', url: 'https://api.mem0.ai/v1/memories/m1/' })
})

test('errors carry the status', async () => {
  const f = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
  await expect(mem0Client('bad', f).search('q', { agent_id: 'a' })).rejects.toThrow('mem0 answered 401')
})
