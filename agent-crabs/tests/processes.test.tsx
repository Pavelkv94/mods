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

type Call = { tool: string; task_id?: string }

test('Stop asks once more, can be taken back, and stops the process with TaskStop', async ($, on) => {
  mock.clock(on, { now: 80_000_000 })
  const calls: Call[] = []
  on('tool.call', (_$, e) => {
    calls.push(e as unknown as Call)
    if (e.tool === 'Bash') return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } } as never
    return { result: { message: 'stopped', task_id: 'bg1', task_type: 'local_bash' } } as never
  })

  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm run dev', description: 'Dev server', run_in_background: true } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'stop:bg1' })
    expect(await ui.find({ type: 'Text', text: /Stop it\?/ })).toBeDefined()
    await ui.press({ key: 'keep:bg1' })
    expect(await ui.find({ type: 'Text', text: /Stop it\?/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /running in background/ })).toBeDefined()
    await ui.unmount()
  }
  expect(calls.filter(call => call.tool === 'TaskStop')).toHaveLength(0)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'stop:bg1' })
  await ui.press({ key: 'stop:bg1' })
  expect(calls.filter(call => call.tool === 'TaskStop').map(call => call.task_id)).toEqual(['bg1'])
  expect(await ui.find({ type: 'Text', text: /■ stopped/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /running in background/ })).toBeUndefined()
  await ui.unmount()
})

test('an ended process folds its command behind ▸', async ($, on) => {
  mock.clock(on, { now: 81_000_000 })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'r1' } }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)

  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'cd web && npm run dev', description: 'Web dev server', run_in_background: true } as never)
  await $.prompt.submit({
    text: '<task-notification><task-id>r1</task-id><status>failed</status><summary>exit code 1</summary></task-notification>',
    origin: { kind: 'task-notification' },
  } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /✕ failed.*exit code 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$ cd web/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'stop:r1' })).toBeUndefined()
    await ui.press({ key: 'more:r1' })
    expect(await ui.find({ type: 'Text', text: /\$ cd web && npm run dev/ })).toBeDefined()
    await ui.press({ key: 'more:r1' })
    await ui.unmount()
  }
})
