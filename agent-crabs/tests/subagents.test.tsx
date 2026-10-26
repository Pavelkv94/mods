import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-crabs',
  component: 'Pane',
  requestId: 'agent-crabs',
  props: {
    title: 'Agents & processes',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

const NONE: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

async function step($: Engine, model: string, agentId?: string, effort?: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model, messageCount: 1, ...(agentId ? { agentId } : {}), ...(effort ? { effort } : {}) } as never)
  for await (const _ of stream) {
    // drain
  }
}

// each step answers with the usage the test sets for its model
function answer(on: Parameters<Parameters<typeof test>[1]>[1], usage: Record<string, Usage>) {
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { model: e.model, ...(usage[e.model] ?? NONE) },
    } as never
  })
}

test('a subagent context fill reads against the window the engine measured', async ($, on) => {
  mock.clock(on, { now: 70_000_000 })
  answer(on, { 'claude-opus-5-5': { ...NONE, input_tokens: 1_000, cache_read_input_tokens: 99_000 } })
  on('session.measure', (_$, e) => ({ changed: e.changed }) as never)

  await step($, 'claude-opus-5-5', 's1')
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /ctx 100k\/1M · 10%/ })).toBeDefined()
  await ui.unmount()

  await $.session.measure({ context: { tokens: 50_000, window: 200_000, percent: 25 }, rateLimits: [], changed: ['context'] } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /ctx 100k\/200k · 50%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /main/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a long Haiku 5.5 prompt costs five times, and an hour-long cache write twice the input', async ($, on) => {
  mock.clock(on, { now: 71_000_000 })
  answer(on, {
    'claude-haiku-5-5': { ...NONE, input_tokens: 400_000 },
    'claude-sonnet-5-5': { ...NONE, cache_creation_input_tokens: 1_000_000 },
  })
  on('tool.call', () => ({
    result: {
      agentId: 'c1',
      content: [],
      totalToolUseCount: 0,
      totalDurationMs: 1,
      totalTokens: 1,
      usage: { cache_creation: { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 0 }, speed: 'standard' },
    },
  }) as never)

  // 400k in × $0.10 × 5, per million
  await step($, 'claude-haiku-5-5', 'h1')
  // 1M written × $2: × 1.25 while its lifetime is unknown, × 2 once the record says an hour
  await step($, 'claude-sonnet-5-5', 'c1')

  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\$0\.200/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$2\.50/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Agent', tool_use_id: 'ag1', prompt: 'x', description: 'x', subagent_type: 'Explore' } as never)

  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\$4\.00/ })).toBeDefined()
  await ui.press({ key: 'more:c1' })
  expect(await ui.find({ type: 'Text', text: /100% of cache writes kept 1h/ })).toBeDefined()
  await ui.unmount()
})

test('a child sits under its parent, a quiet parent is flagged once no child works, an ended card keeps its frame', async ($, on) => {
  const clock = mock.clock(on, { now: 72_000_000 })
  on('agent.spawn', (_$, e) => ({ agentId: e.description === 'Parent task' ? 'p1' : 'k1', model: 'claude-sonnet-5-5' }) as never)
  on('turn.complete', () => ({ text: '' }))
  answer(on, {})

  await $.agent.spawn({ prompt: 'a', description: 'Parent task', subagentType: 'general-purpose' } as never)
  await $.agent.spawn({ prompt: 'b', description: 'Child task', subagentType: 'Explore', parentAgentId: 'p1' } as never)
  await clock.advance(100_000)
  await step($, 'claude-sonnet-5-5', 'k1')

  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // its child still works: the parent only waits
  expect(await ui.find({ type: 'Text', text: /thinking… 1:40/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⚠ quiet/ })).toBeUndefined()
  await ui.unmount()

  await $.turn.complete({ answer: 'Found 3 routes', durationMs: 1, isAborted: false, turnId: 'k', agentId: 'k1', reason: 'answer' } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /⚠ quiet 1:40/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↳ Explore/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✓ done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 step · 0 tools/ })).toBeDefined()
    // the card stops above its result until opened
    expect(await ui.find({ type: 'Text', text: /Found 3 routes/ })).toBeUndefined()
    await ui.press({ key: 'more:k1' })
    expect(await ui.find({ type: 'Text', text: /RESULT/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Found 3 routes/ })).toBeDefined()
    await ui.press({ key: 'more:k1' })
    await ui.unmount()
  }
})
