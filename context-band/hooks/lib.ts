import type { Activity } from '../types'

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
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
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

/** Prompt-cache TTL: a subscription (rate limits reported) caches for 1 hour, an API key for 5 minutes. */
export function cacheTtlMs(hasLimits: boolean): number {
  return hasLimits ? 60 * MIN : 5 * MIN
}

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
 * Where a long context starts to cost quality, by kind of work: code juggles many exact details and
 * versions of files and suffers first; finding facts in read material holds up longest.
 */
export const WORK_LIMITS: Record<Work, { soft: number; hard: number; name: string }> = {
  code: { soft: 120_000, hard: 200_000, name: 'работа с кодом' },
  research: { soft: 250_000, hard: 400_000, name: 'исследование и чтение' },
  chat: { soft: 150_000, hard: 250_000, name: 'обсуждение' },
}

const HANDOFF_HINT = 'Рекомендую Handoff: умный clear с handoff-документом'

function workDetail(a: Activity, kind: Work): string {
  if (kind === 'code') return `${a.edits} правок, ${a.runs} запусков`
  if (kind === 'research') return `${a.reads + a.web} чтений`
  return ''
}

function symptoms(a: Activity): string[] {
  const out: string[] = []
  if (a.hotFile && a.rereads >= 3) out.push(`${a.hotFile.path.split('/').at(-1)} прочитан ${a.hotFile.count} раз`)
  if (a.repeatFails >= 2) out.push(`одни и те же команды падают повторно (${a.repeatFails})`)
  return out
}

/** The degradation tip for this context size and work, or null while the context is still fresh. */
export function degradation(tokens: number, a: Activity): Advice | null {
  const kind = workKind(a)
  const lim = WORK_LIMITS[kind]
  const what = `${shortTokens(tokens)} контекста, ${lim.name}${kind === 'chat' ? '' : ` (${workDetail(a, kind)})`}`
  const signs = symptoms(a)
  // re-reading and retrying in a small context is ordinary work, not strain
  if (signs.length > 0 && tokens >= lim.soft / 2) {
    return { tone: tokens >= lim.soft ? 'hot' : 'warn', kind: 'degrade', text: `Признаки деградации контекста: ${signs.join('; ')}. ${what}. ${HANDOFF_HINT}.` }
  }
  if (tokens >= lim.hard) {
    return { tone: 'warn', kind: 'degrade', text: `${what}: модель начинает терять ранние детали и решения. ${HANDOFF_HINT} после текущего шага.` }
  }
  if (tokens >= lim.soft) {
    return { tone: 'info', kind: 'degrade', text: `${what}: на ближайшей границе задачи сделайте Handoff, пока качество не просело.` }
  }
  return null
}

export function toneRank(t: Advice['tone'] | null): number {
  return t === 'hot' ? 3 : t === 'warn' ? 2 : t === 'info' ? 1 : 0
}

export type Advice = { tone: 'info' | 'warn' | 'hot'; kind?: 'degrade'; text: string }

export type AdviceInput = BandData & { cacheLeft: number | null; ttl: number; now: number; activity?: Activity }

/** The single most useful tip for the current context, cache and limits; null when nothing needs doing. */
export function advise(a: AdviceInput): Advice | null {
  const pct = a.percent ?? 0
  const tokens = a.tokens ?? 0
  const big = tokens >= BIG_CONTEXT
  const ctx = a.tokens === null ? 'весь контекст' : `~${shortTokens(a.tokens)} контекста`
  const warm = a.cacheLeft !== null && a.cacheLeft > 0

  if (warm && a.cacheLeft! <= cacheWarnMs(a.ttl)) {
    const min = Math.ceil(a.cacheLeft! / MIN)
    return big
      ? { tone: 'hot', text: `Кэш остынет через ${min} мин. Уходите надолго — Handoff сейчас, пока чтение дешёвое; вернётесь скоро — отправьте любое сообщение.` }
      : { tone: 'warn', text: `Кэш остынет через ${min} мин: отправьте сообщение, чтобы сохранить его.` }
  }
  if (pct >= 85) {
    return { tone: 'hot', text: `Контекст ${pct}%: сделайте Handoff на ближайшей паузе, иначе автокомпакт сожмёт без handoff.` }
  }
  const strain = degradation(tokens, a.activity ?? NO_ACTIVITY)
  if (strain && strain.tone !== 'info') return strain
  if (a.cacheLeft !== null && a.cacheLeft <= 0 && big) {
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
  if (strain) return strain
  if (pct >= 60 && warm) {
    return { tone: 'info', text: `Контекст ${pct}%: на ближайшей границе задачи сделайте Handoff, пока кэш тёплый.` }
  }
  return null
}

export function adviceColor(tone: Advice['tone']): string {
  return tone === 'hot' ? PALETTE.hot : tone === 'warn' ? PALETTE.warn : PALETTE.accent
}
