import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-crabs',
  component: 'Pane',
  requestId: 'agent-crabs',
  props: { title: 'Agents & processes', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

test('one press of Clear finished drops ended agents and ended processes together', async ($, on) => {
  mock.clock(on, { now: 70_000_000 })
  on('tool.call', (_$, e) =>
    e.tool === 'Bash' ? ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'p1' } } as never) : ({ result: 'ok' } as never),
  )
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('turn.complete', () => ({ text: '' }))

  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', agentId: 'ag1', file_path: '/a.ts' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', agentId: 'ag1', reason: 'answer' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'sleep 1', description: 'Short job', run_in_background: true } as never)
  await $.prompt.submit({
    text: '<task-notification><task-id>p1</task-id><status>completed</status></task-notification>',
    origin: { kind: 'task-notification' },
  } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'desktop') {
      expect(await ui.find({ type: 'Text', text: /Short job/ })).toBeDefined()
      await ui.press({ key: 'clear' })
    }
    expect(await ui.find({ type: 'Text', text: /Short job/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /✓ done/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'clear' })).toBeUndefined()
    await ui.unmount()
  }
})
