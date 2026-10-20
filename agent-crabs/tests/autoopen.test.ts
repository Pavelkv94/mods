import { expect, test } from 'claude-code/testing'

test("the person's prompt opens the pane, a notification does not", async ($, on) => {
  const opens: string[] = []
  on('ui.open', (_$, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)

  await $.prompt.submit({ text: '<task-notification/>', origin: { kind: 'task-notification' } } as never)
  expect(opens).toEqual([])

  await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' } } as never)
  expect(opens).toEqual(['agent-crabs'])
})

test('/crabs says why the pane is not placed', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }) as never)

  const ran = await $.command.run({ command: 'crabs', args: '' } as never)
  expect((ran as { text: string }).text).toMatch(/not placed: no-surface/)
})
