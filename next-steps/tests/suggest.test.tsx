import { expect, test } from 'claude-code/testing'

import { parseSuggestions } from '../hooks/register'

const BAND = {
  plugin: 'next-steps',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 140, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const REPLY = `Вот варианты:
[{"label":"Добавить тест","prompt":"Добавь тест на agent.spawn."},
 {"label":"Запустить проверку","prompt":"Запусти claude plugin test и покажи итог."},
 {"label":"Другой цвет краба","prompt":"Сделай цвет краба зависящим от роли агента."},
 {"label":"Лишний","prompt":"Четвёртый вариант"}]`

test('parse keeps three distinct suggestions and ignores junk', () => {
  expect(parseSuggestions(REPLY).map(s => s.label)).toEqual([
    'Добавить тест',
    'Запустить проверку',
    'Другой цвет краба',
  ])
  expect(parseSuggestions('no json here')).toEqual([])
  expect(parseSuggestions('[{"label":"a","prompt":"x"},{"label":"b","prompt":"X"}]').length).toBe(1)
})

test('after a main turn the band shows three buttons; a press fills the prompt box', async ($, on) => {
  const asked: string[] = []
  const submitted: string[] = []
  const filled: string[] = []
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length } as never
  })
  on('model.complete', (_$, e) => {
    asked.push(e.model)
    return { value: { isAnswered: true, text: REPLY, usage: { input_tokens: 1, output_tokens: 1 } } } as never
  })
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'Сделай мод с крабами', toolUses: [] },
      { role: 'assistant', text: 'Готово, тесты проходят.', toolUses: [] },
    ],
  }))
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })

  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  // Подбор идёт в фоне — ждём, пока появятся кнопки.
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  for (let i = 0; i < 200 && !(await ui.find({ type: 'Button', key: 's1' })); i++) {
    await ui.unmount()
    ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  }
  const button = await ui.find({ type: 'Button', key: 's1' })
  expect(button?.props.label).toBe('Запустить проверку')
  // Рядом с кнопкой — полный текст промпта.
  expect((await ui.find({ type: 'Box', key: 'row1' }))?.text).toContain('Запусти claude plugin test и покажи итог.')
  expect(await ui.find({ type: 'Button', key: 's3' })).toBeUndefined()
  expect(asked).toEqual(['haiku'])
  await ui.press({ key: 's1' })
  await ui.unmount()

  // Вариант лёг в поле ввода, а не ушёл сам: Enter нажимает пользователь.
  expect(filled).toEqual(['Запусти claude plugin test и покажи итог.'])
  expect(submitted).toEqual([])
})

test('with no prompt box a press submits as the user', async ($, on) => {
  const origins: unknown[] = []
  on('model.complete', () => ({ value: { isAnswered: true, text: REPLY, usage: {} } }) as never)
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Привет', toolUses: [] }] }))
  on('prompt.fill', () => ({ isFilled: false, refusal: 'no_composer', text: '', cursor: 0 }) as never)
  on('prompt.submit', (_$, e) => {
    origins.push(e.origin)
    return { text: e.text } as never
  })

  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  for (let i = 0; i < 200 && !(await ui.find({ type: 'Button', key: 's0' })); i++) {
    await ui.unmount()
    ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  }
  await ui.press({ key: 's0' })
  await ui.unmount()
  expect(origins).toContainEqual({ kind: 'plugin', name: 'next-steps', asUser: true })
})

test('the system prompt explains that next-steps messages are the user\'s choice', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }) as never)
  const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
  expect(sections.map(s => s.id)).toEqual(['intro', 'next-steps:choice'])
})

test('a subagent turn does not ask for suggestions', async ($, on) => {
  const asked: string[] = []
  on('model.complete', (_$, e) => {
    asked.push(e.model)
    return { value: { isAnswered: true, text: REPLY, usage: {} } } as never
  })
  on('turn.complete', () => ({ text: 'ok' }))
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' } as never)
  expect(asked).toEqual([])
})

test('in a terminal-only session there are no suggestions and no band', async ($, on) => {
  const asked: string[] = []
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  on('model.complete', (_$, e) => {
    asked.push(e.model)
    return { value: { isAnswered: true, text: REPLY, usage: {} } } as never
  })
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Привет', toolUses: [] }] }))
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't3', reason: 'answer' } as never)
  for (let i = 0; i < 50; i++) await Promise.resolve()
  expect(asked).toEqual([])
})

test('with the app attached the buttons show in the app but not in the terminal', async ($, on) => {
  on('session.surfaces', () => ({ value: ['terminal', 'desktop'] }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: REPLY, usage: {} } }) as never)
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Привет', toolUses: [] }] }))
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't4', reason: 'answer' } as never)
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  for (let i = 0; i < 200 && !(await ui.find({ type: 'Button', key: 's0' })); i++) {
    await ui.unmount()
    ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  }
  expect(await ui.find({ type: 'Button', key: 's0' })).toBeDefined()
  await ui.unmount()
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Button', key: 's0' })).toBeUndefined()
  await term.unmount()
})
