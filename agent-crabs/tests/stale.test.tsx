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
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// Its own file: the module has not yet seen an engine task list, so the timeout applies.
test('with no task list, a process unheard of goes stale, and a later list brings a live one back', async ($, on) => {
  const clock = mock.clock(on, { now: 50_000_000 })
  on('command.register', () => ({ value: { command: 'crabs' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.start', (_, e) => ({ cwd: (e as { cwd: string }).cwd }) as never)
  on('tool.call', (_$, e) => {
    if (e.tool === 'Monitor') return { result: { taskId: 'mon', timeoutMs: 60_000 } } as never
    const id = (e as unknown as { backgroundTaskId: string }).backgroundTaskId
    return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id } } as never
  })
  on('agent.list', () => ({ value: [] }) as never)
  on('classic.Stop', () => ({}))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'a', command: 'sleep 1', description: 'Forgotten job', run_in_background: true, backgroundTaskId: 's1' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'npm run dev', description: 'Dev server', run_in_background: true, backgroundTaskId: 's2' } as never)
  await $.tool.call({ tool: 'Monitor', tool_use_id: 'c', command: 'tail -f log', description: 'Short watch', timeout_ms: 60_000 } as never)

  // the Monitor's own deadline ends it
  await clock.advance(80_000)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /✓ finished.*monitor deadline passed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /bg 2\/3/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(20 * 60_000)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /no word/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /running in background/ })).toBeUndefined()
  await ui.unmount()

  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 's2', type: 'shell', status: 'running', description: 'Dev server', command: 'npm run dev' }],
  } as never)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /running in background/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /no word/ })).toBeUndefined()
  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Text', text: /Forgotten job/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Dev server/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /bg 1\/1/ })).toBeDefined()
  await ui.unmount()
})
