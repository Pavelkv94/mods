import type { BoxProps, ButtonProps, ElementConstructor, SvgProps, TextProps } from 'claude-code'

import type { AgentCard, BgProcess, Step } from '../../types'
import { fmtDuration, fmtTokens, fmtUsd, plural, shortPath } from './format'
import { costOf, modelColor, modelLabel, windowOf } from './models'
import type { Cost } from './models'
import { barSvg, crabSvg } from './svg'
import { AGENT_STATUS, CRAB_COLORS, ERR, FILE_OP, KIND_STYLE, OK, MUTED, PROCESS_END, PROCESS_STYLE, WARN } from './theme'

// how many operations an open card lists
const SHOW_STEPS = 10
// a running subagent this long without a step or tool call of its own, and no child at work, may be stuck
const QUIET_MS = 90_000
// a tool's or a pause's running time shows once it passes this
const SHOW_ELAPSED_MS = 10_000

const ASCII_CRAB = [
  [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  '],
  [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▝▝ ▘▘  '],
]
const ASCII_CRAB_WIDTH = 9

export type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Svg?: ElementConstructor<SvgProps>
  // the card's inside: the pane less its border and padding
  inner: number
  tick: number
  // the session's context window, when the engine gave one
  window?: number
  // the subagents with a running child of their own
  busy: ReadonlySet<string>
  // the process whose Stop waits for its second press, '' for none
  confirming: string
  askStop: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  toggle: (id: string) => Promise<void>
  clear: () => Promise<void>
}

export type PaneData = {
  list: readonly AgentCard[]
  procs: readonly BgProcess[]
  open: ReadonlySet<string>
}

export function drawPane(kit: Kit, { list, procs, open }: PaneData) {
  const { Box, Text, Button } = kit
  const runningAgents = list.filter(card => card.status === 'running').length
  const runningProcs = procs.filter(proc => proc.status === 'running').length
  const finished = list.length - runningAgents + procs.length - runningProcs
  const costs = list.map(card => costOf(card))
  const spent = costs.reduce((sum, cost) => sum + (cost?.total ?? 0), 0)
  const ownerOf = (id: string | undefined) => (id === undefined ? 'main' : (list.find(card => card.id === id)?.role ?? 'subagent'))

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Text weight="semibold" wrap="truncate-end">
          {list.length + procs.length === 0
            ? 'No subagents or background processes yet'
            : `agents ${runningAgents}/${list.length} · bg ${runningProcs}/${procs.length}`}
          {costs.some(Boolean) ? <Text dimColor tabular>{`  ≈ ${fmtUsd(spent)}`}</Text> : ''}
        </Text>
        {finished > 0 && <Button key="clear" label="Clear finished" hotkey="c" onPress={() => void kit.clear()} />}
      </Box>
      {list.length > 0 && <Text dimColor>── Subagents ──</Text>}
      {ordered(list).map(({ card, depth }) => (
        <Box key={`n:${card.id}`} flexDirection="column" marginLeft={Math.min(depth, 3) * 2}>
          {drawCard(kit, card, depth, open.has(card.id))}
        </Box>
      ))}
      {procs.length > 0 && <Text dimColor>── Background processes ──</Text>}
      {byRecency(procs).map(proc => drawProcess(kit, proc, ownerOf(proc.owner), open.has(proc.id)))}
    </Box>
  )
}

export function byRecency<T extends { status: string; startedAt: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt)
}

// Each subagent right under the one that spawned it, a level deeper.
export function ordered(list: readonly AgentCard[]): { card: AgentCard; depth: number }[] {
  const ids = new Set(list.map(card => card.id))
  const children = new Map<string, AgentCard[]>()
  const roots: AgentCard[] = []
  for (const card of list) {
    if (card.parentId !== undefined && card.parentId !== card.id && ids.has(card.parentId)) {
      children.set(card.parentId, [...(children.get(card.parentId) ?? []), card])
    } else {
      roots.push(card)
    }
  }
  const out: { card: AgentCard; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (card: AgentCard, depth: number) => {
    if (seen.has(card.id)) return
    seen.add(card.id)
    out.push({ card, depth })
    for (const child of byRecency(children.get(card.id) ?? [])) walk(child, depth + 1)
  }
  for (const root of byRecency(roots)) walk(root, 0)
  // parents that point at each other reach no root: they still show
  for (const card of byRecency(list)) walk(card, 0)
  return out
}

function statusColor(card: AgentCard): string {
  if (card.status === 'done') return OK
  if (card.status === 'error') return ERR
  if (card.status === 'killed') return MUTED
  return CRAB_COLORS[card.crab % CRAB_COLORS.length] ?? '#D97757'
}

// The context bar warns as the window fills: amber past 70%, red past 90%.
function fillColor(fraction: number, color: string): string {
  return fraction >= 0.9 ? ERR : fraction >= 0.7 ? WARN : color
}

function ctxLabel(ctx: number, window: number, percent?: number): string {
  return `ctx ${fmtTokens(ctx)}/${fmtTokens(window)} · ${percent ?? Math.round((ctx / window) * 100)}%`
}

function drawCrab({ Box, Text, Svg, tick }: Kit, card: AgentCard) {
  const color = statusColor(card)
  const isRunning = card.status === 'running'
  if (Svg) {
    return <Svg source={crabSvg(color, card.status)} alt={`crab typing for ${card.role}`} width={48} height={32} isInteractive />
  }
  const rows = ASCII_CRAB[isRunning ? Math.floor(tick / 1000) % 2 : 0] ?? []
  // the card's text gives way, never the crab: a narrowed crab wraps its rows apart
  return (
    <Box flexDirection="column" flexShrink={0} width={ASCII_CRAB_WIDTH}>
      {rows.map((row, i) => (
        <Text key={`crab:${i}`} color={color} dimColor={card.status === 'killed'} wrap="truncate-end">
          {row}
        </Text>
      ))}
    </Box>
  )
}

function drawBar({ Text, Svg, inner, tick }: Kit, color: string, fraction: number | undefined, isRunning: boolean, uid: string) {
  if (Svg) {
    return (
      <Svg
        source={barSvg(color, fraction, isRunning, uid)}
        alt={fraction === undefined ? 'working' : `${Math.round(fraction * 100)}%`}
        height={6}
        isInteractive={isRunning}
      />
    )
  }
  const width = inner
  if (fraction === undefined) {
    // a block that slides along, a little further each second
    const seg = 6
    const at = ((Math.floor(tick / 1000) * 3) % (width + seg)) - seg
    const from = Math.max(0, at)
    const to = Math.min(width, at + seg)
    return (
      <Text wrap="truncate-end">
        <Text dimColor>{'─'.repeat(from)}</Text>
        <Text color={color}>{'━'.repeat(Math.max(0, to - from))}</Text>
        <Text dimColor>{'─'.repeat(Math.max(0, width - Math.max(to, from)))}</Text>
      </Text>
    )
  }
  const filled = Math.max(fraction > 0 ? 1 : 0, Math.round(width * Math.min(1, fraction)))
  return (
    <Text wrap="truncate-end">
      <Text color={color}>{'━'.repeat(filled)}</Text>
      <Text dimColor>{'─'.repeat(width - filled)}</Text>
    </Text>
  )
}

function drawNow({ Box, Text, tick, busy }: Kit, card: AgentCard) {
  if (card.status === 'running' && card.activity) {
    const style = KIND_STYLE[card.activity.kind]
    const step = card.history.find(item => item.id === card.activity?.id)
    const ran = step ? tick - step.startedAt : 0
    return (
      <Box flexDirection="row" gap={1}>
        <Box flexShrink={1} minWidth={0} overflow="hidden">
          <Text color={style.color} wrap="truncate-middle">
            <Text weight="semibold">
              {style.verb} · {card.activity.tool}
            </Text>
            {card.activity.target ? `  ${card.activity.target}` : ''}
          </Text>
        </Box>
        {ran >= SHOW_ELAPSED_MS && (
          <Text dimColor tabular>
            {fmtDuration(ran)}
          </Text>
        )}
      </Box>
    )
  }
  if (card.status === 'running') {
    const quiet = tick - (card.lastEventAt ?? card.startedAt)
    if (quiet >= QUIET_MS && !busy.has(card.id)) {
      return (
        <Text color={WARN} wrap="truncate-end">
          ⚠ quiet {fmtDuration(quiet)}: no step or tool call
        </Text>
      )
    }
    return (
      <Text dimColor italic>
        {quiet >= SHOW_ELAPSED_MS ? `thinking… ${fmtDuration(quiet)}` : 'thinking…'}
      </Text>
    )
  }
  if (card.status === 'error') {
    return (
      <Text color={ERR} wrap="truncate-end">
        ✕ ended without an answer
      </Text>
    )
  }
  return undefined
}

function countsOf(card: AgentCard): string {
  return `${plural(card.steps, 'step')} · ${plural(card.tools, 'tool')}`
}

// Its own todo list when it keeps one, else what it has done so far.
function progressLabel(card: AgentCard): string {
  if (!card.plan) return countsOf(card)
  const current = card.status === 'running' && card.plan.current ? ` · ${card.plan.current}` : ''
  return `${card.plan.done}/${card.plan.total} todos${current}`
}

function totalTokens(card: AgentCard): number {
  return card.tokensIn + card.tokensOut + card.tokensCacheWrite + card.tokensCacheRead
}

function drawCard(kit: Kit, card: AgentCard, depth: number, isOpen: boolean) {
  const { Box, Text, Button } = kit
  const color = statusColor(card)
  const model = modelColor(card.model)
  const elapsed = (card.endedAt ?? Math.max(kit.tick, card.startedAt)) - card.startedAt
  const cost = costOf(card)
  const isRunning = card.status === 'running'
  const window = windowOf(card.model, kit.window)
  const fraction = card.ctx > 0 ? card.ctx / window : undefined

  return (
    <Box key={card.id} flexDirection="column" borderStyle="round" borderColor={isRunning ? model : color} paddingX={1} overflow="hidden">
      <Box flexDirection="row" gap={1}>
        {drawCrab(kit, card)}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexShrink={1} minWidth={0} overflow="hidden">
              <Text weight="semibold" wrap="truncate-end">
                {depth > 0 ? `↳ ${card.role}` : card.role}
              </Text>
            </Box>
            <Text color="#FFFFFF" backgroundColor={model}>
              {` ${modelLabel(card.model)}${card.effort !== undefined ? ` · ${card.effort}` : ''} `}
            </Text>
          </Box>
          {card.description !== '' && (
            <Text dimColor wrap="truncate-end">
              {card.description}
            </Text>
          )}
          {drawNow(kit, card)}
        </Box>
      </Box>
      {(fraction !== undefined || isRunning) &&
        drawBar(kit, fraction === undefined ? color : fillColor(fraction, color), fraction, isRunning, card.id)}
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexShrink={1} minWidth={0} overflow="hidden">
          <Text dimColor wrap="truncate-end">
            {progressLabel(card)}
          </Text>
        </Box>
        {fraction !== undefined && (
          <Text dimColor tabular>
            {ctxLabel(card.ctx, window)}
          </Text>
        )}
      </Box>
      <Box flexDirection="row" gap={1}>
        <Text color={color}>{AGENT_STATUS[card.status].text}</Text>
        <Text dimColor tabular>
          ⏱ {fmtDuration(elapsed)}
        </Text>
        <Text dimColor tabular>
          {fmtTokens(totalTokens(card))} tok
        </Text>
        <Box flexGrow={1} />
        <Text weight="semibold" tabular>
          {fmtUsd(cost?.total)}
        </Text>
        <Button plain key={`more:${card.id}`} label={isOpen ? '▾' : '▸'} onPress={() => void kit.toggle(card.id)} />
      </Box>
      {isOpen && drawDetails(kit, card, cost)}
    </Box>
  )
}

function heading({ Text }: Kit, title: string, count?: number) {
  return (
    <Text dimColor weight="semibold">
      {title.toUpperCase()}
      {count === undefined ? '' : ` · ${count}`}
    </Text>
  )
}

function priceNote(card: AgentCard): string {
  const notes = ['API-equivalent list price']
  if (card.fast) notes.push('fast mode ×2')
  if (card.tokensCacheWrite > 0) {
    notes.push(
      card.cacheWrite1hShare === undefined
        ? 'cache writes as 5-min until it returns'
        : `${Math.round(card.cacheWrite1hShare * 100)}% of cache writes kept 1h`,
    )
  }
  return notes.join(' · ')
}

function drawDetails(kit: Kit, card: AgentCard, cost: Cost | undefined) {
  const { Box, Text } = kit
  const steps = card.history.slice(-SHOW_STEPS)
  const earlier = card.history.length - steps.length
  const glyph = (step: Step) => (step.status === 'running' ? '◐' : step.status === 'ok' ? '✓' : '✕')
  const glyphColor = (step: Step) => (step.status === 'running' ? statusColor(card) : step.status === 'ok' ? OK : ERR)
  const row = (label: string, tokens: number, usd: number | undefined) => (
    <Box flexDirection="row" justifyContent="space-between">
      <Text dimColor>{label}</Text>
      <Text tabular>
        {fmtTokens(tokens)}
        <Text dimColor>{`  ${fmtUsd(usd)}`}</Text>
      </Text>
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      {card.status === 'running' && (
        <Box flexDirection="column">
          {heading(kit, 'Now')}
          <Box flexDirection="column" borderStyle="round" borderColor={statusColor(card)} paddingX={1} overflow="hidden">
            {card.activity ? (
              <Text wrap="truncate-middle">
                <Text weight="semibold">{card.activity.tool}</Text>
                {`  ${card.activity.target}`}
              </Text>
            ) : (
              <Text dimColor italic>
                thinking…
              </Text>
            )}
            {card.lastText !== undefined && (
              <Text dimColor italic wrap="truncate-end">
                “{card.lastText}”
              </Text>
            )}
          </Box>
        </Box>
      )}
      {card.status === 'done' && card.result !== undefined && (
        <Box flexDirection="column">
          {heading(kit, 'Result')}
          <Text color={OK} wrap="wrap">
            ✓ {card.result}
          </Text>
        </Box>
      )}
      {(card.status === 'error' || card.status === 'killed') && (
        <Box flexDirection="column">
          {heading(kit, card.status === 'error' ? 'Error' : 'Stopped')}
          <Text color={statusColor(card)} wrap="wrap">
            {card.status === 'error' ? `✕ ${card.lastText ?? 'it ended without an answer'}` : '■ stopped by TaskStop'}
          </Text>
        </Box>
      )}
      <Box flexDirection="column">
        {heading(kit, 'Operations', card.history.length)}
        {earlier > 0 && <Text dimColor>{`… ${earlier} earlier`}</Text>}
        {steps.length === 0 && <Text dimColor>No tool calls yet</Text>}
        {steps.map(step => (
          <Box key={`op:${step.id}`} flexDirection="row" gap={1}>
            <Text color={glyphColor(step)}>{glyph(step)}</Text>
            <Text weight="semibold">{step.tool}</Text>
            <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
              <Text dimColor wrap="truncate-middle">
                {step.target}
              </Text>
            </Box>
            {step.note !== undefined && (
              <Text dimColor={step.status !== 'error'} color={step.status === 'error' ? ERR : undefined} tabular>
                {step.note}
              </Text>
            )}
          </Box>
        ))}
      </Box>
      <Box flexDirection="column">
        {heading(kit, 'Files', card.files.length)}
        {card.files.length === 0 && <Text dimColor>No files touched yet</Text>}
        {card.files.map(file => (
          <Box key={`file:${file.path}`} flexDirection="row" gap={1}>
            <Text>
              {file.ops.map(op => (
                <Text color="#FFFFFF" backgroundColor={FILE_OP[op].color}>{` ${op} `}</Text>
              ))}
            </Text>
            <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
              <Text wrap="truncate-start">{shortPath(file.path)}</Text>
            </Box>
            {file.added + file.removed > 0 && (
              <Text tabular>
                <Text color={OK}>{`+${file.added}`}</Text> <Text color={ERR}>{`−${file.removed}`}</Text>
              </Text>
            )}
          </Box>
        ))}
      </Box>
      <Box flexDirection="column">
        {heading(kit, 'Tokens & cost')}
        {row('↓ input', card.tokensIn, cost?.input)}
        {row('↑ output', card.tokensOut, cost?.output)}
        {row('✎ cache write', card.tokensCacheWrite, cost?.cacheWrite)}
        {row('⟲ cache read', card.tokensCacheRead, cost?.cacheRead)}
        <Box flexDirection="row" justifyContent="space-between">
          <Text weight="semibold">{`Total · ${modelLabel(card.model)}`}</Text>
          <Text weight="semibold" tabular>
            {fmtUsd(cost?.total)}
          </Text>
        </Box>
        <Text dimColor wrap="wrap">
          {priceNote(card)}
        </Text>
      </Box>
    </Box>
  )
}

// A running process can be stopped, with a second press to confirm; an ended one folds its command behind ▸.
function drawProcess(kit: Kit, proc: BgProcess, owner: string, isOpen: boolean) {
  const { Box, Text, Button, tick } = kit
  const style = PROCESS_STYLE[proc.kind]
  const isRunning = proc.status === 'running'
  const elapsed = (proc.endedAt ?? Math.max(tick, proc.startedAt)) - proc.startedAt
  const SPINNER = ['◐', '◓', '◑', '◒']
  const glyph = isRunning ? (SPINNER[Math.floor(tick / 1000) % SPINNER.length] ?? style.glyph) : style.glyph
  const end = proc.status === 'running' ? undefined : PROCESS_END[proc.status]
  const isConfirming = isRunning && kit.confirming === proc.id

  return (
    <Box key={proc.id} flexDirection="column" borderStyle="round" borderColor={end ? end.color : style.color} paddingX={1} overflow="hidden">
      <Box flexDirection="row" gap={1}>
        <Text color={style.color} weight="semibold" dimColor={!isRunning}>
          {glyph}
        </Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Text weight="semibold" wrap="truncate-end">
            {proc.description}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Text color="#FFFFFF" backgroundColor={style.color}>
              {' '}
              {style.label}{' '}
            </Text>
            <Text dimColor tabular>
              ⏱ {fmtDuration(elapsed)}
            </Text>
            <Box flexShrink={1} minWidth={0} overflow="hidden">
              <Text dimColor wrap="truncate-end">
                · {owner}
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
      {proc.command !== '' && (isRunning || isOpen) && (
        <Text dimColor wrap={isOpen ? 'wrap' : 'truncate-middle'}>
          $ {proc.command}
        </Text>
      )}
      {isRunning && drawBar(kit, style.color, undefined, true, proc.id)}
      <Box flexDirection="row" gap={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          {end ? (
            <Text color={end.color} wrap={isOpen ? 'wrap' : 'truncate-end'}>
              {end.text}
              {proc.summary ? `  ${proc.summary}` : ''}
            </Text>
          ) : (
            <Text color={style.color} italic wrap="truncate-end">
              ● running in background…
            </Text>
          )}
        </Box>
        {isRunning && !isConfirming && <Button plain key={`stop:${proc.id}`} label="■ Stop" onPress={() => void kit.askStop(proc.id)} />}
        {!isRunning && proc.command !== '' && (
          <Button plain key={`more:${proc.id}`} label={isOpen ? '▾' : '▸'} onPress={() => void kit.toggle(proc.id)} />
        )}
      </Box>
      {isConfirming && (
        <Box flexDirection="row" gap={1}>
          <Text color={WARN}>Stop it?</Text>
          <Box flexGrow={1} />
          <Button key={`stop:${proc.id}`} label="Stop" onPress={() => void kit.stop(proc.id)} />
          <Button plain key={`keep:${proc.id}`} label="Keep running" onPress={() => void kit.askStop('')} />
        </Box>
      )}
    </Box>
  )
}
