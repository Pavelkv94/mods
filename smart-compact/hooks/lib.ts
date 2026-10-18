import type { Limit } from '../types'

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5ч',
  seven_day: '7д',
  spend_limit: '$',
}

export function bar(percent: number, width = 10): string {
  const p = Math.max(0, Math.min(100, percent))
  const filled = Math.round((p / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const PALETTE = {
  ok: '#7ee787',
  warn: '#e3b341',
  hot: '#ff7b72',
  track: '#3d444d',
  muted: '#8b949e',
  accent: '#a5d6ff',
  border: '#30363d',
} as const

export function levelColor(percent: number): string {
  if (percent >= 85) return PALETTE.hot
  if (percent >= 60) return PALETTE.warn
  return PALETTE.ok
}

/** A thin line meter: the filled part and the empty track, drawn separately so each takes its own color. */
export function meter(percent: number, width = 12): { filled: string; empty: string } {
  const p = Math.max(0, Math.min(100, percent))
  const halves = Math.round((p / 100) * width * 2)
  const full = Math.floor(halves / 2)
  const half = halves % 2 === 1
  const filled = '━'.repeat(full) + (half ? '╸' : '')
  const empty = '━'.repeat(Math.max(0, width - full - (half ? 1 : 0)))
  return { filled, empty }
}

export function pie(percent: number): string {
  const glyphs = ['○', '◔', '◑', '◕', '●']
  return glyphs[Math.max(0, Math.min(4, Math.round(percent / 25)))] ?? '○'
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
  if (min < 60) return `${min}м`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}ч${min % 60 ? ` ${min % 60}м` : ''}`
  return `${Math.round(h / 24)}д`
}

export function limitName(kind: string): string {
  return LIMIT_NAMES[kind] ?? kind
}

export function limitLabel(l: Limit, now: number): string {
  const name = LIMIT_NAMES[l.kind] ?? l.kind
  const reset = resetIn(l.resetsAt, now)
  return `${name} ${Math.round(l.percentUsed)}%${reset ? ` (↻${reset})` : ''}`
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

export function writePrompt(path: string, root: string): string {
  return [
    `Smart compact: перед сжатием контекста сохрани handoff-документ в файл \`${path}\` (вне проекта, создай папку если её нет).`,
    `Проект: \`${root}\`.`,
    '',
    'Документ должен позволить продолжить работу без потери контекста. Включи разделы:',
    '1. **Цель и задача** — что пользователь хочет получить в итоге.',
    '2. **Текущее состояние** — что сделано, что работает, что проверено.',
    '3. **Ключевые решения** — принятые решения и почему (включая отклонённые варианты).',
    '4. **Важные файлы и места** — пути, функции, команды, конфиги, с кратким пояснением.',
    '5. **Ограничения и предпочтения пользователя** — требования, стиль, запреты.',
    '6. **Открытые вопросы / проблемы** — баги, неясности, риски.',
    '7. **Следующие шаги** — конкретный упорядоченный список.',
    '',
    'Пиши конкретно и сжато, без воды. Сохрани только файл — ничего больше не меняй. В ответе выведи одну строку: путь к файлу.',
  ].join('\n')
}

export function compactInstructions(path: string): string {
  return `Вся важная информация сессии сохранена в handoff-документе ${path}. В сводке обязательно укажи этот путь и сохрани текущую цель и следующие шаги.`
}

export function readPrompt(path: string): string {
  return [
    `Сессия была сжата через Smart compact. Ознакомься с handoff-документом: \`${path}\`.`,
    'Прочитай его полностью, затем кратко (3–6 пунктов) подтверди, что понял: цель, текущее состояние и следующий шаг. Ничего не начинай делать, пока я не скажу.',
  ].join('\n')
}
