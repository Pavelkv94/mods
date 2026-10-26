import type { Activity, CacheConfig } from '../types'

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d opus',
  spend_limit: 'spend',
}

/** Theme keys, so the band follows the person's light or dark theme. */
export const PALETTE = {
  ok: 'success',
  warn: 'warning',
  hot: 'error',
  track: 'inactive',
  muted: 'subtle',
  accent: 'suggestion',
} as const

/** The same tones as raw colors for SVG, which cannot name a theme key; mid tones read on light and dark. */
const SVG_HEX: Record<string, string> = {
  success: '#3fb950',
  warning: '#d29922',
  error: '#f85149',
  inactive: '#8b949e',
  subtle: '#8b949e',
  suggestion: '#58a6ff',
}

export function levelColor(percent: number): string {
  if (percent >= 85) return PALETTE.hot
  if (percent >= 60) return PALETTE.warn
  return PALETTE.ok
}

/** A terminal meter in whole cells: full-height blocks on a shaded track, so the bar fills the row's height. */
export function meter(percent: number, width = 12): { filled: string; empty: string } {
  const p = Math.max(0, Math.min(100, percent))
  const full = Math.min(width, Math.round((p / 100) * width))
  return { filled: '█'.repeat(full), empty: '░'.repeat(width - full) }
}

/** A rounded progress bar for surfaces that draw SVG. */
export function barSvg(percent: number, color: string, width = 56, height = 6): string {
  const p = Math.max(0, Math.min(100, percent))
  const fill = p === 0 ? 0 : Math.max(height, Math.round((p / 100) * width))
  const r = height / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${r}" fill="${SVG_HEX.inactive}" fill-opacity="0.25"/>` +
    (fill > 0 ? `<rect width="${fill}" height="${height}" rx="${r}" fill="${SVG_HEX[color] ?? color}"/>` : '') +
    '</svg>'
  )
}

export function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function resetIn(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}h${min % 60 ? ` ${min % 60}m` : ''}`
  return `${Math.round(h / 24)}d`
}

export function limitName(kind: string): string {
  return LIMIT_NAMES[kind] ?? kind
}

export function slug(s: string): string {
  return s.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'project'
}

export function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function handoffPath(home: string, root: string, now: number): string {
  const project = slug(root.split('/').filter(Boolean).at(-1) ?? 'project')
  return `${home}/.claude/handoffs/${project}/${stamp(now)}.md`
}

/** A handoff shorter than this is a stub or an error, never one worth clearing the context for. */
export const MIN_HANDOFF_BYTES = 400

export function writePrompt(path: string, root: string, prev: string | null = null): string {
  return [
    `Handoff: write a handoff document to \`${path}\` (outside the project; create the folder if it does not exist).`,
    `Project: \`${root}\`.`,
    'Right after you finish, the conversation will be CLEARED with /clear: no summary is kept, and a fresh session will continue from this file alone. Anything not in the file is lost.',
    ...(prev
      ? [
          `An earlier handoff of this work is at \`${prev}\`: read it first. Carry over everything in it that is still true, update what changed, drop what is obsolete; fold finished phases into one line each under History. Rewrite the document, do not append to it.`,
        ]
      : []),
    '',
    '## Before writing',
    '- Gather facts, do not recall them: if the project is a git repository, run `git status --short`, `git branch --show-current` and `git log --oneline -5`; note background processes, dev servers and ports you started. Read-only commands only.',
    '- Change nothing else: no edits, commits or cleanup. Never write secrets, tokens or passwords into the file; name where they live instead.',
    '',
    '## Format',
    'Markdown, in the language the user speaks in this conversation. Start with this header:',
    '```',
    '# Handoff: <task in a few words>',
    '<date and time> · project <path> · branch <branch> @ <short sha>, <clean | N uncommitted files> · status <in progress | blocked on the user | waiting on a process | done>',
    '```',
    'Then the sections below, in this order. Skip a section that has nothing in it rather than writing "none", except 1, 2 and 7, which are always there.',
    '1. **Resume here**: 2–4 lines: where things stand and the single next action, concrete enough to start without reading further (a command, a file and function, or a question to ask the user).',
    '2. **Goal**: what the user ultimately wants and what "done" looks like.',
    '3. **User\'s words**: the latest request and every instruction, constraint or preference that still applies, quoted verbatim with a few words of context. Paraphrase loses nuance; quote.',
    '4. **State**: done (and how it was verified) / done but not verified / in progress, half-made (which files are half-edited, what is uncommitted, what is still running) / not started.',
    '5. **Decisions and dead ends**: each decision with its reason; each approach tried and rejected with why, so it is not retried.',
    '6. **Map**: the files, functions, configs, URLs, tickets, PRs and documents that matter, each with one line on its role. Point to them; do not copy their contents.',
    '7. **Next steps**: an ordered checklist, each step small enough to do and check on its own; mark steps that need the user\'s answer or approval.',
    '8. **How to check**: exact commands to build, test or run, with the expected result and the last actual one; the exact text of any error still open.',
    '9. **Environment**: what the next session must know about the machine: processes or servers left running (and their ports), env vars, worktrees, temp files, services that must be up.',
    '10. **Open questions and risks**: unknowns, assumptions not verified (say so), things that could go wrong.',
    '11. **History** (only with an earlier handoff): one line per earlier phase.',
    '',
    'Fit the sections to the work: for code, the map and the checks carry most weight; for research or analysis, list sources and findings with their confidence in State; for writing, where each draft lives and what feedback it got; for a discussion, the conclusions reached and what is still open.',
    '',
    '## Quality',
    '- Specific over general: paths, names, numbers, commands, exact error text. Mark facts you did not verify.',
    '- Self-contained: no "as discussed above" or "the fix we talked about": the reader has never seen this conversation.',
    '- As short as it can be while complete: usually 60–200 lines. Small critical snippets (a signature, an error, a config line) are fine; large pastes are not.',
    '- When done, reread the file once and ask: could a new session continue with only this file and the repository? Fix what is missing.',
    '',
    'Reply with one line: the path to the file.',
  ].join('\n')
}

export function readPrompt(path: string): string {
  return [
    `This session continues work from before a /clear. The handoff document is \`${path}\`: read it in full first.`,
    'Then check cheaply that it still matches reality (for example `git status` and `git branch --show-current` when the header names a branch) and say if anything differs.',
    'Then confirm briefly, 3–6 bullets: the goal, the current state, the next step, and any question waiting on me. Do not start the work until I say so.',
  ].join('\n')
}

/** The cheapest turn that still reads the whole context, which refreshes the prompt cache's TTL. */
export const WARM_PROMPT = 'Cache keep-alive: reply with just "ok". Do nothing else.'
export const WARM_LABEL = '♨ Warm'
export const HANDOFF_LABEL = '✦ Handoff'

const MIN = 60_000

// the plan's own windows; a gateway's `spend_limit` is API-key billing, not a subscription
const PLAN_WINDOW = /^(five_hour|seven_day)/

/**
 * Prompt-cache TTL of the main conversation, as Claude Code picks it (code.claude.com/docs/en/prompt-caching):
 * the person's choice first (env, then `promptCacheTtl`); else 1 hour on a subscription within its plan,
 * 5 minutes once a plan window is used up (overage) and with an API key, a gateway or a cloud provider.
 */
export function cacheTtlMs(limits: readonly { kind: string; percentUsed: number }[], pref: CacheConfig['ttl'] = null): number {
  if (pref) return pref === '1h' ? 60 * MIN : 5 * MIN
  const plan = limits.filter(l => PLAN_WINDOW.test(l.kind))
  return plan.length > 0 && plan.every(l => l.percentUsed < 100) ? 60 * MIN : 5 * MIN
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = { ttl: null, idle: true, idleMin: 200_000 }

const truthy = (v: string | undefined) => v !== undefined && /^(1|true|yes|on)$/i.test(v.trim())

/**
 * The cache and idle-compaction settings that change what the band should say, in Claude Code's order:
 * `FORCE_PROMPT_CACHING_5M`, then `CLAUDE_CODE_PROMPT_CACHE_TTL`, then `promptCacheTtl`, then
 * `ENABLE_PROMPT_CACHING_1H` (settings reference, promptCacheTtl); idle compaction is on unless
 * `idleCompaction` or `autoCompactEnabled` is false or `DISABLE_AUTO_COMPACT` is set, from 200,000
 * tokens or `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`, never below 100,000 (settings reference, idleCompaction).
 */
export function cacheConfig(env: Record<string, string | undefined>, settings: Record<string, unknown>): CacheConfig {
  const asTtl = (v: unknown) => (v === '5m' || v === '1h' ? v : null)
  const ttl = truthy(env.FORCE_PROMPT_CACHING_5M)
    ? '5m'
    : asTtl(env.CLAUDE_CODE_PROMPT_CACHE_TTL?.trim()) ?? asTtl(settings.promptCacheTtl) ?? (truthy(env.ENABLE_PROMPT_CACHING_1H) ? '1h' : null)
  const idle = settings.idleCompaction !== false && settings.autoCompactEnabled !== false && !truthy(env.DISABLE_AUTO_COMPACT)
  const min = Number.parseInt(env.CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS ?? '', 10)
  return { ttl, idle, idleMin: Number.isFinite(min) && min > 0 ? Math.max(100_000, min) : 200_000 }
}

/** Idle compaction runs after about 54 minutes without a request (settings reference, idleCompaction). */
export const IDLE_COMPACT_MS = 54 * MIN

/**
 * Milliseconds until Claude Code compacts this conversation while it sits idle, or null where it will not:
 * an interactive terminal session on the 1-hour cache whose context has reached the threshold.
 */
export function idleLeftMs(o: { lastAt: number | null; ttl: number; tokens: number | null; config: CacheConfig; terminal: boolean; now: number }): number | null {
  if (!o.terminal || !o.config.idle || o.lastAt === null || o.ttl < 60 * MIN || (o.tokens ?? 0) < o.config.idleMin) return null
  return Math.max(0, o.lastAt + IDLE_COMPACT_MS - o.now)
}

/** Leeway for comparing a file's mtime with the clock: the two are read at different moments. */
export const MTIME_SLACK_MS = 2000

/** Milliseconds until the cache entry written by the last response expires; null before any response. */
export function cacheLeftMs(lastAt: number | null, ttlMs: number, now: number): number | null {
  return lastAt === null ? null : Math.max(0, lastAt + ttlMs - now)
}

/** When to warn that the cache is about to cool: 5 minutes before on a 1h TTL, 1 minute on 5m. */
export function cacheWarnMs(ttlMs: number): number {
  return ttlMs > 10 * MIN ? 5 * MIN : MIN
}

export function cacheText(leftMs: number | null, isWorking: boolean): string {
  if (isWorking) return 'active'
  if (leftMs === null) return '—'
  if (leftMs <= 0) return 'cold'
  const min = Math.floor(leftMs / MIN)
  return min < 1 ? '<1m' : `${min}m`
}

export function cacheColor(leftMs: number | null, ttlMs: number, isWorking: boolean): string {
  if (isWorking) return PALETTE.ok
  if (leftMs === null || leftMs <= 0) return PALETTE.muted
  if (leftMs <= cacheWarnMs(ttlMs)) return PALETTE.hot
  if (leftMs <= ttlMs / 3) return PALETTE.warn
  return PALETTE.ok
}

/** A pie for surfaces that draw SVG: the coloured slice is the share left, clockwise from the top. */
// an unfilled ring like Claude's own usage gauge: a faint track and an arc of the used share, clockwise from 12 o'clock
export function ringSvg(percent: number, color: string, size = 14, stroke = 2): string {
  const p = Math.max(0, Math.min(100, percent))
  const c = size / 2
  const r = c - stroke / 2
  const fill = SVG_HEX[color] ?? color
  const len = 2 * Math.PI * r
  const used = ((p / 100) * len).toFixed(2)
  const track = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${SVG_HEX.inactive}" stroke-opacity="0.35" stroke-width="${stroke}"/>`
  const arc = p > 0
    ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${fill}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${used} ${len.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${track}${arc}</svg>`
}

export function pieSvg(percent: number, color: string, size = 14): string {
  const p = Math.max(0, Math.min(100, percent))
  const c = size / 2
  const r = c - 0.5
  const fill = SVG_HEX[color] ?? color
  const track = `<circle cx="${c}" cy="${c}" r="${r}" fill="${SVG_HEX.inactive}" fill-opacity="0.25"/>`
  let slice = ''
  if (p >= 99.5) slice = `<circle cx="${c}" cy="${c}" r="${r}" fill="${fill}"/>`
  else if (p > 0) {
    const a = (p / 100) * 2 * Math.PI
    const x = (c + r * Math.sin(a)).toFixed(2)
    const y = (c - r * Math.cos(a)).toFixed(2)
    slice = `<path d="M${c} ${c}L${c} ${c - r}A${r} ${r} 0 ${p > 50 ? 1 : 0} 1 ${x} ${y}Z" fill="${fill}"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${track}${slice}</svg>`
}

/** Share of the TTL still left, for the cache pie: 100 while working, 0 cold or unknown. */
export function cachePercent(leftMs: number | null, ttlMs: number, isWorking: boolean): number {
  if (isWorking) return 100
  return leftMs === null ? 0 : Math.round((Math.max(0, leftMs) / ttlMs) * 100)
}

/** Columns the cache segment takes: the gap, label (wide fits only), the longest text. */
export function cacheWidth(label: boolean): number {
  return SEGMENT_GAP + (label ? 'Cache '.length : 0) + 'active'.length
}

/** The session's cost in dollars: `$0.51`, `$12.40`, `$153`; under a cent reads `<$0.01`. */
export function costText(usd: number): string {
  if (usd > 0 && usd < 0.005) return '<$0.01'
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`
}

/** Used / total context tokens: `120k / 200k`, or `120k/200k` when tight; `—` while unknown. */
export function tokensText(u: { tokens: number | null; window: number }, spaced: boolean): string {
  return `${u.tokens === null ? '—' : shortTokens(u.tokens)}${spaced ? ' / ' : '/'}${shortTokens(u.window)}`
}

/** How much of the band to draw: the richest that fits the columns wins. */
export type Fit = {
  border: boolean
  ctxLabel: boolean
  ctxWidth: number
  limitMeter: number
  reset: boolean
  button: string
  warm: string
}

export const FITS: readonly Fit[] = [
  { border: false, ctxLabel: true, ctxWidth: 16, limitMeter: 8, reset: true, button: HANDOFF_LABEL, warm: WARM_LABEL },
  { border: false, ctxLabel: true, ctxWidth: 10, limitMeter: 5, reset: true, button: HANDOFF_LABEL, warm: WARM_LABEL },
  { border: false, ctxLabel: false, ctxWidth: 8, limitMeter: 4, reset: true, button: HANDOFF_LABEL, warm: WARM_LABEL },
  { border: false, ctxLabel: false, ctxWidth: 6, limitMeter: 3, reset: false, button: HANDOFF_LABEL, warm: WARM_LABEL },
  { border: false, ctxLabel: false, ctxWidth: 4, limitMeter: 0, reset: false, button: HANDOFF_LABEL, warm: '♨' },
]

const SEGMENT_GAP = 3

export type BandData = {
  percent: number | null
  tokens: number | null
  window: number
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: number | null
}

const BUTTON_CHROME = 4

/** The columns the band takes with this fit; an estimate on the generous side. */
export function bandWidth(fit: Fit, u: BandData | null, now: number, showButton: boolean): number {
  const pct = u?.percent ?? null
  let w = (fit.ctxLabel ? 'Context '.length : 0) + fit.ctxWidth + 1 + (pct === null ? 1 : `${pct}%`.length)
  if (u) w += 2 + tokensText(u, fit.ctxLabel).length
  for (const l of u?.limits ?? []) {
    const reset = fit.reset ? resetIn(l.resetsAt, now) : ''
    w += SEGMENT_GAP + limitName(l.kind).length + 1 + fit.limitMeter + 1 + `${Math.round(l.percentUsed)}%`.length
    if (reset !== '') w += 3 + reset.length
  }
  if (u?.cost != null) w += SEGMENT_GAP + costText(u.cost).length
  w += cacheWidth(fit.ctxLabel)
  w += 2 + (showButton ? fit.button.length + BUTTON_CHROME + 2 + fit.warm.length + BUTTON_CHROME : 22)
  return w + (fit.border ? 4 : 0)
}

export function pickFit(columns: number, u: BandData | null, now: number, showButton: boolean): Fit {
  return FITS.find(f => bandWidth(f, u, now, showButton) <= columns) ?? FITS[FITS.length - 1]!
}

/** Above this many tokens a cold cache costs enough to plan around it. */
export const BIG_CONTEXT = 50_000

export const NO_ACTIVITY: Activity = {
  edits: 0, reads: 0, web: 0, runs: 0, rereads: 0, repeatFails: 0, hotFile: null, readCounts: {}, failCounts: {}, alerted: null,
}

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS'])
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch'])
// past this many distinct keys the counts stop growing; the totals still do
const MAX_KEYS = 400

/** Folds one finished main-thread tool call into the activity. */
export function recordTool(a: Activity, tool: string, input: { file_path?: string; command?: string }, isError: boolean): Activity {
  const next = { ...a }
  if (EDIT_TOOLS.has(tool)) next.edits++
  else if (WEB_TOOLS.has(tool)) next.web++
  else if (READ_TOOLS.has(tool)) {
    next.reads++
    const path = tool === 'Read' ? input.file_path : undefined
    if (path && (path in a.readCounts || Object.keys(a.readCounts).length < MAX_KEYS)) {
      const count = (a.readCounts[path] ?? 0) + 1
      next.readCounts = { ...a.readCounts, [path]: count }
      if (count > 2) next.rereads++
      if (count > 2 && count > (a.hotFile?.count ?? 0)) next.hotFile = { path, count }
    }
  } else if (tool === 'Bash') {
    next.runs++
    const cmd = input.command?.trim()
    if (isError && cmd && (cmd in a.failCounts || Object.keys(a.failCounts).length < MAX_KEYS)) {
      const count = (a.failCounts[cmd] ?? 0) + 1
      next.failCounts = { ...a.failCounts, [cmd]: count }
      if (count > 1) next.repeatFails++
    }
  }
  return next
}

export type Work = 'code' | 'research' | 'chat'

/** The kind of work, from what the tools did: each kind wears a long context differently. */
export function workKind(a: Activity): Work {
  const doing = a.edits + a.runs
  const looking = a.reads + a.web
  if (doing + looking < 5) return 'chat'
  return a.edits >= 3 || doing >= looking ? 'code' : 'research'
}

/**
 * Measured long-context curves. Anthropic gives no token count where quality starts to drop, only "a
 * performance gradient rather than a hard cliff" (anthropic.com/engineering/effective-context-engineering-for-ai-agents),
 * so the band reads the published per-model measurements instead of fixed thresholds.
 *
 * MRCR v2, 8 needles (contextarena.ai, "GDM-MRCRv2 Full", read 2026-10-21): pick the right one of many
 * near-identical items, the closest public measure of keeping exact details apart, as code work does with
 * files edited many times. Average score, %, per bin of (b/2, b] tokens, at the highest reasoning effort
 * measured; the last bin stands in beyond 512k, where no Claude model has a score.
 */
export const MRCR_BINS = [8_192, 16_384, 32_768, 65_536, 131_072, 262_144, 524_288]
export const MRCR: Record<string, readonly number[]> = {
  'opus-5': [98.7, 99.9, 99.3, 99.9, 91.3, 65.6, 42.5],
  'sonnet-5': [96.4, 94.9, 87.9, 68.0, 52.9, 52.2, 32.0],
  'opus-4.8': [97.4, 96.1, 93.0, 90.7, 75.2, 61.8, 39.8],
  'opus-4.6': [98.2, 84.4, 86.2, 74.3, 68.1, 69.1, 54.3],
  'sonnet-4.6': [96.7, 82.0, 85.2, 79.4, 72.4, 69.3, 45.9],
  'haiku-4.5': [82.5, 47.5, 31.5, 17.0, 13.8],
}

/**
 * GraphWalks Parents, F1 (Claude Opus 4.8 system card, table 8.9.A): following links through a long
 * input, the measure of reading comprehension; the 256k and 1M subsets.
 */
export const GRAPHWALKS: Record<string, { k256: number; m1: number }> = {
  'opus-4.8': { k256: 99.3, m1: 83.3 },
  'opus-4.7': { k256: 93.6, m1: 56.6 },
  'opus-4.6': { k256: 95.4, m1: 48.6 },
}

/** Drops below the model's own short-context score, in points, that make a tip: info, warn, hot. */
export const DROP = { info: 10, warn: 20, hot: 30 } as const

/** Where comprehension was measured to hold: GraphWalks' 256k subset. */
export const COMPREHENSION_TOKENS = 262_144

export type ModelId = { family: string; major: number; minor: number }

/** `claude-opus-4-6`, `Opus 5.5 (1M context)`, `claude-sonnet-5-20260301` → family and version; null otherwise. */
export function parseModel(name: string | null | undefined): ModelId | null {
  const m = /(opus|sonnet|haiku|fable|mythos)[\s_-]*(\d+)(?:[.-](\d)(?!\d))?/i.exec(name ?? '')
  return m ? { family: m[1]!.toLowerCase(), major: Number(m[2]), minor: Number(m[3] ?? 0) } : null
}

export type Curves = {
  mrcr: { key: string; scores: readonly number[] } | null
  graph: { key: string; k256: number; m1: number } | null
}

/**
 * The curves for a model: its own where published, else its nearest measured predecessor in the same line,
 * a conservative stand-in (newer models have scored higher). Opus 4.7's MRCR run near zero from 64k looks
 * like a harness failure next to its own GraphWalks scores, so it reads Opus 4.6's. Haiku 5.x has no
 * predecessor close enough (Haiku 4.5 is two generations back), so it reads none.
 */
export function curvesFor(model: string | null | undefined): Curves {
  const id = parseModel(model)
  if (!id) return { mrcr: null, graph: null }
  const v = id.major + id.minor / 10
  const own = `${id.family}-${id.minor ? `${id.major}.${id.minor}` : id.major}`
  let mrcr: string | null = own in MRCR ? own : null
  let graph: string | null = own in GRAPHWALKS ? own : null
  if (id.family === 'opus' || id.family === 'fable' || id.family === 'mythos') {
    mrcr ??= v >= 5 || id.family !== 'opus' ? 'opus-5' : v >= 4.7 ? (v >= 4.8 ? 'opus-4.8' : 'opus-4.6') : null
    graph ??= v >= 4.8 || id.family !== 'opus' ? 'opus-4.8' : null
  } else if (id.family === 'sonnet') {
    mrcr ??= v >= 5 ? 'sonnet-5' : null
  }
  return {
    mrcr: mrcr ? { key: mrcr, scores: MRCR[mrcr]! } : null,
    graph: graph ? { key: graph, ...GRAPHWALKS[graph]! } : null,
  }
}

const binName = (b: number) => `${b / 1024}k`

/** The MRCR score at this many tokens against the model's own score at 8k. */
export function mrcrAt(scores: readonly number[], tokens: number): { score: number; base: number; drop: number; bin: string } {
  let i = MRCR_BINS.findIndex(b => tokens <= b)
  if (i < 0 || i >= scores.length) i = scores.length - 1
  const base = scores[0]!
  const score = scores[i]!
  const bin = i === 0 ? `≤${binName(MRCR_BINS[0]!)}` : `${binName(MRCR_BINS[i - 1]!)}–${binName(MRCR_BINS[i]!)}`
  return { score, base, drop: Math.round((base - score) * 10) / 10, bin }
}

function dropTone(drop: number): Advice['tone'] | null {
  return drop >= DROP.hot ? 'hot' : drop >= DROP.warn ? 'warn' : drop >= DROP.info ? 'info' : null
}

/**
 * The tip names the work, how strongly the context degrades, what the measurement for that work tested and
 * what to do; the scores stay in this file. MRCR tests telling near-identical items apart, GraphWalks
 * following links across a long input, so each effect says only that.
 */
const WORK_NAME: Record<Work, string> = { code: 'Сессия с кодом', research: 'Исследование', chat: 'Обсуждение' }
const MRCR_EFFECT: Record<Work, string> = {
  code: 'модель чаще путает похожие фрагменты и версии правок',
  research: 'модель может путать похожие источники',
  chat: 'модель может путать похожие фрагменты',
}
const GRAPH_EFFECT = 'модель хуже связывает факты из разных частей контекста'
const DEGREE: Record<Advice['tone'], string> = { info: 'начинает деградировать', warn: 'заметно деградирует', hot: 'сильно деградирует' }
const STEP: Record<Advice['tone'], string> = {
  info: 'Сделайте Handoff на границе задачи',
  warn: 'Сделайте Handoff после текущего шага',
  hot: 'Сделайте Handoff сейчас',
}

function symptoms(a: Activity): string[] {
  const out: string[] = []
  if (a.hotFile && a.rereads >= 3) out.push(`${a.hotFile.path.split('/').at(-1)} прочитан ${a.hotFile.count} раз`)
  // Anthropic: "After two failed corrections, /clear and write a better initial prompt" (code.claude.com/docs/en/best-practices)
  if (a.repeatFails >= 2) out.push('команды падают повторно')
  return out
}

const higher = (x: Advice['tone'] | null, y: Advice['tone'] | null) => (toneRank(x) >= toneRank(y) ? x : y)

/**
 * The degradation tip for this context, work and model, or null while the measurements show no drop.
 *
 * Code reads MRCR: precise edits among many similar versions break first (LongCodeBench: repair fell from
 * 32k while code QA held). Research and discussion read GraphWalks: comprehension held to 256k on every
 * measured Opus and fell past it; below that they warn only when MRCR already shows a 20-point drop,
 * which matters when comparing many similar sources. Symptoms count at any size, raised by the curve.
 */
export function degradation(tokens: number, a: Activity, model: string | null = null): Advice | null {
  const kind = workKind(a)
  const c = curvesFor(model)
  const at = c.mrcr ? mrcrAt(c.mrcr.scores, tokens) : null

  let tone: Advice['tone'] | null = null
  let effect = MRCR_EFFECT[kind]
  if (kind === 'code') tone = at ? dropTone(at.drop) : null
  else if (c.graph && tokens > COMPREHENSION_TOKENS) {
    tone = 'warn'
    effect = GRAPH_EFFECT
  } else if (at && at.drop >= DROP.warn) tone = 'info'

  const signs = symptoms(a)
  if (signs.length > 0) {
    const raised = higher(at && at.drop >= DROP.warn ? 'hot' : at && at.drop >= DROP.info ? 'warn' : 'info', tone)!
    const about = `${WORK_NAME[kind]}, признаки деградации: ${signs.join('; ')}`
    return { tone: raised, kind: 'degrade', about, text: `${about}. ${STEP[raised]}.` }
  }
  if (!tone) return null
  const about = `${WORK_NAME[kind]}, контекст ${DEGREE[tone]} (~${shortTokens(tokens)}): ${effect}`
  return { tone, kind: 'degrade', about, text: `${about}. ${STEP[tone]}.` }
}

export function toneRank(t: Advice['tone'] | null): number {
  return t === 'hot' ? 3 : t === 'warn' ? 2 : t === 'info' ? 1 : 0
}

/** `about`: the degradation without the step, for a tip that joins it with another reason */
export type Advice = { tone: 'info' | 'warn' | 'hot'; kind?: 'degrade'; about?: string; text: string }

export type AdviceInput = BandData & {
  cacheLeft: number | null
  ttl: number
  now: number
  activity?: Activity
  model?: string | null
  /** ms until idle compaction, null where it will not run (idleLeftMs) */
  idleLeft?: number | null
}

/** The single most useful tip for the current context, cache and limits; null when nothing needs doing. */
export function advise(a: AdviceInput): Advice | null {
  const pct = a.percent ?? 0
  const tokens = a.tokens ?? 0
  const big = tokens >= BIG_CONTEXT
  const ctx = a.tokens === null ? 'весь контекст' : `~${shortTokens(a.tokens)} контекста`
  const warm = a.cacheLeft !== null && a.cacheLeft > 0
  const idle = a.idleLeft ?? null

  // idle compaction comes 6 minutes before the 1-hour cache cools, so it is the deadline that matters
  if (idle !== null && idle > 0 && idle <= cacheWarnMs(a.ttl)) {
    const min = Math.ceil(idle / MIN)
    return { tone: 'hot', text: `Через ${min} мин простоя Claude Code сам сожмёт ${ctx} (idle compaction). Нужны детали — Handoff сейчас; вернётесь скоро — отправьте любое сообщение.` }
  }
  if (warm && a.cacheLeft! <= cacheWarnMs(a.ttl)) {
    const min = Math.ceil(a.cacheLeft! / MIN)
    return big
      ? { tone: 'hot', text: `Кэш остынет через ${min} мин. Уходите надолго — Handoff сейчас, пока чтение дешёвое; вернётесь скоро — отправьте любое сообщение.` }
      : { tone: 'warn', text: `Кэш остынет через ${min} мин: отправьте сообщение, чтобы сохранить его.` }
  }
  if (pct >= 85) {
    return { tone: 'hot', text: `Контекст ${pct}%: сделайте Handoff на ближайшей паузе, иначе автокомпакт сожмёт без handoff.` }
  }
  const strain = degradation(tokens, a.activity ?? NO_ACTIVITY, a.model ?? null)
  const cold = a.cacheLeft !== null && a.cacheLeft <= 0 && big
  // both call for a Handoff, and a cold cache makes the next message re-write the whole degraded context
  if (strain?.about && strain.tone !== 'info' && cold) {
    return { tone: strain.tone, kind: 'degrade', text: `Кэш остыл. ${strain.about}. Сделайте Handoff до следующего сообщения — оно заново запишет ${ctx}.` }
  }
  if (strain && strain.tone !== 'info') return strain
  if (cold) {
    return { tone: 'warn', text: `Кэш остыл: следующее сообщение заново запишет ${ctx}. Продолжаете ту же задачу — сначала Handoff; новая задача — новая сессия.` }
  }
  const lim = a.limits.filter(l => l.percentUsed >= 85).sort((x, y) => y.percentUsed - x.percentUsed)[0]
  if (lim) {
    const reset = resetIn(lim.resetsAt, a.now)
    return {
      tone: 'warn',
      text: `Лимит ${limitName(lim.kind)} ${Math.round(lim.percentUsed)}%${reset ? `, сброс через ${reset}` : ''}: поиски отдавайте субагентам, уточнения шлите одним сообщением.`,
    }
  }
  return strain
}

export function adviceColor(tone: Advice['tone']): string {
  return tone === 'hot' ? PALETTE.hot : tone === 'warn' ? PALETTE.warn : PALETTE.accent
}
