import { atom, read, update } from 'claude-code'
import type { BoxProps, ButtonProps, ElementConstructor, EngineInterface, Register, SvgProps, TextProps } from 'claude-code'

import type { Activity, ActivityKind, AgentCard, BgProcess, FileOp, FileTouch, Plan, ProcessKind, Step } from '../types'

const PANE = 'agent-crabs'
const TITLE = 'Agents & processes'
// the dock's width in columns; a width dragged by hand still wins
const COLUMNS = 46
const KEEP = 20
// per card: the operations and files it remembers, and how many operations an open card lists
const KEEP_STEPS = 40
const KEEP_FILES = 30
const SHOW_STEPS = 10
// how often the ticker asks the engine where the subagents stand and checks deadlines
const RECONCILE_MS = 10_000
// with no task list from the engine to check against, a process unheard of this long is marked stale
const STALE_MS = 20 * 60_000
// a subagent the engine no longer lists is over, once it had time to show up there
const AGENT_GONE_MS = 30_000
const MONITOR_GRACE_MS = 5_000

const agents = atom({ plugin: 'agent-crabs', key: 'agents' } as const, [])
const processes = atom({ plugin: 'agent-crabs', key: 'processes' } as const, [])
const clockNow = atom({ plugin: 'agent-crabs', key: 'now' } as const, 0)
// set when the person closes the pane by hand: their prompts stop reopening it until /crabs
const closedByHand = atom({ plugin: 'agent-crabs', key: 'closedByHand' } as const, false)
const expanded = atom({ plugin: 'agent-crabs', key: 'expanded' } as const, [])

// green and red are kept for finished and failed agents
const CRAB_COLORS = ['#D97757', '#58A6FF', '#BC8CFF', '#F2CC60', '#39C5CF', '#FF7EB6', '#E3A15B']
const OK = '#3FB950'
const ERR = '#F85149'
const MUTED = '#8B949E'

const MODEL_COLORS: Record<string, string> = {
  opus: '#BC8CFF',
  sonnet: '#58A6FF',
  haiku: '#39C5CF',
  fable: '#D97757',
  mythos: '#D97757',
}

// API list prices per million tokens: input, output, cache read; a cache write is 1.25× input.
// Under a subscription nothing is billed per token, so the pane calls it the API-equivalent cost.
const PRICES: Record<string, readonly [number, number, number]> = {
  'fable-5.1': [10, 50, 0.25],
  'mythos-5.1': [10, 50, 0.25],
  'fable-5': [10, 50, 1],
  'opus-5.5': [4, 20, 0.2],
  'opus-5': [5, 25, 0.5],
  'opus-4.8': [5, 25, 0.5],
  'opus-4.7': [5, 25, 0.5],
  'opus-4.6': [5, 25, 0.5],
  'sonnet-5.5': [2, 10, 0.2],
  'sonnet-5': [2, 10, 0.2],
  'sonnet-4.6': [3, 15, 0.3],
  'haiku-5.5': [0.1, 0.5, 0.01],
  'haiku-4.5': [1, 5, 0.1],
}

const KIND_STYLE: Record<ActivityKind, { color: string; verb: string }> = {
  read: { color: '#58A6FF', verb: 'reading' },
  edit: { color: '#E3A15B', verb: 'editing' },
  run: { color: '#BC8CFF', verb: 'running' },
  web: { color: '#39C5CF', verb: 'browsing' },
  agent: { color: '#FF7EB6', verb: 'delegating' },
  other: { color: MUTED, verb: 'calling' },
}

const FILE_OP: Record<FileOp, { color: string; title: string }> = {
  R: { color: '#58A6FF', title: 'read' },
  E: { color: '#E3A15B', title: 'edited' },
  W: { color: OK, title: 'written' },
}

const PROCESS_STYLE: Record<ProcessKind, { color: string; label: string; glyph: string }> = {
  shell: { color: '#BC8CFF', label: 'shell', glyph: '❯' },
  monitor: { color: '#39C5CF', label: 'monitor', glyph: '◉' },
}

const PROCESS_END: Record<Exclude<BgProcess['status'], 'running'>, { color: string; text: string }> = {
  done: { color: OK, text: '✓ finished' },
  error: { color: ERR, text: '✕ failed' },
  killed: { color: MUTED, text: '■ stopped' },
  stale: { color: '#D29922', text: '? no word, probably finished' },
}

const AGENT_STATUS: Record<AgentCard['status'], { text: string }> = {
  running: { text: '● running' },
  done: { text: '✓ done' },
  error: { text: '✕ failed' },
  killed: { text: '■ stopped' },
}

// The person's own prompt counts as asking, so a pane opened from its hook is placed at any width,
// where the open from session.start waits undrawn below 144 columns.
async function openOnPrompt($: EngineInterface) {
  if (await read($, closedByHand)) return
  const panes = await $.ui.panes().catch(() => [])
  if (panes.some(pane => pane.id === PANE && pane.isPlaced)) return
  await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
}

const SPINNER = ['◐', '◓', '◑', '◒']

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const RUN_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor'])
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch'])
const AGENT_TOOLS = new Set(['Agent', 'Task', 'SendMessage'])

function kindOf(tool: string): ActivityKind {
  if (READ_TOOLS.has(tool)) return 'read'
  if (EDIT_TOOLS.has(tool)) return 'edit'
  if (RUN_TOOLS.has(tool)) return 'run'
  if (WEB_TOOLS.has(tool)) return 'web'
  if (AGENT_TOOLS.has(tool)) return 'agent'
  return 'other'
}

function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 4 ? '…/' + parts.slice(-3).join('/') : path
}

function targetOf(args: Record<string, unknown>): string {
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined)
  const path = str('file_path') ?? str('notebook_path') ?? str('path')
  if (path !== undefined) {
    const pattern = str('pattern')
    return pattern !== undefined ? `${pattern} in ${shortPath(path)}` : shortPath(path)
  }
  const text = str('pattern') ?? str('command') ?? str('url') ?? str('query') ?? str('description') ?? str('prompt') ?? ''
  const line = text.split('\n')[0] ?? ''
  return line.length > 80 ? line.slice(0, 79) + '…' : line
}

function toolLabel(tool: string): string {
  const mcp = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(tool)
  return mcp?.[1] ?? tool
}

function modelParts(model: string): { family: string; version: string } | undefined {
  const full = /(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(model)
  if (full) {
    const [, family = '', major = '', minor] = full
    return { family: family.toLowerCase(), version: minor ? `${major}.${minor}` : major }
  }
  const family = /(opus|sonnet|haiku|fable|mythos)/i.exec(model)?.[1]?.toLowerCase()
  return family ? { family, version: '' } : undefined
}

function modelLabel(model: string): string {
  const parts = modelParts(model)
  if (!parts) return model || '…'
  const name = parts.family.charAt(0).toUpperCase() + parts.family.slice(1)
  return parts.version ? `${name} ${parts.version}` : name
}

function modelColor(model: string): string {
  return MODEL_COLORS[modelParts(model)?.family ?? ''] ?? MUTED
}

type Cost = { input: number; output: number; cacheWrite: number; cacheRead: number; total: number }

function costOf(card: AgentCard): Cost | undefined {
  const parts = modelParts(card.model)
  const price = parts ? PRICES[`${parts.family}-${parts.version}`] : undefined
  if (!price) return undefined
  const [pin, pout, pread] = price
  const input = (card.tokensIn * pin) / 1e6
  const output = (card.tokensOut * pout) / 1e6
  const cacheWrite = (card.tokensCacheWrite * pin * 1.25) / 1e6
  const cacheRead = (card.tokensCacheRead * pread) / 1e6
  return { input, output, cacheWrite, cacheRead, total: input + output + cacheWrite + cacheRead }
}

function fmtUsd(v: number | undefined): string {
  if (v === undefined) return '$—'
  if (v === 0) return '$0'
  if (v < 0.01) return '$' + v.toFixed(4)
  if (v < 1) return '$' + v.toFixed(3)
  return '$' + v.toFixed(2)
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k'
  return (n / 1_000_000).toFixed(1) + 'M'
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function lineCount(text: unknown): number {
  return typeof text === 'string' && text !== '' ? text.split('\n').length : 0
}

function blank(id: string, now: number, crab: number): AgentCard {
  return {
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
  }
}

// A card kept in the session's state by an earlier version lacks the newer fields.
function normalize(card: AgentCard): AgentCard {
  return {
    ...card,
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

// What one call does to the files: which it touched, how, and the lines it changed.
function fileTouchOf(tool: string, args: Record<string, unknown>): { path: string; op: FileOp; added: number; removed: number } | undefined {
  const path = typeof args.file_path === 'string' ? args.file_path : typeof args.notebook_path === 'string' ? args.notebook_path : undefined
  if (path === undefined) return undefined
  if (tool === 'Read' || tool === 'NotebookRead') return { path, op: 'R', added: 0, removed: 0 }
  if (tool === 'Write') return { path, op: 'W', added: lineCount(args.content), removed: 0 }
  if (tool === 'Edit') return { path, op: 'E', added: lineCount(args.new_string), removed: lineCount(args.old_string) }
  if (tool === 'MultiEdit' && Array.isArray(args.edits)) {
    const edits = args.edits as { old_string?: unknown; new_string?: unknown }[]
    return {
      path,
      op: 'E',
      added: edits.reduce((n, edit) => n + lineCount(edit.new_string), 0),
      removed: edits.reduce((n, edit) => n + lineCount(edit.old_string), 0),
    }
  }
  if (tool === 'NotebookEdit') return { path, op: 'E', added: 0, removed: 0 }
  return undefined
}

function addFile(files: readonly FileTouch[], touch: NonNullable<ReturnType<typeof fileTouchOf>>): FileTouch[] {
  const found = files.find(file => file.path === touch.path)
  if (found) {
    return files.map(file =>
      file === found
        ? {
            ...file,
            ops: file.ops.includes(touch.op) ? file.ops : [...file.ops, touch.op],
            added: file.added + touch.added,
            removed: file.removed + touch.removed,
          }
        : file,
    )
  }
  const next = [...files, { path: touch.path, ops: [touch.op], added: touch.added, removed: touch.removed }]
  return next.length > KEEP_FILES ? next.slice(-KEEP_FILES) : next
}

function planOf(args: Record<string, unknown>): Plan | undefined {
  if (!Array.isArray(args.todos)) return undefined
  const todos = args.todos as { status?: unknown; content?: unknown; activeForm?: unknown }[]
  if (todos.length === 0) return undefined
  const current = todos.find(todo => todo.status === 'in_progress')
  const label = current && (typeof current.activeForm === 'string' ? current.activeForm : current.content)
  return {
    done: todos.filter(todo => todo.status === 'completed').length,
    total: todos.length,
    ...(typeof label === 'string' && label !== '' ? { current: firstLine(label, 80) } : {}),
  }
}

function crabSvg(color: string, status: AgentCard['status']): string {
  // a pixel crab: claws over a body with two eyes, two frames of legs
  const MAP = [
    '..LL........RR..',
    '.LLL........RRR.',
    '.LL..........RR.',
    '..LBBBBBBBBBBR..',
    '...BBBBBBBBBB...',
    '...BBEBBBBEBB...',
    '...BBEBBBBEBB...',
    '...BBBBBBBBBB...',
    '....A.x..x.A....',
    '...A..x..x..A...',
  ]
  const px: Record<string, string> = { L: '', R: '', B: '', A: '', x: '' }
  MAP.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (px[ch] !== undefined) px[ch] += `<rect x="${x}" y="${y}" width="1.05" height="1.05"/>`
    }),
  )
  const isRunning = status === 'running'
  const isDone = status === 'done'
  const disc = (attr: string, values: string, dur: string, begin = '0s') =>
    `<animate attributeName="${attr}" values="${values}" dur="${dur}" begin="${begin}" calcMode="discrete" repeatCount="indefinite"/>`
  const spin = (values: string, dur: string, begin = '0s') =>
    `<animateTransform attributeName="transform" type="rotate" values="${values}" dur="${dur}" begin="${begin}" calcMode="discrete" repeatCount="indefinite"/>`
  // claws snap while it works, are raised when it is done, and hang when it failed
  const clawL = isRunning ? spin('0 3.5 3.5;-22 3.5 3.5', '0.8s') : ''
  const clawR = isRunning ? spin('0 12.5 3.5;22 12.5 3.5', '0.8s', '0.4s') : ''
  const clawLAt = isDone ? 'rotate(-16 3.5 3.5)' : isRunning ? '' : 'rotate(28 3.5 3.5)'
  const clawRAt = isDone ? 'rotate(16 12.5 3.5)' : isRunning ? '' : 'rotate(-28 12.5 3.5)'
  const eye = (x: number) =>
    isDone
      ? `<rect x="${x}" y="5" width="1.05" height="2"><animate attributeName="height" values="2;2;0.3;2" keyTimes="0;0.9;0.94;1" dur="3.6s" repeatCount="indefinite"/><animate attributeName="y" values="5;5;5.85;5" keyTimes="0;0.9;0.94;1" dur="3.6s" repeatCount="indefinite"/></rect>`
      : isRunning
        ? `<rect x="${x}" y="5" width="1.05" height="2"/>`
        : `<rect x="${x}" y="5.6" width="1.05" height="0.8"/>`
  const bob = isRunning
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -0.6" dur="0.4s" calcMode="discrete" repeatCount="indefinite"/>`
    : isDone
      ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 -1.2;0 0" keyTimes="0;0.7;0.75;0.8" dur="3.6s" repeatCount="indefinite"/>`
      : ''
  const scuttle = isRunning
    ? `<animateTransform attributeName="transform" type="translate" values="-1.6 0;1.6 0;-1.6 0" dur="2.6s" repeatCount="indefinite"/>`
    : ''
  const pose = status === 'error' ? ' transform="rotate(-12 8 5) translate(0 1)"' : status === 'killed' ? ' opacity="0.55"' : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2.5 20 14" width="46" height="32" shape-rendering="crispEdges">` +
    `<g${pose}><g>${scuttle}` +
    `<g fill="${color}">${bob}` +
    `<g transform="${clawLAt}">${clawL}${px.L}</g>` +
    `<g transform="${clawRAt}">${clawR}${px.R}</g>` +
    px.B +
    `<g fill="#1b1b1f">${eye(5)}${eye(10)}</g>` +
    `</g>` +
    `<g fill="${color}">${isRunning ? disc('opacity', '1;0', '0.4s') : ''}${px.A}</g>` +
    (isRunning ? `<g fill="${color}" opacity="0">${disc('opacity', '0;1', '0.4s')}${px.x}</g>` : '') +
    `</g></g></svg>`
  )
}

// The bar's own stripes move while it runs; with no known total a striped block slides along instead.
function barSvg(color: string, fraction: number | undefined, isRunning: boolean): string {
  const W = 300
  const H = 6
  const stripes =
    `<defs><pattern id="s" width="8" height="${H}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="4" height="${H}" fill="rgba(255,255,255,0.28)"/>` +
    `<animateTransform attributeName="patternTransform" type="translate" values="0 0;8 0" dur="0.8s" additive="sum" repeatCount="indefinite"/>` +
    `</pattern><clipPath id="c"><rect width="${W}" height="${H}" rx="3"/></clipPath></defs>`
  const track = `<rect width="${W}" height="${H}" rx="3" fill="${color}" opacity="0.18"/>`
  let fill: string
  if (fraction === undefined && isRunning) {
    const seg = 80
    const slide = `<animate attributeName="x" values="${-seg};${W}" dur="1.8s" repeatCount="indefinite"/>`
    fill =
      `<rect y="0" width="${seg}" height="${H}" rx="3" fill="${color}">${slide}</rect>` +
      `<rect y="0" width="${seg}" height="${H}" fill="url(#s)">${slide}</rect>`
  } else {
    const w = Math.max(H, Math.round(W * Math.min(1, fraction ?? 1)))
    fill = `<rect width="${w}" height="${H}" rx="3" fill="${color}"/>` + (isRunning ? `<rect width="${w}" height="${H}" fill="url(#s)"/>` : '')
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="none">${stripes}<g clip-path="url(#c)">${track}${fill}</g></svg>`
}

const ASCII_CRAB = [
  [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  '],
  [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▝▝ ▘▘  '],
]
const ASCII_CRAB_WIDTH = 9

let fallbackIds = 0
let lastReconcileAt = 0
// the engine has handed this module its list of background tasks at least once
let hasTaskList = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'crabs', description: 'Show the pane of subagents and background processes' })
    void $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
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
    }))
    const result = yield* next(e)
    const usage = result.usage
    const said = firstLine(result.answer ?? '', 200)
    if (usage || said !== '') {
      await upsert($, agentId, card => ({
        ...card,
        ...(said !== '' ? { lastText: said } : {}),
        ...(usage
          ? {
              model: usage.model || card.model,
              ctx: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
              tokensIn: card.tokensIn + usage.input_tokens,
              tokensOut: card.tokensOut + usage.output_tokens,
              tokensCacheWrite: card.tokensCacheWrite + usage.cache_creation_input_tokens,
              tokensCacheRead: card.tokensCacheRead + usage.cache_read_input_tokens,
            }
          : {}),
      }))
    }

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
          ...(card.activity?.id === activity.id ? { activity: undefined } : {}),
          history: card.history.map(step =>
            step.id === activity.id
              ? { ...step, status: failed ? ('error' as const) : ('ok' as const), endedAt, ...(note ? { note } : {}) }
              : step,
          ),
          ...(touch ? { files: addFile(card.files, touch) } : {}),
        }))
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
    const open = new Set(await read($, expanded))
    // the ticker's value only subscribes this drawing to redraw each second
    await read($, clockNow)
    const tick = await $.clock.now()
    // the card's inside: the pane less its border and padding
    const inner = Math.max(16, e.props.bodyColumns - 4)
    const kit: Kit = {
      Box,
      Text,
      Button,
      Svg,
      inner,
      toggle: async (id: string) => {
        await update($, expanded, ids => (ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]))
      },
    }
    const runningAgents = list.filter(card => card.status === 'running').length
    const runningProcs = procs.filter(proc => proc.status === 'running').length
    const finished = list.length - runningAgents + procs.length - runningProcs
    const costs = list.map(costOf)
    const spent = costs.reduce((sum, cost) => sum + (cost?.total ?? 0), 0)
    const ownerOf = (id: string | undefined) =>
      id === undefined ? 'main' : (list.find(card => card.id === id)?.role ?? 'subagent')

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text weight="semibold" wrap="truncate-end">
            {list.length + procs.length === 0
              ? 'No subagents or background processes yet'
              : `agents ${runningAgents}/${list.length} · bg ${runningProcs}/${procs.length}`}
            {costs.some(Boolean) ? <Text dimColor tabular>{`  ≈ ${fmtUsd(spent)}`}</Text> : ''}
          </Text>
          {finished > 0 && (
            <Button
              key="clear"
              label="Clear finished"
              hotkey="c"
              onPress={async () => {
                // both writes leave together, so the redraw the first one causes cannot strand the second
                await Promise.all([
                  update($, agents, all => {
                    for (const card of all) if (card.status !== 'running') dismissed.add(card.id)
                    return all.filter(card => card.status === 'running')
                  }),
                  update($, processes, all => all.filter(proc => proc.status === 'running')),
                ])
              }}
            />
          )}
        </Box>
        {list.length > 0 && <Text dimColor>── Subagents ──</Text>}
        {byRecency(list).map(card => drawCard(kit, card, tick, open.has(card.id)))}
        {procs.length > 0 && <Text dimColor>── Background processes ──</Text>}
        {byRecency(procs).map(proc => drawProcess(kit, proc, tick, ownerOf(proc.owner)))}
      </Box>
    )
  })
}

type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Svg?: ElementConstructor<SvgProps>
  inner: number
  toggle: (id: string) => Promise<void>
}

function byRecency<T extends { status: string; startedAt: number }>(list: readonly T[]): T[] {
  return [...list].sort(
    (a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt,
  )
}

function statusColor(card: AgentCard): string {
  if (card.status === 'done') return OK
  if (card.status === 'error') return ERR
  if (card.status === 'killed') return MUTED
  return CRAB_COLORS[card.crab % CRAB_COLORS.length] ?? '#D97757'
}

function drawCrab({ Box, Text, Svg }: Kit, card: AgentCard, tick: number) {
  const color = statusColor(card)
  const isRunning = card.status === 'running'
  if (Svg) {
    return <Svg source={crabSvg(color, card.status)} alt={`crab for ${card.role}`} width={46} height={32} isInteractive />
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

// How far along it is: its own todo list when it keeps one, else unknown while it runs.
function progressOf(card: AgentCard): { fraction: number | undefined; label: string; percent: string } {
  const counts = `${plural(card.steps, 'step')} · ${plural(card.tools, 'tool')}`
  if (card.plan) {
    const fraction = card.status === 'done' ? 1 : card.plan.done / card.plan.total
    const current = card.status === 'running' && card.plan.current ? ` · ${card.plan.current}` : ''
    return { fraction, label: `${card.plan.done}/${card.plan.total} todos${current}`, percent: `${Math.round(fraction * 100)}%` }
  }
  if (card.status === 'running') return { fraction: undefined, label: counts, percent: '' }
  return { fraction: 1, label: counts, percent: '' }
}

function drawBar({ Text, Svg, inner }: Kit, color: string, fraction: number | undefined, isRunning: boolean, tick: number) {
  if (Svg) {
    return <Svg source={barSvg(color, fraction, isRunning)} alt={fraction === undefined ? 'working' : `${Math.round(fraction * 100)}%`} height={6} isInteractive={isRunning} />
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
  const filled = Math.round(width * Math.min(1, fraction))
  return (
    <Text wrap="truncate-end">
      <Text color={color}>{'━'.repeat(filled)}</Text>
      <Text dimColor>{'─'.repeat(width - filled)}</Text>
    </Text>
  )
}

function drawNow({ Box, Text }: Kit, card: AgentCard) {
  if (card.status === 'running' && card.activity) {
    const style = KIND_STYLE[card.activity.kind]
    return (
      <Text color={style.color} wrap="truncate-middle">
        <Text weight="semibold">
          {style.verb} · {card.activity.tool}
        </Text>
        {card.activity.target ? `  ${card.activity.target}` : ''}
      </Text>
    )
  }
  if (card.status === 'running') {
    return (
      <Text dimColor italic>
        thinking…
      </Text>
    )
  }
  if (card.status === 'error') {
    return (
      <Box>
        <Text color={ERR} wrap="truncate-end">
          ✕ ended without an answer
        </Text>
      </Box>
    )
  }
  return undefined
}

function drawCard(kit: Kit, card: AgentCard, tick: number, isOpen: boolean) {
  const { Box, Text, Button } = kit
  const color = statusColor(card)
  const model = modelColor(card.model)
  const elapsed = (card.endedAt ?? Math.max(tick, card.startedAt)) - card.startedAt
  const cost = costOf(card)
  const progress = progressOf(card)
  const isRunning = card.status === 'running'
  const total = card.tokensIn + card.tokensOut + card.tokensCacheWrite + card.tokensCacheRead

  return (
    <Box key={card.id} flexDirection="column" borderStyle="round" borderColor={isRunning ? model : color} paddingX={1} overflow="hidden">
      <Box flexDirection="row" gap={1}>
        {drawCrab(kit, card, tick)}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexShrink={1} minWidth={0} overflow="hidden">
              <Text weight="semibold" wrap="truncate-end">
                {card.role}
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
      {drawBar(kit, color, progress.fraction, isRunning, tick)}
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexShrink={1} minWidth={0} overflow="hidden">
          <Text dimColor wrap="truncate-end">
            {progress.label}
          </Text>
        </Box>
        {progress.percent !== '' && (
          <Text dimColor tabular>
            {progress.percent}
          </Text>
        )}
      </Box>
      <Box flexDirection="row" gap={1}>
        <Text color={color}>{AGENT_STATUS[card.status].text}</Text>
        <Text dimColor tabular>
          ⏱ {fmtDuration(elapsed)}
        </Text>
        <Text dimColor tabular>
          {fmtTokens(total)} tok
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
        <Text dimColor>{`ctx ${fmtTokens(card.ctx)} · API-equivalent list price`}</Text>
      </Box>
    </Box>
  )
}

function drawProcess(kit: Kit, proc: BgProcess, tick: number, owner: string) {
  const { Box, Text } = kit
  const style = PROCESS_STYLE[proc.kind]
  const isRunning = proc.status === 'running'
  const elapsed = (proc.endedAt ?? Math.max(tick, proc.startedAt)) - proc.startedAt
  const glyph = isRunning ? (SPINNER[Math.floor(tick / 1000) % SPINNER.length] ?? style.glyph) : style.glyph
  const end = proc.status === 'running' ? undefined : PROCESS_END[proc.status]

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
      {proc.command !== '' && (
        <Text dimColor wrap="truncate-middle">
          $ {proc.command}
        </Text>
      )}
      {isRunning && drawBar(kit, style.color, undefined, true, tick)}
      {end ? (
        <Text color={end.color} wrap="truncate-end">
          {end.text}
          {proc.summary ? `  ${proc.summary}` : ''}
        </Text>
      ) : (
        <Text color={style.color} italic>
          ● running in background…
        </Text>
      )}
    </Box>
  )
}

function firstLine(text: string, max = 120): string {
  const line = (text.split('\n').find(part => part.trim() !== '') ?? '').trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
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
