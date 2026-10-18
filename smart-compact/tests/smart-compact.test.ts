import { expect, test } from 'claude-code/testing'

import { bar, handoffPath, limitLabel, meter, writePrompt } from '../hooks/lib'

test('helpers format bars, limits and the handoff path', () => {
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(bar(130, 4)).toBe('████')
  expect(meter(50, 4)).toEqual({ filled: '━━', empty: '━━' })
  expect(meter(25, 2)).toEqual({ filled: '╸', empty: '━' })
  const m = meter(37, 12)
  expect([...m.filled].length + [...m.empty].length).toBe(12)
  const now = Date.parse('2026-10-15T10:00:00Z')
  expect(limitLabel({ kind: 'five_hour', percentUsed: 42.4, resetsAt: '2026-10-15T12:30:00Z' }, now)).toBe('5ч 42% (↻2ч 30м)')
  const path = handoffPath('/Users/me', '/Users/me/code/My App', now)
  expect(path.startsWith('/Users/me/.claude/handoffs/My-App/2026-10-15_')).toBe(true)
  expect(writePrompt(path, '/x')).toContain(path)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band shows context, limits and the button; press starts the handoff (${surface})`, async ($, on) => {
    const submitted: string[] = []
    on('session.usage', () => ({ value: {
      startedAt: 0,
      context: { tokens: 120_000, window: 200_000, percent: 60 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 30 }, { kind: 'seven_day', percentUsed: 71 }],
    } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('command.register', () => ({ value: undefined }) as never)
    on('clock.now', () => ({ value: Date.parse('2026-10-15T10:00:00Z') }))
    on('session.root', () => ({ value: '/Users/me/code/demo' }))
    on('env.get', () => ({ value: '/Users/me' }))
    on('prompt.submit', ($, e) => {
      submitted.push(e.text)
      return { text: e.text }
    })
    await $.session.start({ cwd: '/Users/me/code/demo', source: 'startup' } as never)
    await $.session.measure({
      context: { tokens: 120_000, window: 200_000, percent: 60 },
      rateLimits: [],
      changed: ['context'],
    })

    const ui = await $.ui.mount({ plugin: 'smart-compact', surface, component: 'AbovePrompt', props: {} as never })
    const all = (await ui.findAll({})).map(el => el.text ?? '').join(' ')
    expect(all).toContain('60%')
    expect(all).toContain('5ч')
    expect(all).toContain('30%')
    expect(all).toContain('71%')
    expect(await ui.find({ key: 'smart-compact' })).toBeDefined()

    await ui.press({ key: 'smart-compact' })
    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('/Users/me/.claude/handoffs/demo/')
    expect(await ui.find({ key: 'smart-compact' })).toBeUndefined()
  })
}
