import { expect, mock, test } from 'claude-code/testing'

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

test('an opened card lists its operations, files, todos and what each token side cost', async ($, on) => {
  mock.clock(on, { now: 60_000_000 })
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'Checking how the routes register their handlers',
      toolUses: [],
      stopReason: 'tool_use',
      usage: {
        model: 'claude-opus-5-5',
        input_tokens: 1_000,
        output_tokens: 1_000,
        cache_read_input_tokens: 100_000,
        cache_creation_input_tokens: 0,
      },
    } as never
  })
  on('tool.call', (_$, e) => (e.tool === 'Bash' ? ({ isError: true, result: 'exit 1' } as never) : ({ result: 'ok' } as never)))

  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'x1' } as never)
  for await (const _ of stream) {
    // drain
  }
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', agentId: 'x1', file_path: '/repo/src/meda/api.ts' } as never)
  await $.tool.call({
    tool: 'Edit',
    tool_use_id: 'e1',
    agentId: 'x1',
    file_path: '/repo/src/meda/api.ts',
    old_string: 'a\nb',
    new_string: 'a\nb\nc\nd',
  } as never)
  await $.tool.call({ tool: 'Write', tool_use_id: 'w1', agentId: 'x1', file_path: '/repo/docs/plan.md', content: '# Plan\n\nstep' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'g1', agentId: 'x1', command: 'npm run lint' } as never)
  await $.tool.call({
    tool: 'TodoWrite',
    tool_use_id: 'td1',
    agentId: 'x1',
    todos: [
      { content: 'Read', status: 'completed', activeForm: 'Reading' },
      { content: 'Edit', status: 'in_progress', activeForm: 'Editing the client' },
      { content: 'Test', status: 'pending', activeForm: 'Testing' },
      { content: 'Ship', status: 'pending', activeForm: 'Shipping' },
    ],
  } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // closed: the todo list drives the bar, the cost shows, the details do not
    expect(await ui.find({ type: 'Text', text: /1\/4 todos · Editing the client/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /25%/ })).toBeDefined()
    // 1k in × $4 + 1k out × $20 + 100k cache read × $0.20, per million
    expect(await ui.find({ type: 'Text', text: /\$0\.044/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /OPERATIONS/ })).toBeUndefined()

    await ui.press({ key: 'more:x1' })
    expect(await ui.find({ type: 'Text', text: /OPERATIONS · 5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /FILES · 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+4 −2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /failed/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Checking how the routes register/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Total · Opus 5\.5/ })).toBeDefined()

    await ui.press({ key: 'more:x1' })
    expect(await ui.find({ type: 'Text', text: /OPERATIONS/ })).toBeUndefined()
    await ui.unmount()
  }
})
