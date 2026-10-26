import type { Spend } from '../../types'
import { MODEL_COLORS, MUTED } from './theme'

// API list prices per million tokens: input, output, cache read. A cache write is 1.25× input when kept
// five minutes and 2× when kept an hour. Under a subscription nothing is billed per token, so the pane
// calls it the API-equivalent cost.
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

// a prompt longer than `above` tokens is billed at `factor` times the list price, the whole response
const LONG_PROMPT: Record<string, { above: number; factor: number }> = {
  'haiku-5.5': { above: 100_000, factor: 5 },
}

// the models whose window is smaller than the 1M the rest share
const WINDOW: Record<string, number> = {
  'haiku-4.5': 200_000,
}

export const NO_SPEND: Spend = { costIn: 0, costOut: 0, costCacheRead: 0, cacheWriteBase: 0 }

export function modelParts(model: string): { family: string; version: string } | undefined {
  const full = /(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(model)
  if (full) {
    const [, family = '', major = '', minor] = full
    return { family: family.toLowerCase(), version: minor ? `${major}.${minor}` : major }
  }
  const family = /(opus|sonnet|haiku|fable|mythos)/i.exec(model)?.[1]?.toLowerCase()
  return family ? { family, version: '' } : undefined
}

function keyOf(model: string): string {
  const parts = modelParts(model)
  return parts ? `${parts.family}-${parts.version}` : ''
}

export function modelLabel(model: string): string {
  const parts = modelParts(model)
  if (!parts) return model || '…'
  const name = parts.family.charAt(0).toUpperCase() + parts.family.slice(1)
  return parts.version ? `${name} ${parts.version}` : name
}

export function modelColor(model: string): string {
  return MODEL_COLORS[modelParts(model)?.family ?? ''] ?? MUTED
}

// The session's own window when the engine gave one, unless the model's is smaller.
export function windowOf(model: string, sessionWindow: number | undefined): number {
  const own = WINDOW[keyOf(model)]
  if (own !== undefined) return sessionWindow === undefined ? own : Math.min(own, sessionWindow)
  return sessionWindow ?? 1_000_000
}

export type StepUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// What one response cost; undefined for a model the table lacks.
export function spendOf(model: string, usage: StepUsage): Spend | undefined {
  const key = keyOf(model)
  const price = PRICES[key]
  if (!price) return undefined
  const [pin, pout, pread] = price
  const prompt = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  const long = LONG_PROMPT[key]
  const factor = long && prompt > long.above ? long.factor : 1
  return {
    costIn: (usage.input_tokens * pin * factor) / 1e6,
    costOut: (usage.output_tokens * pout * factor) / 1e6,
    costCacheRead: (usage.cache_read_input_tokens * pread * factor) / 1e6,
    cacheWriteBase: (usage.cache_creation_input_tokens * pin * factor) / 1e6,
  }
}

export function addSpend<T extends Spend>(to: T, spend: Spend | undefined): T {
  if (!spend) return { ...to, unpriced: true }
  return {
    ...to,
    costIn: to.costIn + spend.costIn,
    costOut: to.costOut + spend.costOut,
    costCacheRead: to.costCacheRead + spend.costCacheRead,
    cacheWriteBase: to.cacheWriteBase + spend.cacheWriteBase,
  }
}

export type Cost = { input: number; output: number; cacheWrite: number; cacheRead: number; total: number }

// Until the Agent tool's record says otherwise, cache writes count as kept five minutes; fast mode doubles all.
export function costOf(spend: Spend & { cacheWrite1hShare?: number; fast?: boolean }): Cost | undefined {
  const base = spend.costIn + spend.costOut + spend.costCacheRead + spend.cacheWriteBase
  if (spend.unpriced && base === 0) return undefined
  const speed = spend.fast ? 2 : 1
  const share = spend.cacheWrite1hShare ?? 0
  const input = spend.costIn * speed
  const output = spend.costOut * speed
  const cacheRead = spend.costCacheRead * speed
  const cacheWrite = spend.cacheWriteBase * (1.25 * (1 - share) + 2 * share) * speed
  return { input, output, cacheWrite, cacheRead, total: input + output + cacheWrite + cacheRead }
}
