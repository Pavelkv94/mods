export function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 4 ? '…/' + parts.slice(-3).join('/') : path
}

export function targetOf(args: Record<string, unknown>): string {
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

export function toolLabel(tool: string): string {
  const mcp = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(tool)
  return mcp?.[1] ?? tool
}

export function fmtUsd(v: number | undefined): string {
  if (v === undefined) return '$—'
  if (v === 0) return '$0'
  if (v < 0.01) return '$' + v.toFixed(4)
  if (v < 1) return '$' + v.toFixed(3)
  return '$' + v.toFixed(2)
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k'
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function lineCount(text: unknown): number {
  return typeof text === 'string' && text !== '' ? text.split('\n').length : 0
}

export function firstLine(text: string, max = 120): string {
  const line = (text.split('\n').find(part => part.trim() !== '') ?? '').trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}
