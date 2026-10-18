import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Flow, Usage } from '../types'
import {
  compactInstructions,
  handoffPath,
  levelColor,
  limitName,
  meter,
  PALETTE,
  pie,
  readPrompt,
  resetIn,
  shortTokens,
  writePrompt,
} from './lib'

const usageAtom = atom({ plugin: 'smart-compact', key: 'usage' } as const, null)
const IDLE: Flow = { phase: 'idle', path: null }
const flowAtom = atom({ plugin: 'smart-compact', key: 'flow' } as const, IDLE)

const PHASE_TEXT: Record<Flow['phase'], string> = {
  idle: '',
  writing: '✍  Пишу handoff…',
  compacting: '◌  Сжимаю контекст…',
  reading: '❖  Читаю handoff…',
}

async function refresh($: EngineInterface): Promise<void> {
  const u = await $.session.usage()
  const next: Usage = {
    percent: u.context.percent ?? null,
    tokens: u.context.tokens ?? null,
    window: u.context.window,
    limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
  }
  await update($, usageAtom, () => next)
}

async function start($: EngineInterface): Promise<string> {
  const flow = await read($, flowAtom)
  if (flow.phase !== 'idle') return 'Smart compact уже выполняется.'
  const home = (await $.env.get('HOME')) ?? '~'
  const root = await $.session.root()
  const path = handoffPath(home, root, await $.clock.now())
  await update($, flowAtom, (): Flow => ({ phase: 'writing', path }))
  const sent = await $.prompt.submit({ text: writePrompt(path, root) })
  if ('drop' in sent && sent.drop !== undefined) {
    await update($, flowAtom, (): Flow => ({ phase: 'idle', path: null }))
    $.ui.toast(`Smart compact отменён: ${sent.drop}`)
  }
  return `Smart compact: handoff → ${path}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, flowAtom, (): Flow => ({ phase: 'idle', path: null }))
    await $.command.register({
      name: 'smart-compact',
      description: 'Сохранить handoff-документ, сжать сессию и перечитать документ',
    })
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'smart-compact' }, async $ => ({ text: await start($) }))

  on('session.measure', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    void refresh($)

    const flow = await read($, flowAtom)
    if (flow.phase === 'writing' && flow.path) {
      const path = flow.path
      if (e.isAborted || e.reason !== 'answer') {
        await update($, flowAtom, (): Flow => ({ phase: 'idle', path: null }))
        $.ui.toast('Smart compact прерван: handoff не был записан')
        return result
      }
      await update($, flowAtom, (): Flow => ({ phase: 'compacting', path }))
      // compact rejects while a turn runs: wait until this one has fully ended
      $.clock.after(400, async () => {
        try {
          const done = await $.session.compact({ instructions: compactInstructions(path) })
          if ('skip' in done && done.skip !== undefined) {
            $.ui.toast(`Компакт пропущен: ${done.skip}. Handoff: ${path}`)
            await update($, flowAtom, (): Flow => ({ phase: 'idle', path: null }))
            return
          }
          await update($, flowAtom, (): Flow => ({ phase: 'reading', path }))
          await $.prompt.submit({ text: readPrompt(path) })
        } catch (err) {
          $.ui.toast(`Компакт не удался: ${String(err)}. Handoff: ${path}`)
          await update($, flowAtom, (): Flow => ({ phase: 'idle', path: null }))
        }
      })
    } else if (flow.phase === 'reading') {
      await update($, flowAtom, (): Flow => ({ phase: 'idle', path: null }))
      void refresh($)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const usage = await read($, usageAtom)
    const flow = await read($, flowAtom)
    const now = await $.clock.now()
    const pct = usage?.percent ?? null
    const ctx = meter(pct ?? 0, 14)
    const sep = <Text color={PALETTE.border}>│</Text>

    return (
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        borderStyle="round"
        borderColor={PALETTE.border}
        paddingX={1}
        gap={2}
      >
        <Box flexDirection="row" alignItems="center" gap={2} flexShrink={1}>
          <Text>
            <Text color={pct === null ? PALETTE.muted : levelColor(pct)}>{pie(pct ?? 0)} </Text>
            <Text color={PALETTE.muted}>Контекст </Text>
            <Text color={pct === null ? PALETTE.track : levelColor(pct)}>{ctx.filled}</Text>
            <Text color={PALETTE.track}>{ctx.empty}</Text>
            <Text bold color={pct === null ? PALETTE.muted : levelColor(pct)}>
              {' '}
              {pct === null ? '—' : `${pct}%`}
            </Text>
            {usage?.tokens != null && (
              <Text color={PALETTE.muted}>
                {'  '}
                {shortTokens(usage.tokens)} / {shortTokens(usage.window)}
              </Text>
            )}
          </Text>
          {(usage?.limits ?? []).map(l => {
            const m = meter(l.percentUsed, 6)
            const reset = resetIn(l.resetsAt, now)
            return (
              <Box key={l.kind} flexDirection="row" gap={2}>
                {sep}
                <Text>
                  <Text color={PALETTE.muted}>{limitName(l.kind)} </Text>
                  <Text color={levelColor(l.percentUsed)}>{m.filled}</Text>
                  <Text color={PALETTE.track}>{m.empty}</Text>
                  <Text bold color={levelColor(l.percentUsed)}> {Math.round(l.percentUsed)}%</Text>
                  {reset !== '' && <Text color={PALETTE.muted}> ↻ {reset}</Text>}
                </Text>
              </Box>
            )
          })}
        </Box>
        {flow.phase === 'idle' ? (
          <Button
            key="smart-compact"
            label="✦ Smart compact"
            variant="primary"
            onPress={() => void start($)}
          />
        ) : (
          <Text bold color={PALETTE.accent}>
            {PHASE_TEXT[flow.phase]}
          </Text>
        )}
      </Box>
    )
  })
}
