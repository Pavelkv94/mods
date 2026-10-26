import { expect, mock, test } from 'claude-code/testing'

import { costText, NO_ACTIVITY, WARM_PROMPT, advise, bandWidth, barSvg, cacheConfig, curvesFor, degradation, idleLeftMs, mrcrAt, parseModel, pieSvg, ringSvg, readPrompt, recordTool, workKind, cacheLeftMs, cacheText, cacheTtlMs, DEFAULT_CACHE_CONFIG, FITS, handoffPath, limitName, meter, pickFit, resetIn, writePrompt } from '../hooks/lib'

type Ctx = { tokens: number; window: number; percent: number }
type Lim = { kind: string; percentUsed: number }

/** The repo's measure hook reads `$.session.usage()`: answer it, then fire a measure. */
async function measure($: any, on: any, context: Ctx, rateLimits: Lim[] = [], usd?: number) {
  const cost = usd === undefined ? undefined : { usd }
  on('session.usage', () => ({ value: { startedAt: 0, context, rateLimits, cost } }))
  on('session.measure', (_$: unknown, e: { changed: unknown }) => ({ changed: e.changed }))
  await $.session.measure({ context, rateLimits, changed: ['context', 'rateLimits'] })
}

const MSG = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

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
  expect(ringSvg(0, 'success').match(/<circle/g)).toHaveLength(1)
  expect(ringSvg(50, 'success')).toContain('fill="none"')
  expect(ringSvg(50, 'success')).toContain('stroke-dasharray="18.85 37.70"')
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
  expect(cacheTtlMs([{ kind: 'five_hour', percentUsed: 30 }, { kind: 'seven_day', percentUsed: 71 }])).toBe(3_600_000)
  expect(cacheTtlMs([])).toBe(300_000)
  // overage: a used-up plan window drops the subscription to the 5-minute cache
  expect(cacheTtlMs([{ kind: 'five_hour', percentUsed: 100 }, { kind: 'seven_day', percentUsed: 71 }])).toBe(300_000)
  // a gateway's spend limit is API-key billing
  expect(cacheTtlMs([{ kind: 'spend_limit', percentUsed: 10 }])).toBe(300_000)
  expect(cacheLeftMs(null, 3_600_000, 0)).toBeNull()
  expect(cacheText(cacheLeftMs(0, 3_600_000, 18 * 60_000), false)).toBe('42m')
  expect(cacheText(cacheLeftMs(0, 300_000, 270_000), false)).toBe('<1m')
  expect(cacheText(cacheLeftMs(0, 300_000, 400_000), false)).toBe('cold')
  expect(cacheText(null, true)).toBe('active')
})

test('advice picks the most pressing tip', () => {
  const now = Date.parse('2026-10-19T10:00:00Z')
  const base = { percent: 30, tokens: 60_000, window: 200_000, limits: [], ttl: 3_600_000, now, model: 'claude-opus-5' }
  expect(advise({ ...base, cacheLeft: 30 * 60_000 })).toBeNull()
  expect(advise({ ...base, cacheLeft: 4 * 60_000 })?.text).toContain('Handoff сейчас')
  expect(advise({ ...base, tokens: 10_000, cacheLeft: 4 * 60_000 })?.text).not.toContain('Handoff')
  expect(advise({ ...base, cacheLeft: 0 })?.text).toContain('Кэш остыл')
  expect(advise({ ...base, tokens: 10_000, cacheLeft: 0 })).toBeNull()
  // past 256k research degrades, and a cold cache still shows, in one line with the degradation
  let research = NO_ACTIVITY
  for (let i = 0; i < 12; i++) research = recordTool(research, 'Read', { file_path: `/d/${i}.md` }, false)
  const deep = { ...base, tokens: 300_000, window: 1_000_000, activity: research }
  expect(advise({ ...deep, cacheLeft: 30 * 60_000 })?.text).toContain('заметно деградирует')
  expect(advise({ ...deep, cacheLeft: 0 })).toEqual({
    tone: 'warn', kind: 'degrade',
    text: 'Кэш остыл. Исследование, контекст заметно деградирует (~300k): модель хуже связывает факты из разных частей контекста. Сделайте Handoff до следующего сообщения — оно заново запишет ~300k контекста.',
  })
  // symptoms join a cold cache the same way
  let sick = NO_ACTIVITY
  for (let i = 0; i < 6; i++) sick = recordTool(sick, 'Edit', { file_path: `/p/f${i}.ts` }, false)
  for (let i = 0; i < 3; i++) sick = recordTool(sick, 'Bash', { command: 'npm run build' }, true)
  expect(advise({ ...base, tokens: 140_000, activity: sick, cacheLeft: 0 })?.text)
    .toBe('Кэш остыл. Сессия с кодом, признаки деградации: команды падают повторно. Сделайте Handoff до следующего сообщения — оно заново запишет ~140k контекста.')
  expect(advise({ ...base, percent: 90, cacheLeft: 30 * 60_000 })?.tone).toBe('hot')
  // a filling window no longer warns by percent alone: only the measured curve or autocompact does
  expect(advise({ ...base, percent: 65, cacheLeft: 30 * 60_000 })).toBeNull()
  expect(advise({ ...base, cacheLeft: null, limits: [{ kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-19T11:00:00Z' }] })?.text)
    .toContain('Лимит 5h 92%, сброс через 1h')
  // idle compaction comes before the cache cools and is the deadline the tip names
  const idle = advise({ ...base, tokens: 250_000, cacheLeft: 9 * 60_000, idleLeft: 3 * 60_000 })
  expect(idle?.tone).toBe('hot')
  expect(idle?.text).toContain('Через 3 мин простоя')
  expect(idle?.text).toContain('idle compaction')
})

test('cache settings follow Claude Code: env, then settings, then the plan', () => {
  const plan = [{ kind: 'five_hour', percentUsed: 30 }]
  expect(cacheConfig({}, {})).toEqual(DEFAULT_CACHE_CONFIG)
  expect(cacheConfig({ FORCE_PROMPT_CACHING_5M: '1' }, { promptCacheTtl: '1h' }).ttl).toBe('5m')
  expect(cacheConfig({ CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' }, { promptCacheTtl: '5m' }).ttl).toBe('1h')
  expect(cacheConfig({ ENABLE_PROMPT_CACHING_1H: '1' }, { promptCacheTtl: '5m' }).ttl).toBe('5m')
  expect(cacheConfig({ ENABLE_PROMPT_CACHING_1H: 'true' }, {}).ttl).toBe('1h')
  // an explicit choice wins over the plan default, overage included
  expect(cacheTtlMs([], '1h')).toBe(3_600_000)
  expect(cacheTtlMs([{ kind: 'five_hour', percentUsed: 100 }], '1h')).toBe(3_600_000)
  expect(cacheTtlMs(plan, '5m')).toBe(300_000)
  expect(cacheConfig({}, { idleCompaction: false }).idle).toBe(false)
  expect(cacheConfig({}, { autoCompactEnabled: false }).idle).toBe(false)
  expect(cacheConfig({ DISABLE_AUTO_COMPACT: '1' }, {}).idle).toBe(false)
  expect(cacheConfig({ CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '50000' }, {}).idleMin).toBe(100_000)
  expect(cacheConfig({ CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '300000' }, {}).idleMin).toBe(300_000)

  const at = { lastAt: 0, ttl: 3_600_000, tokens: 250_000, config: DEFAULT_CACHE_CONFIG, terminal: true, now: 50 * 60_000 }
  expect(idleLeftMs(at)).toBe(4 * 60_000)
  expect(idleLeftMs({ ...at, terminal: false })).toBeNull()
  expect(idleLeftMs({ ...at, tokens: 150_000 })).toBeNull()
  expect(idleLeftMs({ ...at, ttl: 300_000 })).toBeNull()
  expect(idleLeftMs({ ...at, config: { ...DEFAULT_CACHE_CONFIG, idle: false } })).toBeNull()
})

test('models map to their measured curves, or a predecessor\'s', () => {
  expect(parseModel('claude-opus-4-6')).toEqual({ family: 'opus', major: 4, minor: 6 })
  expect(parseModel('Opus 5.5 (1M context)')).toEqual({ family: 'opus', major: 5, minor: 5 })
  expect(parseModel('claude-sonnet-5-20260301')).toEqual({ family: 'sonnet', major: 5, minor: 0 })
  expect(parseModel('gpt-5')).toBeNull()
  expect(curvesFor('claude-opus-5').mrcr?.key).toBe('opus-5')
  expect(curvesFor('claude-opus-5-5').mrcr?.key).toBe('opus-5')
  expect(curvesFor('claude-opus-5-5').graph?.key).toBe('opus-4.8')
  expect(curvesFor('claude-fable-5-1').mrcr?.key).toBe('opus-5')
  expect(curvesFor('claude-sonnet-5-5').mrcr?.key).toBe('sonnet-5')
  expect(curvesFor('claude-sonnet-5-5').graph).toBeNull()
  // Opus 4.7's MRCR run looks broken; it reads Opus 4.6's, and its own GraphWalks
  expect(curvesFor('claude-opus-4-7').mrcr?.key).toBe('opus-4.6')
  expect(curvesFor('claude-opus-4-7').graph?.key).toBe('opus-4.7')
  expect(curvesFor('claude-haiku-5-5')).toEqual({ mrcr: null, graph: null })
  expect(curvesFor(null)).toEqual({ mrcr: null, graph: null })
  // bins are (b/2, b]; past the last measured bin the last one stands in
  expect(mrcrAt(curvesFor('claude-opus-5').mrcr!.scores, 100_000)).toEqual({ score: 91.3, base: 98.7, drop: 7.4, bin: '64k–128k' })
  expect(mrcrAt(curvesFor('claude-opus-5').mrcr!.scores, 5_000).bin).toBe('≤8k')
  expect(mrcrAt(curvesFor('claude-opus-5').mrcr!.scores, 900_000).score).toBe(42.5)
})

test('degradation follows the measured curve for the model and the kind of work', () => {
  let code = NO_ACTIVITY
  for (let i = 0; i < 6; i++) code = recordTool(code, 'Edit', { file_path: `/p/f${i}.ts` }, false)
  for (let i = 0; i < 4; i++) code = recordTool(code, 'Bash', { command: 'npm test' }, false)
  expect(workKind(code)).toBe('code')
  let research = NO_ACTIVITY
  for (let i = 0; i < 12; i++) research = recordTool(research, i % 2 ? 'WebFetch' : 'Read', { file_path: `/d/${i}.md` }, false)
  expect(workKind(research)).toBe('research')
  expect(workKind(NO_ACTIVITY)).toBe('chat')

  // code on Opus 5: MRCR holds to 128k (−7 points), then falls 33 points
  expect(degradation(100_000, code, 'claude-opus-5')).toBeNull()
  const hot = degradation(140_000, code, 'claude-opus-5')
  expect(hot?.tone).toBe('hot')
  // the tip names the degree and the step only, never the benchmark
  expect(hot?.text).toBe('Сессия с кодом, контекст сильно деградирует (~140k): модель чаще путает похожие фрагменты и версии правок. Сделайте Handoff сейчас.')
  // the same work on Sonnet 5 strains far earlier: −28 points at 32k–64k
  expect(degradation(20_000, code, 'claude-sonnet-5')).toBeNull()
  expect(degradation(40_000, code, 'claude-sonnet-5')?.tone).toBe('warn')
  expect(degradation(70_000, code, 'claude-opus-4-8')?.tone).toBe('warn')

  // research on Opus 5: at 200k only a hint about similar sources; past 256k GraphWalks warns
  expect(degradation(100_000, research, 'claude-opus-5')).toBeNull()
  expect(degradation(200_000, research, 'claude-opus-5')?.tone).toBe('info')
  expect(degradation(200_000, research, 'claude-opus-5')?.text).toBe('Исследование, контекст начинает деградировать (~200k): модель может путать похожие источники. Сделайте Handoff на границе задачи.')
  const deep = degradation(300_000, research, 'claude-opus-5-5')
  expect(deep?.tone).toBe('warn')
  expect(deep?.text).toBe('Исследование, контекст заметно деградирует (~300k): модель хуже связывает факты из разных частей контекста. Сделайте Handoff после текущего шага.')
  // no curve, no token-based tip
  expect(degradation(300_000, code, 'claude-haiku-5-5')).toBeNull()

  // re-reading one file and repeating a failing command are symptoms at any size, raised by the curve
  let sick = code
  for (let i = 0; i < 5; i++) sick = recordTool(sick, 'Read', { file_path: '/p/lib.ts' }, false)
  for (let i = 0; i < 3; i++) sick = recordTool(sick, 'Bash', { command: 'npm run build' }, true)
  expect(sick.hotFile).toEqual({ path: '/p/lib.ts', count: 5 })
  expect(sick.repeatFails).toBe(2)
  expect(degradation(30_000, sick, 'claude-opus-5')?.tone).toBe('info')
  expect(degradation(30_000, sick, 'claude-opus-5')?.text).toBe('Сессия с кодом, признаки деградации: lib.ts прочитан 5 раз; команды падают повторно. Сделайте Handoff на границе задачи.')
  expect(degradation(40_000, sick, 'claude-sonnet-5')?.tone).toBe('hot')
  expect(degradation(140_000, sick, 'claude-opus-5')?.tone).toBe('hot')
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
    on('fs.stat', () => ({ value: { kind: 'file', size: 4000, mtimeMs: Date.parse('2026-10-15T10:00:01Z'), isLink: false } }) as never)
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

  test(`Handoff never clears over a file left from an earlier run (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-15T10:00:00Z') })
    const ran: string[] = []
    const toasts: string[] = []
    on('session.root', () => ({ value: '/Users/me/code/demo' }))
    on('env.get', () => ({ value: '/Users/me' }))
    on('ui.toast', (_$, e) => (toasts.push(String(e.text ?? e)), { value: undefined }))
    // a full-sized file, but written a minute before this run began
    on('fs.stat', () => ({ value: { kind: 'file', size: 4000, mtimeMs: Date.parse('2026-10-15T09:59:00Z'), isLink: false } }) as never)
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('command.run', { command: 'clear' }, (_$, e) => (ran.push(e.command), { text: '' }))

    await measure($, on, { tokens: 20_000, window: 200_000, percent: 10 })
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    await ui.press({ key: 'smart-compact' })
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()
    expect(ran).toEqual([])
    expect(toasts.some(t => /NOT cleared/.test(t))).toBe(true)
    await ui.unmount()
  })

  test(`a compaction starts the strain count and the cache over (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-19T10:00:00Z') })
    const toasts: string[] = []
    on('ui.toast', (_$, e) => (toasts.push(String(e.text ?? e)), { value: undefined }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('tool.call', () => ({ result: {}, isError: false }) as never)
    on('session.compact', () => ({ messages: MSG }))
    on('session.model', () => ({ value: 'claude-opus-4-8' }))
    await measure($, on, { tokens: 210_000, window: 1_000_000, percent: 21 })
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'opus' }
    const edits = async () => {
      for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Edit', file_path: `/p/f${i}.ts`, old_string: 'a', new_string: 'b' } as never)
    }
    await edits()
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', usage })
    await clock.settle()
    expect(toasts.filter(t => /деградирует/.test(t))).toHaveLength(1)

    await $.session.compact({ trigger: 'auto', messages: MSG } as never)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    // the old transcript's cache says nothing about the new one
    expect(await ui.find({ key: 'keep-warm' })).toBeUndefined()
    await ui.unmount()

    // the same strain in the compacted conversation is announced again
    await edits()
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', usage })
    await clock.settle()
    expect(toasts.filter(t => /деградирует/.test(t))).toHaveLength(2)
  })

  test(`a skipped or precomputed compaction keeps the counts (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-19T10:00:00Z') })
    const toasts: string[] = []
    on('ui.toast', (_$, e) => (toasts.push(String(e.text ?? e)), { value: undefined }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('tool.call', () => ({ result: {}, isError: false }) as never)
    // a precompute installs nothing; a vetoed compaction leaves the conversation as it is
    on('session.compact', (_$, e) => (e.trigger === 'precompute' ? { messages: MSG } : { skip: 'off' }))
    on('session.model', () => ({ value: 'claude-opus-4-8' }))
    await measure($, on, { tokens: 210_000, window: 1_000_000, percent: 21 })
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'opus' }
    for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Edit', file_path: `/p/f${i}.ts`, old_string: 'a', new_string: 'b' } as never)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', usage })
    await clock.settle()
    await $.session.compact({ trigger: 'precompute', messages: MSG } as never)
    await $.session.compact({ trigger: 'manual', messages: MSG } as never)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', usage })
    await clock.settle()
    expect(toasts.filter(t => /деградирует/.test(t))).toHaveLength(1)
  })

  test(`the band warns of a straining context from the tools used (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-19T10:00:00Z') })
    const toasts: string[] = []
    on('ui.toast', (_$, e) => (toasts.push(String(e.text ?? e)), { value: undefined }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('tool.call', () => ({ result: {}, isError: false }) as never)
    // /model shows a bare alias; the response's id names the version
    on('session.model', () => ({ value: 'opus' }))
    await measure($, on, { tokens: 210_000, window: 1_000_000, percent: 21 })
    for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Edit', file_path: `/p/f${i}.ts`, old_string: 'a', new_string: 'b' } as never)
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-4-8' }
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', usage })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /деградирует.*Handoff/ })).toBeDefined()
    expect(toasts.filter(t => /деградирует/.test(t))).toHaveLength(1)
    // the same level is announced once
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', usage })
    await clock.settle()
    expect(toasts.filter(t => /деградирует/.test(t))).toHaveLength(1)
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

  if (surface === 'terminal') test(`a big idle conversation warns before idle compaction, not the cache (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-19T10:00:00Z') })
    const toasts: string[] = []
    on('ui.toast', (_$, e) => (toasts.push(String(e.text ?? e)), { value: undefined }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('session.model', () => ({ value: 'claude-opus-5' }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('session.start', () => ({ sessionId: 's1', cwd: '/x' }) as never)
    await measure($, on, { tokens: 250_000, window: 1_000_000, percent: 25 }, [{ kind: 'five_hour', percentUsed: 5 }])
    await $.session.start({ source: 'startup', cwd: '/x' } as never)
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'opus' }
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', usage })
    await clock.settle()
    // idle compaction at 54 min warns 5 min ahead, while the 1-hour cache still has 11 min
    await clock.advance(50 * 60_000)
    expect(toasts.some(t => /compacts this idle conversation in 5 min/.test(t))).toBe(true)
    expect(toasts.some(t => /cools in/.test(t))).toBe(false)
    expect(await ui.find({ type: 'Text', text: /idle compaction/ })).toBeDefined()
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
