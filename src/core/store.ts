// Each organ's long-term state: one JSON file, written whole through a temp file so a crash never leaves half.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export class Store {
  private data: Record<string, unknown>
  private path: string

  constructor(dir: string, name: string) {
    mkdirSync(dir, { recursive: true })
    this.path = join(dir, `${name}.json`)
    this.data = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : {}
  }

  get<T>(key: string, fallback: T): T {
    return key in this.data ? (this.data[key] as T) : fallback
  }

  set<T>(key: string, value: T): T {
    this.data[key] = value
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 1))
    renameSync(tmp, this.path)
    return value
  }

  update<T>(key: string, fallback: T, change: (v: T) => T): T {
    return this.set(key, change(this.get(key, fallback)))
  }
}
