// The nervous system: every organ's news, fanned out to listeners and kept briefly for the dashboard.

export type Signal = { seq: number; at: number; type: string; from: string; data: unknown }
type Listener = (s: Signal) => void

export class Bus {
  private listeners = new Set<Listener>()
  private ring: Signal[] = []
  private seq = 0

  constructor(private keep = 300) {}

  emit(type: string, from: string, data: unknown = null): Signal {
    const s: Signal = { seq: ++this.seq, at: Date.now(), type, from, data }
    this.ring.push(s)
    if (this.ring.length > this.keep) this.ring.splice(0, this.ring.length - this.keep)
    for (const fn of this.listeners) {
      try { fn(s) } catch (err) { console.error(`[bus] listener failed on ${type}:`, err) }
    }
    return s
  }

  listen(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  recent(n = 100): Signal[] {
    return this.ring.slice(-n)
  }
}
