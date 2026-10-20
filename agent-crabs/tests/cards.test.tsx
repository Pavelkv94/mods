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
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('a subagent card shows the file it reads, then turns done', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const seen: string[] = []
  on('tool.call', async () => {
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const badge = await ui.find({ type: 'Text', text: /reading · Read/ })
      seen.push(`${surface}:${badge ? 'read' : 'none'}`)
      const path = await ui.find({ type: 'Text', text: /deep\/nested\/file\.ts/ })
      seen.push(`${surface}:${path ? 'path' : 'nopath'}`)
      await ui.unmount()
    }
    return { result: 'ok' }
  })
  on('turn.complete', () => ({ text: 'done' }))

  await $.tool.call({
    tool: 'Read',
    tool_use_id: 'tu1',
    agentId: 'agent-1',
    file_path: '/Users/me/project/src/deep/nested/file.ts',
  } as never)

  await $.turn.complete({
    answer: 'done',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    agentId: 'agent-1',
    reason: 'answer',
  } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /✓ done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 step · 1 tool|0 steps · 1 tool/ })).toBeDefined()
    await ui.unmount()
  }

  expect(seen).toContain('desktop:read')
  expect(seen).toContain('desktop:path')
  expect(seen).toContain('terminal:read')
})

test('tokens add new input only, and a resumed agent runs again', async ($, on) => {
  const clock = mock.clock(on, { now: 5_000_000 })
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: 'claude-sonnet-5-5',
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10_000,
        cache_creation_input_tokens: 900,
      },
    } as never
  })
  on('turn.complete', () => ({ text: 'done' }))

  const step = async (index: number) => {
    const stream = $.turn.step({ turnId: 't', index, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1, agentId: 'a2' } as never)
    for await (const _ of stream) {
      // drain
    }
  }
  await step(0)
  await step(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // 200 in · 100 out · 1.8k cache write · 20k cache read at Sonnet 5.5's list price
  expect(await ui.find({ type: 'Text', text: /\$0\.0099/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Sonnet 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Sonnet 5\.5 · high/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a2', reason: 'answer' } as never)
  await clock.advance(60_000)
  await step(2)
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Text', text: /thinking…/ })).toBeDefined()
  expect(await again.find({ type: 'Text', text: /✓ done/ })).toBeUndefined()
  await again.unmount()
})

test('background shell and monitor get cards, end by notification or TaskStop', async ($, on) => {
  mock.clock(on, { now: 30_000_000 })
  on('tool.call', (_$, e) => {
    if (e.tool === 'Bash') return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } } as never
    if (e.tool === 'Monitor') return { result: { taskId: 'mon1', timeoutMs: 0, persistent: true } } as never
    return { result: { message: 'stopped' } } as never
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)

  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm run dev', description: 'Start dev server', run_in_background: true } as never)
  await $.tool.call({ tool: 'Monitor', tool_use_id: 'm1', command: 'tail -f log', description: 'Watch build log', timeout_ms: 1000, agentId: 'ag9' } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Start dev server/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$ npm run dev/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Watch build log/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /running in background/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Background processes/ })).toBeDefined()
    await ui.unmount()
  }

  await $.prompt.submit({
    text: '<task-notification><task-id>bg1</task-id><status>completed</status><summary>Background command finished (exit code 0)</summary></task-notification>',
    origin: { kind: 'task-notification' },
  } as never)
  await $.tool.call({ tool: 'TaskStop', tool_use_id: 's1', task_id: 'mon1' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /✓ finished.*exit code 0/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /■ stopped/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /running in background/ })).toBeUndefined()
  await ui.unmount()
})

const BASH = (id: string) => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id } }) as never

async function startBash($: Engine, id: string, description: string) {
  await $.tool.call({ tool: 'Bash', tool_use_id: `u-${id}`, command: `run ${id}`, description, run_in_background: true, backgroundTaskId: id } as never)
}

test('a notification delivered inside a running turn ends the task', async ($, on) => {
  mock.clock(on, { now: 40_000_000 })
  on('tool.call', (_$, e) => BASH(String((e as unknown as { backgroundTaskId: string }).backgroundTaskId)))
  on('prompt.attachment', (_$, e) => ({ text: e.text }))

  await startBash($, 'in1', 'In-turn job')
  await $.prompt.attachment({
    type: 'queued_command',
    text: '<task-notification>\n<task-id>in1</task-id>\n<status>completed</status>\n<summary>Background command "In-turn job" completed (exit code 0)</summary>\n</task-notification>',
    origin: { kind: 'engine' },
  } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /✓ finished.*exit code 0/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /running in background/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('every task id in one notification is ended, not just the first', async ($, on) => {
  mock.clock(on, { now: 41_000_000 })
  on('tool.call', (_$, e) => BASH(String((e as unknown as { backgroundTaskId: string }).backgroundTaskId)))
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)

  await startBash($, 'm1', 'First job')
  await startBash($, 'm2', 'Second job')
  await startBash($, 'm3', 'Third job')
  await $.prompt.submit({
    text:
      '<task-notification><task-id>m1</task-id><status>completed</status><summary>one done</summary></task-notification>\n' +
      '<task-notification><task-id>m2</task-id><status>failed</status><summary>two failed</summary></task-notification>\n' +
      '<task-notification><shell-id>m3</shell-id><status>killed</status></task-notification>',
    origin: { kind: 'task-notification' },
  } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /✓ finished.*one done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✕ failed.*two failed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /■ stopped/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /running in background/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /bg 0\/3/ })).toBeDefined()
  await ui.unmount()
})

test('a task whose output was read without a notification ends at the stop, a live one stays', async ($, on) => {
  mock.clock(on, { now: 42_000_000 })
  on('tool.call', (_$, e) => BASH(String((e as unknown as { backgroundTaskId: string }).backgroundTaskId)))
  on('classic.Stop', () => ({}))

  await startBash($, 'gone', 'Quick job')
  await startBash($, 'alive', 'Dev server')
  // the model read Quick job's output itself; the engine's stop lists what still runs
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'alive', type: 'shell', status: 'running', description: 'Dev server', command: 'run alive' },
      { id: 'lost', type: 'shell', status: 'running', description: 'Started before reload', command: 'tail -f x' },
    ],
  } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /✓ finished.*not in the engine task list/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Dev server/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Started before reload/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /bg 2\/3/ })).toBeDefined()
    await ui.unmount()
  }
})

test('clearing drops ended entries and keeps the running ones', async ($, on) => {
  mock.clock(on, { now: 43_000_000 })
  on('tool.call', (_$, e) => BASH(String((e as unknown as { backgroundTaskId: string }).backgroundTaskId)))
  on('classic.Stop', () => ({}))

  await startBash($, 'c1', 'Finished job')
  await startBash($, 'c2', 'Still running job')
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'c2', type: 'shell', status: 'running', description: 'Still running job' }],
  } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Text', text: /Finished job/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Still running job/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /bg 1\/1/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent stopped with TaskStop, and one whose result was taken in the turn, stop running', async ($, on) => {
  const clock = mock.clock(on, { now: 44_000_000 })
  on('command.register', () => ({ value: { command: 'crabs' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.start', (_, e) => ({ cwd: (e as { cwd: string }).cwd }) as never)
  let spawned = 0
  on('agent.spawn', () => ({ agentId: `sub${(spawned += 1)}`, model: 'claude-haiku-5-5' }) as never)
  on('tool.call', () => ({ result: { message: 'stopped', task_id: 'sub1', task_type: 'local_agent' } }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('agent.list', () => ({
    value: [
      { id: 'sub1', description: 'Stopped one', type: 'Explore', status: 'killed' },
      { id: 'sub2', description: 'Read in turn', type: 'Explore', status: 'completed' },
    ],
  }) as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ prompt: 'a', description: 'Stopped one', subagentType: 'Explore' } as never)
  await $.agent.spawn({ prompt: 'b', description: 'Read in turn', subagentType: 'Explore' } as never)

  await $.tool.call({ tool: 'TaskStop', tool_use_id: 'ts1', task_id: 'sub1' } as never)
  // the engine may still end the stopped loop as aborted: it stays stopped
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 'x', agentId: 'sub1', reason: 'aborted' } as never)

  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /■ stopped/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /agents 1\/2/ })).toBeDefined()
  await ui.unmount()

  // no turn.complete for sub2 reached the mod: the ticker asks the engine where it stands
  await clock.advance(11_000)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /✓ done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /agents 0\/2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /thinking…/ })).toBeUndefined()
  await ui.unmount()
})
