import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Cache, CacheConfig, Flow, Usage } from '../types'
import {
  adviceColor,
  advise,
  BIG_CONTEXT,
  barSvg,
  cacheColor,
  cacheConfig,
  DEFAULT_CACHE_CONFIG,
  cachePercent,
  pieSvg,
  ringSvg,
  cacheLeftMs,
  cacheText,
  cacheTtlMs,
  costText,
  cacheWarnMs,
  degradation,
  HANDOFF_LABEL,
  idleLeftMs,
  handoffPath,
  levelColor,
  limitName,
  meter,
  MIN_HANDOFF_BYTES,
  MTIME_SLACK_MS,
  NO_ACTIVITY,
  parseModel,
  recordTool,
  PALETTE,
  pickFit,
  readPrompt,
  resetIn,
  tokensText,
  toneRank,
  WARM_LABEL,
  WARM_PROMPT,
  writePrompt,
} from './lib'

const usageAtom = atom({ plugin: 'context-band', key: 'usage' } as const, null)
const IDLE: Flow = { phase: 'idle', path: null, startedAt: null }
const flowAtom = atom({ plugin: 'context-band', key: 'flow' } as const, IDLE)
const NO_CACHE: Cache = { lastAt: null, warned: false }
const cacheAtom = atom({ plugin: 'context-band', key: 'cache' } as const, NO_CACHE)
// written on a timer so the cache countdown redraws between turns
const tickAtom = atom({ plugin: 'context-band', key: 'tick' } as const, 0)
const handoffAtom = atom({ plugin: 'context-band', key: 'handoff' } as const, null)
const activityAtom = atom({ plugin: 'context-band', key: 'activity' } as const, NO_ACTIVITY)
const configAtom = atom({ plugin: 'context-band', key: 'config' } as const, DEFAULT_CACHE_CONFIG)

// idle compaction runs only in an interactive terminal; the timer has no surface of its own, so it reads the last drawn
let lastSurface: string | null = null

async function readJson($: EngineInterface, path: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(String(await $.fs.read(path)))
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Reads the env and the user, project and local settings, later ones winning, as Claude Code layers them. */
async function loadConfig($: EngineInterface): Promise<void> {
  // each name literal: the engine lists the variables a module reads
  const env: Record<string, string | undefined> = {
    FORCE_PROMPT_CACHING_5M: await $.env.get('FORCE_PROMPT_CACHING_5M'),
    CLAUDE_CODE_PROMPT_CACHE_TTL: await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
    ENABLE_PROMPT_CACHING_1H: await $.env.get('ENABLE_PROMPT_CACHING_1H'),
    DISABLE_AUTO_COMPACT: await $.env.get('DISABLE_AUTO_COMPACT'),
    CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: await $.env.get('CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS'),
  }
  const home = (await $.env.get('HOME')) ?? '~'
  const root = await $.session.root()
  const settings = {
    ...(await readJson($, `${home}/.claude/settings.json`)),
    ...(await readJson($, `${root}/.claude/settings.json`)),
    ...(await readJson($, `${root}/.claude/settings.local.json`)),
  }
  await update($, configAtom, (): CacheConfig => cacheConfig(env, settings))
}

const PHASE_TEXT: Record<Flow['phase'], string> = {
  idle: '',
  writing: '✍  Writing handoff…',
  clearing: '◌  Clearing context…',
  reading: '❖  Reading handoff…',
}

async function refresh($: EngineInterface): Promise<void> {
  const u = await $.session.usage()
  // /model may show a bare alias; the id the last response reported names the version
  const named = await $.session.model().catch(() => null)
  const known = (await read($, usageAtom))?.model ?? null
  const next: Usage = {
    percent: u.context.percent ?? null,
    tokens: u.context.tokens ?? null,
    window: u.context.window,
    limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    cost: u.cost?.usd ?? null,
    model: parseModel(named) ? named : (known ?? named),
  }
  await update($, usageAtom, () => next)
}

/** Redraws the countdown and warns once when the cache is about to cool. */
async function tickCache($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, tickAtom, () => now)
  const cache = await read($, cacheAtom)
  if (cache.lastAt === null || cache.warned) return
  const usage = await read($, usageAtom)
  const config = await read($, configAtom)
  const ttl = cacheTtlMs(usage?.limits ?? [], config.ttl)
  const left = cacheLeftMs(cache.lastAt, ttl, now)
  const idle = idleLeftMs({ lastAt: cache.lastAt, ttl, tokens: usage?.tokens ?? null, config, terminal: lastSurface === 'terminal', now })
  if (idle !== null && idle > 0 && idle <= cacheWarnMs(ttl)) {
    await update($, cacheAtom, (c): Cache => ({ ...c, warned: true }))
    $.ui.toast(`Claude Code compacts this idle conversation in ${Math.ceil(idle / 60_000)} min: send a message to keep it, or Handoff now`)
  } else if (left !== null && left > 0 && left <= cacheWarnMs(ttl)) {
    await update($, cacheAtom, (c): Cache => ({ ...c, warned: true }))
    const min = Math.ceil(left / 60_000)
    $.ui.toast(
      (usage?.tokens ?? 0) >= BIG_CONTEXT
        ? `Prompt cache cools in ${min} min: send a message to keep it warm, or Handoff before a long break`
        : `Prompt cache cools in ${min} min: send a message to keep it warm`,
    )
  }
}

async function start($: EngineInterface): Promise<string> {
  const flow = await read($, flowAtom)
  if (flow.phase !== 'idle') return 'Handoff is already running.'
  const home = (await $.env.get('HOME')) ?? '~'
  const root = await $.session.root()
  const now = await $.clock.now()
  const path = handoffPath(home, root, now)
  await update($, flowAtom, (): Flow => ({ phase: 'writing', path, startedAt: now }))
  const sent = await $.prompt.submit({ text: writePrompt(path, root, await read($, handoffAtom)) })
  if ('drop' in sent && sent.drop !== undefined) {
    await update($, flowAtom, () => IDLE)
    $.ui.toast(`Handoff cancelled: ${sent.drop}`)
  }
  return `Handoff → ${path}, then /clear`
}

/**
 * Whether the model really wrote a handoff worth clearing the context for: written during this run,
 * so an earlier file at the same path never stands in for one the model did not write.
 */
async function handoffWritten($: EngineInterface, path: string, since: number): Promise<boolean> {
  const stat = await $.fs.stat(path).catch(() => undefined)
  return stat !== undefined && stat.kind === 'file' && stat.size >= MIN_HANDOFF_BYTES && stat.mtimeMs >= since - MTIME_SLACK_MS
}

/** Clears the conversation, then has the fresh one read the handoff. */
async function clearAndRead($: EngineInterface, path: string): Promise<void> {
  await update($, flowAtom, (): Flow => ({ phase: 'clearing', path, startedAt: null }))
  try {
    // $.command.run is queued and runs once the session is idle, as if the person typed /clear
    await $.command.run({ command: 'clear', args: '' })
  } catch (err) {
    await update($, flowAtom, () => IDLE)
    $.ui.toast(`/clear failed: ${String(err)}. The handoff is saved: ${path}`)
    return
  }
  // the new conversation has written no cache yet and done no work
  await update($, cacheAtom, () => NO_CACHE)
  await update($, activityAtom, () => NO_ACTIVITY)
  await update($, handoffAtom, () => path)
  await update($, flowAtom, (): Flow => ({ phase: 'reading', path, startedAt: null }))
  void refresh($)
  const sent = await $.prompt.submit({ text: readPrompt(path) })
  if ('drop' in sent && sent.drop !== undefined) {
    await update($, flowAtom, () => IDLE)
    $.ui.toast(`Context cleared, but the read prompt was dropped (${sent.drop}). Ask to read ${path}`)
  }
}

/** Toasts once per level as the context strains, so the advice reaches the person mid-work too. */
async function alertStrain($: EngineInterface): Promise<void> {
  const usage = await read($, usageAtom)
  const activity = await read($, activityAtom)
  const tip = degradation(usage?.tokens ?? 0, activity, usage?.model ?? null)
  if (!tip || tip.tone === 'info' || toneRank(tip.tone) <= toneRank(activity.alerted)) return
  await update($, activityAtom, (a): Activity => ({ ...a, alerted: tip.tone }))
  $.ui.toast(tip.text)
}

/** Sends a one-word turn so the cache is read again and lives another TTL. */
async function warm($: EngineInterface): Promise<void> {
  const sent = await $.prompt.submit({ text: WARM_PROMPT })
  if ('drop' in sent && sent.drop !== undefined) $.ui.toast(`Warm cancelled: ${sent.drop}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(30_000, () => void tickCache($))
    await update($, flowAtom, () => IDLE)
    // unread settings leave Claude Code's defaults, which is what most sessions run on
    void loadConfig($).catch(() => undefined)
    await $.command.register({
      name: 'handoff',
      description: 'Write a handoff doc, /clear the session, then read the handoff in the fresh context',
    })
    await $.command.register({
      name: 'smart-compact',
      description: 'Old name of /handoff: handoff doc, /clear, read it back',
    })
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async $ => ({ text: await start($) }))
  on('command.run', { command: 'smart-compact' }, async $ => ({ text: await start($) }))

  // a /clear the person ran themself: the earlier handoff is not in the new context
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' && (await read($, flowAtom)).phase !== 'clearing') {
      await update($, handoffAtom, () => null)
      await update($, cacheAtom, () => NO_CACHE)
      await update($, activityAtom, () => NO_ACTIVITY)
    }
    return next(e)
  })

  // a compaction the person or the engine ran (/compact, the auto threshold): the work the counts
  // describe is summarized away, and the new transcript has no prompt cache of its own yet
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) {
      await update($, activityAtom, () => NO_ACTIVITY)
      await update($, cacheAtom, () => NO_CACHE)
      void refresh($)
    }
    return result
  })

  // subagents' calls fill their own context, not this one
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && result.deny === undefined) {
      const input = {
        file_path: 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : undefined,
        command: 'command' in e && typeof e.command === 'string' ? e.command : undefined,
      }
      await update($, activityAtom, a => recordTool(a, e.tool, input, result.isError === true))
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    // the id the response reported, written before the refresh that reads it back
    const model = e.usage?.model
    if (model !== undefined && parseModel(model)) await update($, usageAtom, u => (u ? { ...u, model } : u))
    void refresh($).then(() => alertStrain($))
    // the turn's last API response just refreshed the prompt cache
    if (e.usage !== undefined) {
      const now = await $.clock.now()
      await update($, cacheAtom, (): Cache => ({ lastAt: now, warned: false }))
    }

    const flow = await read($, flowAtom)
    if (flow.phase === 'writing' && flow.path) {
      const path = flow.path
      if (e.isAborted || e.reason !== 'answer') {
        await update($, flowAtom, () => IDLE)
        $.ui.toast('Handoff interrupted: nothing was cleared')
        return result
      }
      // /clear loses everything not in the file, so clear only over a real handoff
      if (!(await handoffWritten($, path, flow.startedAt ?? 0))) {
        await update($, flowAtom, () => IDLE)
        $.ui.toast(`Handoff not found or too short at ${path}: the context was NOT cleared`)
        return result
      }
      void clearAndRead($, path)
    } else if (flow.phase === 'reading') {
      await update($, flowAtom, () => IDLE)
      void refresh($)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // Полоса одна на все моды: то, что рисуют моды ниже (например, next-steps), ставим над индикаторами.
    const below = await next(e).catch(() => null)
    const usage = await read($, usageAtom)
    const flow = await read($, flowAtom)
    const now = Math.max(await $.clock.now(), await read($, tickAtom))
    const cache = await read($, cacheAtom)
    const working = e.props.isWorking
    lastSurface = e.surface
    const config = await read($, configAtom)
    const ttl = cacheTtlMs(usage?.limits ?? [], config.ttl)
    const cacheLeft = cacheLeftMs(cache.lastAt, ttl, now)
    const cacheTone = cacheColor(cacheLeft, ttl, working)
    const cacheValue = cacheText(cacheLeft, working)
    const pct = usage?.percent ?? null
    const ctxTone = pct === null ? PALETTE.muted : levelColor(pct)
    const idle = flow.phase === 'idle'
    // warming a cold cache is no ping but a full re-write, so the button goes inert then
    const warmable = working || (cacheLeft !== null && cacheLeft > 0)
    const activity = await read($, activityAtom)
    const idleLeft = idleLeftMs({ lastAt: cache.lastAt, ttl, tokens: usage?.tokens ?? null, config, terminal: e.surface === 'terminal', now })
    const tip = usage && idle && !working ? advise({ ...usage, cacheLeft, ttl, now, activity, idleLeft }) : null
    const limits = usage?.limits ?? []
    const cost = usage?.cost ?? null

    if (e.surface !== 'terminal') {
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      // one row that never wraps: the bars and values keep their size, the grey details shrink first
      const segment = (key: string, label: string, percent: number, tone: string, value: string, detail: string, alt: string, chart = 'bar') => (
        <Box key={key} flexDirection="row" alignItems="center" gap="xs" flexShrink={detail === '' ? 0 : 1} minWidth={0}>
          {label !== '' && <Text size="caption" color={PALETTE.muted} wrap="truncate-end">{label}</Text>}
          {chart === 'pie' ? (
            <Svg source={pieSvg(percent, tone)} alt={alt} width={14} height={14} />
          ) : chart === 'ring' ? (
            <Svg source={ringSvg(percent, tone)} alt={alt} width={14} height={14} />
          ) : chart === 'bar' ? (
            <Svg source={barSvg(percent, tone, 40, 5)} alt={alt} width={40} height={5} />
          ) : null}
          <Text size="footnote" weight="semibold" tabular color={tone} wrap="truncate-end">{value}</Text>
          {detail !== '' && (
            <Box flexShrink={1} minWidth={0} overflow="hidden">
              <Text size="caption" color={PALETTE.muted} wrap="truncate-end">{detail}</Text>
            </Box>
          )}
        </Box>
      )
      return (
        <Box flexDirection="column" gap="xs">
          {below}
          {tip && <Text size="caption" color={adviceColor(tip.tone)}>{tip.text}</Text>}
          {/* context and limits hold the left edge, the rest the right one, so a changing value never shifts the other side */}
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" flexWrap="nowrap" columnGap="md" overflow="hidden">
            <Box key="meters" flexDirection="row" alignItems="center" flexWrap="nowrap" columnGap="md" flexShrink={1} minWidth={0} overflow="hidden">
              {segment(
                'context', 'Context', pct ?? 0, ctxTone, pct === null ? '—' : `${pct}%`,
                usage ? tokensText(usage, true) : '',
                `Context ${pct ?? '—'}% full`,
              )}
              {limits.map(l => {
                const reset = resetIn(l.resetsAt, now)
                return segment(
                  l.kind, limitName(l.kind), l.percentUsed, levelColor(l.percentUsed),
                  `${Math.round(l.percentUsed)}%`, reset,
                  `${limitName(l.kind)} limit ${Math.round(l.percentUsed)}% used`,
                  'ring',
                )
              })}
            </Box>
            {/* the button sits right after the cache and never shrinks away */}
            <Box key="tail" flexDirection="row" alignItems="center" gap="md" flexWrap="nowrap" flexShrink={0}>
              {cost !== null && segment('cost', '', 0, PALETTE.accent, costText(cost), '', `Session cost ${costText(cost)}`, 'none')}
              {segment(
                'cache', 'Cache', cachePercent(cacheLeft, ttl, working), cacheTone, cacheValue,
                '',
                `Prompt cache ${cacheValue}`,
                'pie',
              )}
              {!idle ? (
                <Text size="footnote" weight="semibold" color={PALETTE.accent}>{PHASE_TEXT[flow.phase]}</Text>
              ) : (
                <Box flexDirection="row" gap="sm">
                  {warmable ? (
                    <Button key="keep-warm" label={WARM_LABEL} variant="secondary" onPress={() => void warm($)} />
                  ) : (
                    <Box key="keep-warm-off" borderStyle="round" borderColor={PALETTE.track} paddingX="sm">
                      <Text size="footnote" color={PALETTE.track}>{WARM_LABEL}</Text>
                    </Box>
                  )}
                  <Button key="smart-compact" label={HANDOFF_LABEL} variant="primary" onPress={() => void start($)} />
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      )
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const fit = pickFit(e.props.bodyColumns, usage, now, idle)
    const ctx = meter(pct ?? 0, fit.ctxWidth)
    return (
      <Box flexDirection="column">
        {below}
        {tip && <Text color={adviceColor(tip.tone)}>▸ {tip.text}</Text>}
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={3}>
          <Text>
            {fit.ctxLabel && <Text color={PALETTE.muted}>Context </Text>}
            <Text color={ctxTone}>{ctx.filled}</Text>
            <Text color={PALETTE.track}>{ctx.empty}</Text>
            <Text bold color={ctxTone}> {pct === null ? '—' : `${pct}%`}</Text>
            {usage && <Text color={PALETTE.muted}>  {tokensText(usage, fit.ctxLabel)}</Text>}
          </Text>
          {limits.map(l => {
            const m = meter(l.percentUsed, fit.limitMeter)
            const reset = fit.reset ? resetIn(l.resetsAt, now) : ''
            return (
              <Text key={l.kind}>
                <Text color={PALETTE.muted}>{limitName(l.kind)} </Text>
                <Text color={levelColor(l.percentUsed)}>{m.filled}</Text>
                <Text color={PALETTE.track}>{m.empty}</Text>
                <Text bold color={levelColor(l.percentUsed)}> {Math.round(l.percentUsed)}%</Text>
                {reset !== '' && <Text color={PALETTE.muted}> · {reset}</Text>}
              </Text>
            )
          })}
          {cost !== null && (
            <Text key="cost">
              <Text bold color={PALETTE.accent}>{costText(cost)}</Text>
            </Text>
          )}
          <Box key="tail" flexDirection="row" alignItems="center" columnGap={2} flexWrap="nowrap">
            <Text>
              {fit.ctxLabel && <Text color={PALETTE.muted}>Cache </Text>}
              <Text bold color={cacheTone}>{cacheValue}</Text>
            </Text>
            {!idle ? (
              <Text bold color={PALETTE.accent}>{PHASE_TEXT[flow.phase]}</Text>
            ) : (
              <Box flexDirection="row" columnGap={2}>
                {warmable ? (
                  <Button key="keep-warm" label={fit.warm} variant="secondary" onPress={() => void warm($)} />
                ) : (
                  <Text key="keep-warm-off" color={PALETTE.track}>[ {fit.warm} ]</Text>
                )}
                <Button key="smart-compact" label={fit.button} variant="primary" onPress={() => void start($)} />
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    )
  })
}
