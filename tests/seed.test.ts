import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applySeed, packState } from '../src/core/seed'

const fresh = () => mkdtempSync(join(tmpdir(), 'flapa-seed-'))

test('seeds an empty home', () => {
  const home = fresh()
  const seed = packState({ 'organs/voice.json': '{"a":1}', 'organs/memory.json': '{"b":2}' })
  expect(applySeed(home, seed).sort()).toEqual([join('organs', 'memory.json'), join('organs', 'voice.json')])
  expect(JSON.parse(readFileSync(join(home, 'organs', 'voice.json'), 'utf8'))).toEqual({ a: 1 })
})

test('never overwrites existing state', () => {
  const home = fresh()
  mkdirSync(join(home, 'organs'))
  writeFileSync(join(home, 'organs', 'voice.json'), '{"live":true}')
  expect(applySeed(home, packState({ 'organs/voice.json': '{"old":true}' }))).toEqual([])
  expect(readFileSync(join(home, 'organs', 'voice.json'), 'utf8')).toBe('{"live":true}')
})

test('does nothing without a seed', () => {
  expect(applySeed(fresh(), undefined)).toEqual([])
})

test('rejects paths outside the home and non-JSON files', () => {
  expect(() => applySeed(fresh(), packState({ '../escape.json': '{}' }))).toThrow()
  expect(() => applySeed(fresh(), packState({ 'organs/x.sh': '{}' }))).toThrow()
  expect(() => applySeed(fresh(), packState({ 'organs/bad.json': 'not json' }))).toThrow()
})
