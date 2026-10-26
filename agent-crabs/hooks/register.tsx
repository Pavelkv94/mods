import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, AgentCard, BgProcess, Step } from '../types'
import { drawPane } from './lib/draw'
import type { Kit } from './lib/draw'
import { firstLine, fmtDuration, targetOf, toolLabel } from './lib/format'
import { addSpend, NO_SPEND, spendOf } from './lib/models'
import { CRAB_COLORS } from './lib/theme'
import { addFile, fileTouchOf, kindOf, planOf } from './lib/tools'

const PANE = 'agent-crabs'
const TITLE = 'Agents & processes'
// the dock's width in columns; a width dragged by hand still wins
const COLUMNS = 46
const KEEP = 20
// per card: the operations it remembers
const KEEP_STEPS = 40
// how often the ticker asks the engine where the subagents stand and checks deadlines
const RECONCILE_MS = 10_000
// with no task list from the engine to check against, a process unheard of this long is marked stale
const STALE_MS = 20 * 60_000
// a subagent the engine no longer lists is over, once it had time to show up there
const AGENT_GONE_MS = 30_000
const MONITOR_GRACE_MS = 5_000

const agents = atom({ plugin: 'agent-crabs', key: 'agents' } as const, [])
const processes = atom({ plugin: 'agent-crabs', key: 'processes' } as const, [])
const windowSize = atom({ plugin: 'agent-crabs', key: 'window' } as const, 0)
const clockNow = atom({ plugin: 'agent-crabs', key: 'now' } as const, 0)
// set when the person closes the pane by hand: their prompts stop reopening it until /crabs
const closedByHand = atom({ plugin: 'agent-crabs', key: 'closedByHand' } as const, false)
const expanded = atom({ plugin: 'agent-crabs', key: 'expanded' } as const, [])
const confirmStop = atom({ plugin: 'agent-crabs', key: 'confirmStop' } as const, '')

// The person's own prompt counts as asking, so a pane opened from its hook is placed at any width,
// where the open from session.start waits undrawn below 144 columns.
async function openOnPrompt($: EngineInterface) {
  if (await read($, closedByHand)) return
  const panes = await $.ui.panes().catch(() => [])
  if (panes.some(pane => pane.id === PANE && pane.isPlaced)) return
  await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
}

function blank(id: string, now: number, crab: number): AgentCard {
  return {
    ...NO_SPEND,
    id,
    role: 'subagent',
    description: '',
    model: '',
    startedAt: now,
    status: 'running',
    tokensIn: 0,
    tokensOut: 0,
    tokensCacheWrite: 0,
    tokensCacheRead: 0,
    ctx: 0,
    steps: 0,
    tools: 0,
    history: [],
    files: [],
    crab,
    lastEventAt: now,
  }
}

// A card kept in the session's state by an earlier version lacks the newer fields;
// its spend is rebuilt from its token counts at its model's price.
function normalize(card: AgentCard): AgentCard {
  const tokens = {
    input_tokens: card.tokensIn,
    output_tokens: card.tokensOut,
    cache_read_input_tokens: card.tokensCacheRead ?? 0,
    cache_creation_input_tokens: card.tokensCacheWrite ?? 0,
  }
  const spend = card.costIn === undefined ? (spendOf(card.model, tokens) ?? { ...NO_SPEND, unpriced: true }) : {}
  return {
    ...card,
    ...spend,
    tokensCacheWrite: card.tokensCacheWrite ?? 0,
    tokensCacheRead: card.tokensCacheRead ?? 0,
    history: card.history ?? [],
    files: card.files ?? [],
  }
}

// Cards the person cleared or the list evicted: late events for them must not bring back a blank card.
const dismissed = new Set<string>()

async function upsert($: EngineInterface, id: string, fn: (card: AgentCard) => AgentCard) {
  if (dismissed.has(id)) return
  const now = await $.clock.now()
  await update($, agents, list => {
    const found = list.find(card => card.id === id)
    if (found) return list.map(card => (card.id === id ? fn(normalize(card)) : card))
    const kept = list.length >= KEEP ? dropOldestDone(list) : list
    return [...kept, fn(blank(id, now, pickCrab(kept)))]
  })
}

function pickCrab(list: readonly AgentCard[]): number {
  const free = (taken: readonly AgentCard[]) => {
    const used = new Set(taken.map(card => card.crab))
    return CRAB_COLORS.findIndex((_, i) => !used.has(i))
  }
  const unused = free(list)
  if (unused !== -1) return unused
  const notRunning = free(list.filter(card => card.status === 'running'))
  return notRunning !== -1 ? notRunning : list.length % CRAB_COLORS.length
}

function dropOldestDone(list: readonly AgentCard[]): readonly AgentCard[] {
  const oldest = list.filter(card => card.status !== 'running').sort((a, b) => a.startedAt - b.startedAt)[0]
  if (!oldest) return list
  dismissed.add(oldest.id)
  return list.filter(card => card !== oldest)
}

// The Agent tool's record, once a subagent returns, says how long its cache writes are kept and its speed.
function agentRecordOf(result: unknown): { agentId: string; share?: number; fast: boolean } | undefined {
  const record = result as {
    agentId?: unknown
    usage?: { cache_creation?: { ephemeral_1h_input_tokens?: unknown; ephemeral_5m_input_tokens?: unknown } | null; speed?: unknown }
  } | null
  if (!record || typeof record.agentId !== 'string' || !record.usage) return undefined
  const hour = Number(record.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0)
  const five = Number(record.usage.cache_creation?.ephemeral_5m_input_tokens ?? 0)
  return {
    agentId: record.agentId,
    ...(hour + five > 0 ? { share: hour / (hour + five) } : {}),
    fast: record.usage.speed === 'fast',
  }
}

// what a tool call this module makes itself came to, or why it could not run
type Ran = { deny?: string; isError?: boolean }

let fallbackIds = 0
let lastReconcileAt = 0
// the engine has handed this module its list of background tasks at least once
let hasTaskList = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'crabs', description: 'Show the pane of subagents and background processes' })
    void $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
    void $.session
      .usage()
      .then(usage => measure($, usage))
      .catch(() => undefined)
    $.clock.every(1000, () => {
      void (async () => {
        const [list, procs] = await Promise.all([read($, agents), read($, processes)])
        const isLive = (item: { status: string }) => item.status === 'running'
        if (!list.some(isLive) && !procs.some(isLive)) return
        const now = await $.clock.now()
        if (now - lastReconcileAt >= RECONCILE_MS) {
          lastReconcileAt = now
          try {
            await reconcile($, now)
          } catch {
            // the next tick tries again
          }
        }
        await update($, clockNow, () => now)
      })()
    })

    return next(e)
  })

  on('command.run', { command: 'crabs' }, async $ => {
    await update($, closedByHand, () => false)
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })

    return {
      text: opened.isPlaced ? 'Agents & processes pane is open.' : `The pane is not placed: ${opened.reason}`,
    }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, closedByHand, () => true)

    return next(e)
  })

  // After each main-thread turn the engine measures the window: a subagent's context fill is read against it.
  on('session.measure', async ($, e, next) => {
    try {
      await measure($, e)
    } catch {
      // the pane keeps the last figures
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId === undefined) return started
    try {
      const role = e.name ? `${e.subagentType} · ${e.name}` : e.subagentType
      await upsert($, started.agentId, card => ({
        ...card,
        role,
        description: e.description,
        model: card.model || started.model,
        ...(e.parentAgentId !== undefined ? { parentId: e.parentAgentId } : {}),
      }))
    } catch {
      // the spawn already happened; the card simply stays as it is
    }

    return started
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) return yield* next(e)
    const agentId = e.agentId
    const stepAt = await $.clock.now()
    await upsert($, agentId, card => ({
      ...card,
      ...(card.status === 'running' ? {} : { startedAt: stepAt, endedAt: undefined, result: undefined }),
      model: e.model,
      effort: e.effort === undefined ? card.effort : String(e.effort),
      steps: card.steps + 1,
      status: 'running',
      lastEventAt: stepAt,
    }))
    const result = yield* next(e)
    const usage = result.usage
    const said = firstLine(result.answer ?? '', 200)
    const doneAt = await $.clock.now()
    await upsert($, agentId, card => {
      const model = usage?.model || card.model
      const counted: AgentCard = {
        ...card,
        lastEventAt: doneAt,
        ...(said !== '' ? { lastText: said } : {}),
        ...(usage
          ? {
              model,
              ctx: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
              tokensIn: card.tokensIn + usage.input_tokens,
              tokensOut: card.tokensOut + usage.output_tokens,
              tokensCacheWrite: card.tokensCacheWrite + usage.cache_creation_input_tokens,
              tokensCacheRead: card.tokensCacheRead + usage.cache_read_input_tokens,
            }
          : {}),
      }
      return usage ? addSpend(counted, spendOf(model, usage)) : counted
    })

    return result
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    const agentId = e.agentId
    const startedAt = await $.clock.now()
    const activity: Activity | undefined =
      agentId === undefined
        ? undefined
        : {
            id: e.tool_use_id ?? `${tool}:${(fallbackIds += 1)}`,
            tool: toolLabel(tool),
            target: targetOf(args),
            kind: kindOf(tool),
          }
    if (agentId !== undefined && activity) {
      const step: Step = { ...activity, status: 'running', startedAt }
      const plan = tool === 'TodoWrite' ? planOf(args) : undefined
      await upsert($, agentId, card => ({
        ...card,
        activity,
        tools: card.tools + 1,
        lastEventAt: startedAt,
        history: [...card.history, step].slice(-KEEP_STEPS),
        ...(plan ? { plan } : {}),
      }))
    }
    const ran = await next(e)
    try {
      if (agentId !== undefined && activity) {
        const endedAt = await $.clock.now()
        const failed = ran.deny !== undefined || ran.isError === true
        const touch = failed ? undefined : fileTouchOf(tool, args)
        const note = ran.deny !== undefined
          ? 'denied'
          : failed
            ? 'failed'
            : touch && touch.op !== 'R'
              ? `+${touch.added} −${touch.removed}`
              : endedAt - startedAt >= 1000
                ? fmtDuration(endedAt - startedAt)
                : undefined
        await upsert($, agentId, card => ({
          ...card,
          lastEventAt: endedAt,
          ...(card.activity?.id === activity.id ? { activity: undefined } : {}),
          history: card.history.map(step =>
            step.id === activity.id
              ? { ...step, status: failed ? ('error' as const) : ('ok' as const), endedAt, ...(note ? { note } : {}) }
              : step,
          ),
          ...(touch ? { files: addFile(card.files, touch) } : {}),
        }))
      }
      if (tool === 'Agent' && ran.deny === undefined && !ran.isError) {
        const record = agentRecordOf(ran.result)
        if (record) {
          await upsert($, record.agentId, card => ({
            ...card,
            ...(record.share !== undefined ? { cacheWrite1hShare: record.share } : {}),
            fast: record.fast,
          }))
        }
      }
      if (ran.deny === undefined && !ran.isError) await trackProcess($, tool, args, ran.result, agentId)
    } catch {
      // the tool already ran; the panel just misses this update
    }

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      try {
        await openOnPrompt($)
      } catch {
        // the prompt goes on; /crabs still opens the pane
      }
    }
    if (e.origin.kind === 'task-notification') {
      try {
        await endFromNotification($, e.text)
      } catch {
        // the notification still reaches the model
      }
    }

    return next(e)
  })

  // A notification that lands while a turn runs reaches the model as an attachment, not a new prompt.
  on('prompt.attachment', async ($, e, next) => {
    if (e.text.includes('<task-notification')) {
      try {
        await endFromNotification($, e.text)
      } catch {
        // the attachment still reaches the model
      }
    }

    return next(e)
  })

  // At each stop the engine lists the background work still in flight: what is not there has ended.
  on('classic.Stop', async ($, e, next) => {
    try {
      if (e.background_tasks) await applyTaskList($, e.background_tasks, () => true)
    } catch {
      // the panel keeps what it had
    }

    return next(e)
  })

  // A subagent's list may hold its own work alone, so only its own processes are checked against it.
  on('classic.SubagentStop', async ($, e, next) => {
    try {
      if (e.background_tasks) await applyTaskList($, e.background_tasks, proc => proc.owner === e.agent_id)
    } catch {
      // the panel keeps what it had
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const agentId = e.agentId
      const now = await $.clock.now()
      const answer = firstLine(e.answer ?? '', 200)
      await upsert($, agentId, card => ({
        ...card,
        // a TaskStop already said how it ended
        status: card.status === 'killed' ? 'killed' : e.reason === 'answer' ? 'done' : 'error',
        endedAt: card.endedAt ?? now,
        activity: undefined,
        history: card.history.map(step => (step.status === 'running' ? { ...step, status: 'error' as const, endedAt: now } : step)),
        ...(answer !== '' ? { result: answer } : {}),
      }))
      // its commands the engine ends with this final response send no notification
      await update($, processes, all =>
        all.map(proc =>
          proc.owner === agentId && proc.endsWithOwner && proc.status === 'running'
            ? { ...proc, status: 'killed' as const, endedAt: now, summary: proc.summary ?? 'ended with its agent' }
            : proc,
        ),
      )
      await update($, clockNow, () => now)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg
    const list = (await read($, agents)).map(normalize)
    const procs = await read($, processes)
    const window = await read($, windowSize)
    const open = new Set(await read($, expanded))
    const confirming = await read($, confirmStop)
    // the ticker's value only subscribes this drawing to redraw each second
    await read($, clockNow)
    const tick = await $.clock.now()
    const kit: Kit = {
      Box,
      Text,
      Button,
      Svg,
      inner: Math.max(16, e.props.bodyColumns - 4),
      tick,
      window: window > 0 ? window : undefined,
      busy: new Set(list.filter(card => card.status === 'running' && card.parentId !== undefined).map(card => card.parentId as string)),
      confirming,
      askStop: async (id: string) => {
        await update($, confirmStop, () => id)
      },
      stop: async (id: string) => {
        await update($, confirmStop, () => '')
        // the same TaskStop the model would make; a call of this module's own skips its tool.call hook,
        // so the card is marked here
        const ran: Ran = await $.tool.call({ tool: 'TaskStop', task_id: id } as never).catch((error: unknown) => ({ deny: String(error) }))
        if (ran.deny !== undefined || ran.isError) {
          await $.ui.toast(`Could not stop it: ${ran.deny ?? 'TaskStop failed'}`)
          return
        }
        await endTask($, id, 'killed', await $.clock.now())
      },
      toggle: async (id: string) => {
        await update($, expanded, ids => (ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]))
      },
      clear: async () => {
        // both writes leave together, so the redraw the first one causes cannot strand the second
        await Promise.all([
          update($, agents, all => {
            for (const card of all) if (card.status !== 'running') dismissed.add(card.id)
            return all.filter(card => card.status === 'running')
          }),
          update($, processes, all => all.filter(proc => proc.status === 'running')),
        ])
      },
    }

    return drawPane(kit, { list, procs, open })
  })
}

async function measure($: EngineInterface, { context }: { context: { window: number } }) {
  await update($, windowSize, () => context.window)
}

async function trackProcess(
  $: EngineInterface,
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
  owner: string | undefined,
) {
  if (tool === 'TaskStop') {
    const id = args.task_id ?? args.shell_id
    if (typeof id === 'string') await endTask($, id, 'killed', await $.clock.now())
    return
  }
  if (tool !== 'Bash' && tool !== 'Monitor') return
  const out = (result ?? {}) as {
    backgroundTaskId?: unknown
    taskId?: unknown
    timeoutMs?: unknown
    persistent?: unknown
    backgroundEndsWithFinalResponse?: unknown
  }
  const id = tool === 'Bash' ? out.backgroundTaskId : out.taskId
  if (typeof id !== 'string' || id === '') return
  const command = typeof args.command === 'string' ? args.command : ''
  const ws = (args.ws as { url?: unknown } | undefined)?.url
  const source = command || (typeof ws === 'string' ? ws : '')
  const description = typeof args.description === 'string' && args.description !== '' ? args.description : source
  const startedAt = await $.clock.now()
  const timeoutMs = typeof out.timeoutMs === 'number' && out.persistent !== true ? out.timeoutMs : 0
  const proc: BgProcess = {
    id,
    kind: tool === 'Bash' ? 'shell' : 'monitor',
    description: firstLine(description) || 'background task',
    command: firstLine(source, 200),
    owner,
    startedAt,
    status: 'running',
    ...(timeoutMs > 0 ? { deadlineAt: startedAt + timeoutMs } : {}),
    ...(out.backgroundEndsWithFinalResponse === true ? { endsWithOwner: true } : {}),
  }
  await update($, processes, list => {
    const rest = list.filter(item => item.id !== id)
    const kept = rest.length >= KEEP ? dropOldestProcess(rest) : rest
    return [...kept, proc]
  })
}

function dropOldestProcess(list: readonly BgProcess[]): readonly BgProcess[] {
  const oldest = list.filter(item => item.status !== 'running').sort((a, b) => a.startedAt - b.startedAt)[0]
  return oldest ? list.filter(item => item !== oldest) : list
}

function tagOf(text: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1]?.trim()
}

function tagsOf(text: string, tag: string): string[] {
  return [...text.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => (m[1] ?? '').trim())
}

type Ending = { id: string; status: 'done' | 'error' | 'killed'; summary?: string }

// Each <task-notification> block names one task and how it ended; several can come in one text.
function endingsOf(text: string): Ending[] {
  const blocks = tagsOf(text, 'task-notification')
  return (blocks.length > 0 ? blocks : [text]).flatMap(block => {
    const word = (tagOf(block, 'status') ?? 'completed').toLowerCase()
    const status = word === 'completed' ? 'done' : word === 'killed' || word === 'stopped' ? 'killed' : 'error'
    const summary = tagOf(block, 'summary')
    const ids = [...tagsOf(block, 'task-id'), ...tagsOf(block, 'shell-id')].filter(id => id !== '')
    return [...new Set(ids)].map(id => ({ id, status, ...(summary === undefined ? {} : { summary: firstLine(summary) }) }))
  })
}

// Ids this panel never saw are left alone.
async function endFromNotification($: EngineInterface, text: string) {
  const endings = endingsOf(text)
  if (endings.length === 0) return
  const now = await $.clock.now()
  for (const ending of endings) await endTask($, ending.id, ending.status, now, ending.summary)
}

// One id names either a background process or a subagent: whichever card holds it, while it runs.
async function endTask($: EngineInterface, id: string, status: Ending['status'], now: number, summary?: string) {
  await update($, processes, list =>
    list.map(item =>
      item.id === id && (item.status === 'running' || item.status === 'stale')
        ? { ...item, status, endedAt: now, summary: summary ?? item.summary }
        : item,
    ),
  )
  await endAgent($, id, status, now)
  await update($, clockNow, () => now)
}

async function endAgent($: EngineInterface, id: string, status: AgentCard['status'], now: number) {
  await update($, agents, list =>
    list.map(card =>
      card.id === id && card.status === 'running'
        ? {
            ...card,
            status,
            endedAt: now,
            activity: undefined,
            history: (card.history ?? []).map(step =>
              step.status === 'running' ? { ...step, status: status === 'done' ? ('ok' as const) : ('error' as const), endedAt: now } : step,
            ),
          }
        : card,
    ),
  )
}

type TaskSummary = { id: string; type: string; status: string; description: string; command?: string }

// The engine's list of background work still in flight: a running process it leaves out has ended,
// one it names is alive, and one it names that the panel lost (cleared, or started before a reload) comes back.
async function applyTaskList($: EngineInterface, tasks: readonly TaskSummary[], isChecked: (proc: BgProcess) => boolean) {
  hasTaskList = true
  const now = await $.clock.now()
  const live = new Map(tasks.map(task => [task.id, task]))
  await update($, processes, list => {
    const known = new Set(list.map(proc => proc.id))
    const checked = list.map(proc => {
      if (live.has(proc.id)) {
        return proc.status === 'running' || proc.status === 'stale'
          ? { ...proc, status: 'running' as const, endedAt: undefined, lastSeenAt: now }
          : proc
      }
      if ((proc.status === 'running' || proc.status === 'stale') && isChecked(proc)) {
        return { ...proc, status: 'done' as const, endedAt: now, summary: proc.summary ?? 'not in the engine task list' }
      }
      return proc
    })
    const back: BgProcess[] = tasks
      .filter(task => !known.has(task.id) && (task.type === 'shell' || task.type === 'monitor'))
      .map(task => ({
        id: task.id,
        kind: task.type === 'shell' ? 'shell' : 'monitor',
        description: firstLine(task.description) || 'background task',
        command: firstLine(task.command ?? '', 200),
        startedAt: now,
        lastSeenAt: now,
        status: 'running',
      }))
    let kept: readonly BgProcess[] = checked
    for (const proc of back) kept = [...(kept.length >= KEEP ? dropOldestProcess(kept) : kept), proc]
    return [...kept]
  })
  await update($, clockNow, () => now)
}

// Between stops: where the engine says each subagent stands, the Monitors past their deadline,
// and, with no task list ever given to check against, the processes unheard of too long.
async function reconcile($: EngineInterface, now: number) {
  const cards = await read($, agents)
  if (cards.some(card => card.status === 'running')) {
    const infos = await $.agent.list()
    const byId = new Map(infos.map(info => [info.id, info]))
    for (const card of cards) {
      if (card.status !== 'running') continue
      const info = byId.get(card.id)
      if (info === undefined) {
        if (now - card.startedAt > AGENT_GONE_MS) await endAgent($, card.id, 'done', now)
        continue
      }
      if (info.status === 'completed' || info.status === 'idle') await endAgent($, card.id, 'done', now)
      else if (info.status === 'failed') await endAgent($, card.id, 'error', now)
      else if (info.status === 'killed') await endAgent($, card.id, 'killed', now)
    }
  }
  await update($, processes, list =>
    list.map(proc => {
      if (proc.status !== 'running') return proc
      if (proc.deadlineAt !== undefined && now > proc.deadlineAt + MONITOR_GRACE_MS) {
        return { ...proc, status: 'done' as const, endedAt: proc.deadlineAt, summary: proc.summary ?? 'monitor deadline passed' }
      }
      if (!hasTaskList && now - (proc.lastSeenAt ?? proc.startedAt) > STALE_MS) {
        return { ...proc, status: 'stale' as const, endedAt: now }
      }
      return proc
    }),
  )
}
