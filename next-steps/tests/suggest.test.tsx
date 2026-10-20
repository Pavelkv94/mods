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

test('after a main turn the band shows three buttons; a press submits and clears', async ($, on) => {
  const asked: string[] = []
  const submitted: string[] = []
  const origins: unknown[] = []
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
    origins.push(e.origin)
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

  expect(submitted).toContain('Запусти claude plugin test и покажи итог.')
  // Отправлено как слова пользователя — без рамки «plugin sent a message».
  expect(origins).toContainEqual({ kind: 'plugin', name: 'next-steps', asUser: true })
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
