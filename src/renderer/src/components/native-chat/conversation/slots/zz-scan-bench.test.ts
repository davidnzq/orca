import { it } from 'vitest'
import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'
import { createStructuredAgentSessionEventCoalescer } from '../../../../../../shared/agent-session/view/live-read/structured-agent-session-coalescer'
import { positionsRevisedFrom } from '../../../../../../shared/agent-session/view/revised-in-place-lists'
import { stageBesideStreamedText } from '../../../../../../shared/agent-session/view/structured-agent-session-streamed-text-rows'
import { withSubscriberLiveText } from '../../../../../main/native-chat/agent-session-wire/publication/subscribers/agent-session-subscriber-live-text'
import { buildNativeChatTranscript } from './native-chat-transcript-slots'
import { createNativeChatStreamedTranscript, withStreamedRows } from './native-chat-transcript-streamed-slots'

const counted = <T extends object>(list: T[]) => {
  const c = { n: 0 }
  const p = new Proxy(list, { get(t, k, r) { if (typeof k === 'string' && /^\d+$/.test(k)) c.n++; return Reflect.get(t, k, r) } })
  return { p, c }
}
const msg = (id: string, role: any, text: string, extra = {}): NativeChatMessage => ({ id, role, blocks: [{ type: 'text', text }], timestamp: 1, source: 'transcript', ...extra }) as any

it('bench', () => {
  // 18484
  for (const N of [1024, 10240]) {
    let emitted: any
    let rowVisits = 0
    const c = createStructuredAgentSessionEventCoalescer((e) => (emitted = e), { visibility: { hidden: () => true, subscribeShown: () => () => {} } })
    const t0 = performance.now()
    for (let i = 0; i < N; i++) {
      const items = [{ itemId: `r${i}`, revision: 1, sequence: i, observedAt: 1, body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'x' }] } }]
      c.push({ type: 'batch', sessionId: 's', batch: { cursor: { epoch: 'e', seq: i }, items, removedItemIds: [], submissions: [] } } as any)
    }
    const pushMs = performance.now() - t0
    c.flush()
    console.log(`18484 N=${N} hidden pushes: ${pushMs.toFixed(1)} ms, flushed rows=${emitted.batch.items.length}`)
    void rowVisits
  }
  // 18485
  const rows: NativeChatMessage[] = []
  for (let t = 0; t < 50; t++) { rows.push(msg(`ask-${t}`, 'user', 'q')); rows.push(msg(`ans-${t}`, 'assistant', 'a')) }
  rows.push(msg('ask-live', 'user', 'go'))
  const M = 2000
  for (let i = 0; i < M; i++) {
    rows.push(i % 2 === 0 ? ({ id: `call-${i}`, role: 'assistant', blocks: [{ type: 'tool-call', name: 'Read', input: { path: `${i}` } }], timestamp: 1, source: 'transcript' } as any) : msg(`th-${i}`, 'reasoning', 'T', { state: 'running' }))
  }
  const input = { turnKeys: rows.map((_, i) => (i >= 100 ? 'live' : `t${i >> 1}`)), liveTurnKey: 'live', receipts: new Map(), turnStatuses: { active: null, completedByTurn: {} }, turnDiffs: new Map(), expandedTurnKeys: new Set<string>(), isWorking: true, lifecycleWorking: true }
  const project = createNativeChatStreamedTranscript()
  project(input as any, rows, rows)
  let text = 'T'
  let hits = 0
  let out: any
  for (let w = 0; w < 10; w++) {
    text += ' more'
    const next = [...rows.slice(0, -1), { ...rows.at(-1)!, blocks: [{ type: 'text', text }] }]
    out = project(input as any, rows, next)
    const run = out.slots.find((s: any) => s.workRun)?.workRun
    if (run && positionsRevisedFrom(run, stageBesideStreamedText(run))) hits++
  }
  const run = out.slots.find((s: any) => s.workRun)?.workRun
  console.log(`18485 M=${run?.length} run reader indexed lookups hit ${hits}/10 windows (miss = full M walk per window)`)
  // 18487
  const saved = rows.slice(0, 1000)
  const built = buildNativeChatTranscript({ ...(input as any), turnKeys: input.turnKeys.slice(0, 1000), messages: saved })
  const { p, c } = counted(saved)
  withStreamedRows(built.slots, p, p)
  console.log(`18487 N=1000 self-compare index reads: ${c.n}`)
  // 18488
  const items = Array.from({ length: 200 }, (_, i) => ({ itemId: `i${i}`, revision: 1, sequence: i, observedAt: 1, body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'x' }] } })) as any[]
  const ip = counted(items)
  withSubscriberLiveText(ip.p, () => [], (item: any) => ({ item, bytes: 1 }))
  console.log(`18488 200-row snapshot, no sink: row reads for ID set: ${ip.c.n}`)
})
