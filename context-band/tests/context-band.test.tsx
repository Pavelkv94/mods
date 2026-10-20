import { expect, mock, test } from 'claude-code/testing'

import { costText, NO_ACTIVITY, WARM_PROMPT, advise, bandWidth, barSvg, degradation, pieSvg, readPrompt, recordTool, workKind, cacheLeftMs, cacheText, cacheTtlMs, FITS, handoffPath, limitName, meter, pickFit, resetIn, writePrompt } from '../hooks/lib'

type Ctx = { tokens: number; window: number; percent: number }
type Lim = { kind: string; percentUsed: number }

/** The repo's measure hook reads `$.session.usage()`: answer it, then fire a measure. */
async function measure($: any, on: any, context: Ctx, rateLimits: Lim[] = [], usd?: number) {
  const cost = usd === undefined ? undefined : { usd }
  on('session.usage', () => ({ value: { startedAt: 0, context, rateLimits, cost } }))
  on('session.measure', (_$: unknown, e: { changed: unknown }) => ({ changed: e.changed }))
  await $.session.measure({ context, rateLimits, changed: ['context', 'rateLimits'] })
}

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('helpers format meters, limits and the handoff path', () => {
  expect(meter(50, 4)).toEqual({ filled: '██', empty: '░░' })
  expect(meter(100, 3)).toEqual({ filled: '███', empty: '' })
  expect(barSvg(50, 'success')).toContain('width="28"')
  expect(pieSvg(0, 'success')).not.toContain('<path')
  expect(pieSvg(25, 'success')).toContain(' 0 0 1 13.50 7.00Z')
  expect(pieSvg(100, 'success').match(/<circle/g)).toHaveLength(2)
  expect(readPrompt('/h.md')).toContain('`/h.md`')
  expect(writePrompt('/b.md', '/x')).toContain('CLEARED')
  expect(writePrompt('/b.md', '/x')).toContain('Resume here')
  expect(writePrompt('/b.md', '/x', '/a.md')).toContain('earlier handoff of this work is at `/a.md`')
  expect(writePrompt('/b.md', '/x')).not.toContain('An earlier handoff')
  const now = Date.parse('2026-10-15T10:00:00Z')
  expect(limitName('five_hour')).toBe('5h')
  expect(resetIn('2026-10-15T12:30:00Z', now)).toBe('2h 30m')
  const path = handoffPath('/Users/me', '/Users/me/code/My App', now)
  expect(path.startsWith('/Users/me/.claude/handoffs/My-App/2026-10-15_')).toBe(true)
  expect(writePrompt(path, '/x')).toContain(path)
})

test('cache helpers count down from the last response', () => {
  expect(cacheTtlMs(true)).toBe(3_600_000)
  expect(cacheTtlMs(false)).toBe(300_000)
  expect(cacheLeftMs(null, 3_600_000, 0)).toBeNull()
  expect(cacheText(cacheLeftMs(0, 3_600_000, 18 * 60_000), false)).toBe('42m')
  expect(cacheText(cacheLeftMs(0, 300_000, 270_000), false)).toBe('<1m')
  expect(cacheText(cacheLeftMs(0, 300_000, 400_000), false)).toBe('cold')
  expect(cacheText(null, true)).toBe('active')
})

test('advice picks the most pressing tip', () => {
  const now = Date.parse('2026-10-19T10:00:00Z')
  const base = { percent: 30, tokens: 60_000, window: 200_000, limits: [], ttl: 3_600_000, now }
  expect(advise({ ...base, cacheLeft: 30 * 60_000 })).toBeNull()
  expect(advise({ ...base, cacheLeft: 4 * 60_000 })?.text).toContain('Handoff сейчас')
  expect(advise({ ...base, tokens: 10_000, cacheLeft: 4 * 60_000 })?.text).not.toContain('Handoff')
  expect(advise({ ...base, cacheLeft: 0 })?.text).toContain('Кэш остыл')
  expect(advise({ ...base, tokens: 10_000, cacheLeft: 0 })).toBeNull()
  expect(advise({ ...base, percent: 90, cacheLeft: 30 * 60_000 })?.tone).toBe('hot')
  expect(advise({ ...base, percent: 65, cacheLeft: 30 * 60_000 })?.text).toContain('пока кэш тёплый')
  // a 1M window: the percent is low, the token count and the work are what matter
  const wide = { ...base, window: 1_000_000, cacheLeft: 30 * 60_000 }
  expect(advise({ ...wide, percent: 18, tokens: 180_000 })?.tone).toBe('info')
  expect(advise({ ...wide, percent: 30, tokens: 300_000 })?.tone).toBe('warn')
  expect(advise({ ...wide, percent: 10, tokens: 100_000 })).toBeNull()
  expect(advise({ ...base, cacheLeft: null, limits: [{ kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-19T11:00:00Z' }] })?.text)
    .toContain('Лимит 5h 92%, сброс через 1h')
})

test('degradation depends on the kind of work and its symptoms', () => {
  let code = NO_ACTIVITY
  for (let i = 0; i < 6; i++) code = recordTool(code, 'Edit', { file_path: `/p/f${i}.ts` }, false)
  for (let i = 0; i < 4; i++) code = recordTool(code, 'Bash', { command: 'npm test' }, false)
  expect(workKind(code)).toBe('code')
  let research = NO_ACTIVITY
  for (let i = 0; i < 12; i++) research = recordTool(research, i % 2 ? 'WebFetch' : 'Read', { file_path: `/d/${i}.md` }, false)
  expect(workKind(research)).toBe('research')
  expect(workKind(NO_ACTIVITY)).toBe('chat')

  // the same 210k: past the line for code, still fresh for reading
  expect(degradation(210_000, code)?.tone).toBe('warn')
  expect(degradation(210_000, code)?.text).toContain('работа с кодом (6 правок, 4 запусков)')
  expect(degradation(210_000, research)).toBeNull()
  expect(degradation(130_000, code)?.tone).toBe('info')

  // re-reading one file and repeating a failing command are symptoms
  let sick = code
  for (let i = 0; i < 5; i++) sick = recordTool(sick, 'Read', { file_path: '/p/lib.ts' }, false)
  for (let i = 0; i < 3; i++) sick = recordTool(sick, 'Bash', { command: 'npm run build' }, true)
  expect(sick.hotFile).toEqual({ path: '/p/lib.ts', count: 5 })
  expect(sick.repeatFails).toBe(2)
  expect(degradation(70_000, sick)?.tone).toBe('warn')
  expect(degradation(70_000, sick)?.text).toContain('lib.ts прочитан 5 раз')
  expect(degradation(130_000, sick)?.tone).toBe('hot')
  // in a small context the same moves are ordinary work
  expect(degradation(30_000, sick)).toBeNull()
})

test('band picks the richest layout that fits the columns', () => {
  const now = Date.parse('2026-10-15T10:00:00Z')
  const u = {
    percent: 60, tokens: 120_000, window: 200_000,
    limits: [
      { kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-15T12:30:00Z' },
      { kind: 'seven_day', percentUsed: 71, resetsAt: '2026-10-18T10:00:00Z' },
    ],
  }
  expect(pickFit(200, u, now, true)).toBe(FITS[0]!)
  for (const cols of [140, 120, 100, 80, 70]) {
    const fit = pickFit(cols, u, now, true)
    expect(bandWidth(fit, u, now, true)).toBeLessThanOrEqual(cols)
  }
  expect(bandWidth(FITS[FITS.length - 1]!, u, now, true)).toBeLessThanOrEqual(70)
})

test('desktop band draws SVG bars with plain labels', async ($, on) => {
  mock.clock(on)
  await measure($, on, { tokens: 120_000, window: 200_000, percent: 60 }, [{ kind: 'five_hour', percentUsed: 30 }])
  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'desktop', ...BAND })
  const all = (await ui.findAll({})).map(el => el.text ?? '').join(' ')
  for (const s of ['Context', '60%', '120k / 200k', '5h', '30%', 'Cache']) expect(all).toContain(s)
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(3)
  expect(all).not.toMatch(/[◔◑◕↻●]/)
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  if (surface === 'terminal') test(`narrow band drops detail and shortens the button (${surface})`, async ($, on) => {
    mock.clock(on)
    await measure($, on, { tokens: 120_000, window: 200_000, percent: 60 }, [{ kind: 'five_hour', percentUsed: 30 }, { kind: 'seven_day', percentUsed: 71 }])
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND, props: { ...BAND.props, bodyColumns: 70 } })
    const all = (await ui.findAll({})).map(el => el.text ?? '').join(' ')
    for (const s of ['60%', '5h', '30%', '71%']) expect(all).toContain(s)
    expect(all).not.toContain('Context')
    expect(all).toContain('120k/200k')
    expect(await ui.find({ key: 'smart-compact' })).toBeDefined()
    expect(all).toContain('✦ Handoff')
    const bars = (await ui.findAll({ type: 'Text' })).filter(el => /^█+$/.test(el.text ?? ''))
    expect(bars.length).toBeGreaterThanOrEqual(1)
    await ui.unmount()
  })

  test(`band shows context, limits, session cost and the button (${surface})`, async ($, on) => {
    mock.clock(on)
    await measure($, on, { tokens: 120_000, window: 200_000, percent: 60 }, [{ kind: 'five_hour', percentUsed: 30 }, { kind: 'seven_day', percentUsed: 71 }], 0.514)
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    const all = (await ui.findAll({})).map(el => el.text ?? '').join(' ')
    for (const s of ['Context', '60%', '120k', '200k', '5h', '30%', '7d', '71%', '$0.51']) expect(all).toContain(s)
    expect(all).not.toContain('Spent')
    expect(await ui.find({ key: 'smart-compact' })).toBeDefined()
    await ui.unmount()
  })

  test(`band hides the cost where the host keeps no ledger (${surface})`, async ($, on) => {
    mock.clock(on)
    await measure($, on, { tokens: 120_000, window: 200_000, percent: 60 })
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    const all = (await ui.findAll({})).map(el => el.text ?? '').join(' ')
    expect(all).not.toContain('$')
    await ui.unmount()
  })

  test(`Handoff: handoff prompt, /clear once the file is written, then read prompt (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-15T10:00:00Z') })
    const submitted: string[] = []
    const ran: string[] = []
    on('session.root', () => ({ value: '/Users/me/code/demo' }))
    on('env.get', () => ({ value: '/Users/me' }))
    on('ui.toast', () => ({ value: undefined }))
    on('fs.stat', () => ({ value: { kind: 'file', size: 4000, mtimeMs: 0, isLink: false } }) as never)
    on('prompt.submit', (_$, e) => (submitted.push(e.text), { text: e.text }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('command.run', { command: 'clear' }, (_$, e) => (ran.push(e.command), { text: '' }))
    on('command.run', { command: 'compact' }, (_$, e) => (ran.push(e.command), { text: '' }))

    await measure($, on, { tokens: 20_000, window: 200_000, percent: 10 })
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    await ui.press({ key: 'smart-compact' })

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('/Users/me/.claude/handoffs/demo/')
    expect(await ui.find({ key: 'smart-compact' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Writing handoff/ })).toBeDefined()

    const done = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
    await $.turn.complete(done)
    await clock.settle()
    expect(ran).toEqual(['clear'])
    expect(submitted).toHaveLength(2)
    expect(submitted[1]).toContain('read it in full')

    await $.turn.complete({ ...done, turnId: 't2' })
    await clock.settle()
    expect(await ui.find({ key: 'smart-compact' })).toBeDefined()

    // the next handoff builds on the one the fresh context read
    const first = submitted[0]!.match(/`([^`]+\.md)`/)![1]!
    await clock.advance(60_000)
    await ui.press({ key: 'smart-compact' })
    expect(submitted[2]).toContain(`earlier handoff of this work is at \`${first}\``)
    await ui.unmount()
  })

  test(`Handoff never clears without a written file (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-15T10:00:00Z') })
    const submitted: string[] = []
    const ran: string[] = []
    const toasts: string[] = []
    on('session.root', () => ({ value: '/Users/me/code/demo' }))
    on('env.get', () => ({ value: '/Users/me' }))
    on('ui.toast', (_$, e) => (toasts.push(String(e.text ?? e)), { value: undefined }))
    on('fs.stat', () => { throw new Error('ENOENT') })
    on('prompt.submit', (_$, e) => (submitted.push(e.text), { text: e.text }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('command.run', { command: 'clear' }, (_$, e) => (ran.push(e.command), { text: '' }))

    await measure($, on, { tokens: 20_000, window: 200_000, percent: 10 })
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    await ui.press({ key: 'smart-compact' })
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()
    expect(ran).toEqual([])
    expect(submitted).toHaveLength(1)
    expect(toasts.some(t => /NOT cleared/.test(t))).toBe(true)
    expect(await ui.find({ key: 'smart-compact' })).toBeDefined()

    // an interrupted write clears nothing either
    await ui.press({ key: 'smart-compact' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't2', reason: 'answer' })
    await clock.settle()
    expect(ran).toEqual([])
    await ui.unmount()
  })

  test(`the band warns of a straining context from the tools used (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-19T10:00:00Z') })
    const toasts: string[] = []
    on('ui.toast', (_$, e) => (toasts.push(String(e.text ?? e)), { value: undefined }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('tool.call', () => ({ result: {}, isError: false }) as never)
    await measure($, on, { tokens: 210_000, window: 1_000_000, percent: 21 })
    for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Edit', file_path: `/p/f${i}.ts`, old_string: 'a', new_string: 'b' } as never)
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'opus' }
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', usage })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /работа с кодом.*Handoff/ })).toBeDefined()
    expect(toasts.filter(t => /работа с кодом/.test(t))).toHaveLength(1)
    // the same level is announced once
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', usage })
    await clock.settle()
    expect(toasts.filter(t => /работа с кодом/.test(t))).toHaveLength(1)
    await ui.unmount()
  })

  test(`Warm sends a one-word turn (${surface})`, async ($, on) => {
    mock.clock(on)
    const submitted: string[] = []
    on('prompt.submit', (_$, e) => (submitted.push(e.text), { text: e.text }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await measure($, on, { tokens: 20_000, window: 200_000, percent: 10 })
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    // no response yet: nothing to keep warm
    expect(await ui.find({ key: 'keep-warm' })).toBeUndefined()
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'opus' }
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', usage })
    await ui.press({ key: 'keep-warm' })
    expect(submitted).toEqual([WARM_PROMPT])
    await ui.unmount()
  })

  test(`cache countdown: warm after a turn, warns, then cold (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-19T10:00:00Z') })
    const toasts: string[] = []
    on('ui.toast', (_$, e) => (toasts.push(String(e.text ?? e)), { value: undefined }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('session.start', () => ({ sessionId: 's1', cwd: '/x' }) as never)
    await measure($, on, { tokens: 20_000, window: 200_000, percent: 10 }, [{ kind: 'five_hour', percentUsed: 5 }])
    await $.session.start({ source: 'startup', cwd: '/x' } as never)
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: '—' })).toBeDefined()

    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'opus' }
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', usage })
    expect(await ui.find({ type: 'Text', text: '60m' })).toBeDefined()

    await clock.advance(56 * 60_000)
    expect(await ui.find({ type: 'Text', text: '4m' })).toBeDefined()
    expect(toasts.some(t => /cools in/.test(t))).toBe(true)
    expect(await ui.find({ type: 'Text', text: /сохранить его/ })).toBeDefined()

    await clock.advance(5 * 60_000)
    expect(await ui.find({ type: 'Text', text: 'cold' })).toBeDefined()
    expect(await ui.find({ key: 'keep-warm' })).toBeUndefined()
    await ui.unmount()
  })
}

test('cost reads in dollars and the band still fits with it', () => {
  expect(costText(0)).toBe('$0.00')
  expect(costText(0.003)).toBe('<$0.01')
  expect(costText(0.514)).toBe('$0.51')
  expect(costText(12.4)).toBe('$12.40')
  expect(costText(153.6)).toBe('$154')
  const now = Date.parse('2026-10-15T10:00:00Z')
  const u = {
    percent: 60, tokens: 120_000, window: 200_000, cost: 12.4,
    limits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-15T12:30:00Z' }],
  }
  expect(bandWidth(FITS[0]!, u, now, true)).toBeGreaterThan(bandWidth(FITS[0]!, { ...u, cost: null }, now, true))
  for (const cols of [140, 100, 80]) expect(bandWidth(pickFit(cols, u, now, true), u, now, true)).toBeLessThanOrEqual(cols)
})
