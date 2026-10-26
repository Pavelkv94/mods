import type { AgentCard } from '../../types'
import { ERR, OK } from './theme'

const cells = (list: readonly (readonly [number, number])[]) =>
  list.map(([x, y]) => `<rect x="${x}" y="${y}" width="1.05" height="1.05"/>`).join('')

const loop = (attr: string, values: string, dur: string, begin = '0s', type = '') =>
  type
    ? `<animateTransform attributeName="${attr}" type="${type}" values="${values}" dur="${dur}" begin="${begin}" calcMode="discrete" repeatCount="indefinite"/>`
    : `<animate attributeName="${attr}" values="${values}" dur="${dur}" begin="${begin}" calcMode="discrete" repeatCount="indefinite"/>`

const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -1 24 16" width="48" height="32" shape-rendering="crispEdges">${inner}</svg>`

// At work the crab sits sideways at its desk and types; once it has ended it stands facing us.
export function crabSvg(color: string, status: AgentCard['status']): string {
  return status === 'running' ? typingCrab(color) : standingCrab(color, status)
}

// a pixel crab at its desk, seen from the side: it faces a monitor and types on the keyboard before it
function typingCrab(color: string): string {
  const MAP = [
    '.BBBBBB.',
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBBBBBB',
    '.BBBBBB.',
    '.L.L.L..',
  ]
  let body = ''
  MAP.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== '.') body += `<rect x="${x}" y="${y + 6}" width="1.05" height="1.05"/>`
    }),
  )
  // the far claw reaches over to the keys on the right, the near one to those on the left; they tap in turn
  const farClaw = cells([[8, 7], [9, 8], [10, 9], [11, 10], [12, 10]])
  const nearClaw = cells([[8, 9], [9, 10], [10, 10]])
  const tap = (begin: string) => loop('transform', '0 0;0 -0.8;0 0;0 0', '0.36s', begin, 'translate')
  const eye = (x: number) => `<rect x="${x}" y="7" width="1.05" height="2"/>`
  const bob = loop('transform', '0 0;0 -0.3', '0.72s', '0s', 'translate')

  // the screen: lines of code typed out one after another
  const lines: readonly (readonly [number, number, string])[] = [
    [3, 5, color],
    [5, 4, '#C9D1D9'],
    [7, 6, '#8B949E'],
  ]
  // each line grows a cell at a time in its own third of the loop, all wiped together at the end
  const steps = 18
  const screen =
    lines
      .map(([y, width, fill], line) => {
        const values = Array.from({ length: steps }, (_, i) => {
          const typed = i - line * 6
          return typed < 0 ? 0 : Math.min(width, typed)
        }).join(';')
        return `<rect x="15" y="${y}" width="0" height="0.8" fill="${fill}">${loop('width', values, '3.6s')}</rect>`
      })
      .join('') + `<rect x="21" y="7" width="0.6" height="0.8" fill="${color}">${loop('opacity', '1;0', '0.6s')}</rect>`
  // the screen's light on the crab's face while it types
  const glow = `<rect x="14" y="2" width="8" height="7" fill="${color}" opacity="0.08">${loop('opacity', '0.06;0.14;0.08;0.18', '1.2s')}</rect>`
  const desk = deskSvg(glow + screen)

  return svg(
    desk +
      `<g fill="${color}">${bob}${body}` +
      `<g fill="#1b1b1f">${eye(4)}${eye(6)}</g>` +
      `<g opacity="0.8">${tap('0.18s')}${farClaw}</g><g>${tap('0s')}${nearClaw}</g>` +
      `</g>`,
  )
}

// The desk: a monitor showing `screen`, its stand, the keyboard and the desk's edge.
function deskSvg(screen: string): string {
  const keys = Array.from({ length: 6 }, (_, i) => `<rect x="${8 + i}" y="11.2" width="0.8" height="0.8"/>`).join('')
  return (
    `<rect x="0" y="12" width="24" height="0.5" fill="#6E7681"/>` +
    `<rect x="13" y="1" width="10" height="9" rx="0.5" fill="#6E7681"/>` +
    `<rect x="14" y="2" width="8" height="7" fill="#0D1117"/>` +
    screen +
    `<rect x="17" y="10" width="2" height="2" fill="#6E7681"/>` +
    `<g fill="#8B949E">${keys}</g>`
  )
}

// Once it has ended the crab gets up from the keys and stands at the desk facing us, drawn as Claude's crab
// is: done, it hops and blinks with a check on the screen; failed, its claws droop and the screen shows a
// cross; stopped, it stands dimmed with its eyes shut before a dark screen.
function standingCrab(color: string, status: Exclude<AgentCard['status'], 'running'>): string {
  // Claude's crab in half-cell pixels: 18 across, 5 down, tall and narrow as a terminal's half cells are
  const MAP = [
    '...BBBBBBBBBBBB...',
    '...BBEBBBBBBEBB...',
    '.AABBBBBBBBBBBBAA.',
    '...BBBBBBBBBBBB...',
    '....L.L....L.L....',
  ]
  // a touch narrower than the terminal's cells, so its legs stop short of the keyboard
  const W = 0.55
  const H = 1.2
  const X = 0.1
  const Y = 6
  const px = (x: number, y: number, h = H) => `<rect x="${(X + x * W).toFixed(2)}" y="${(Y + y * H).toFixed(2)}" width="${W + 0.05}" height="${h + 0.05}"/>`
  let body = ''
  let eyes = ''
  MAP.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === 'B' || ch === 'L') body += px(x, y)
      // the claws droop a row when it failed
      if (ch === 'A') body += px(x, status === 'error' ? y + 1 : y)
      // an eye sits on the body, so a half-shut one leaves no hole above it
      if (ch === 'E') {
        body += px(x, y)
        eyes += px(x, y)
      }
    }),
  )
  if (status === 'done') {
    // a blink now and then
    eyes = eyes.replace(
      /height="([\d.]+)"\/>/g,
      `height="$1"><animate attributeName="height" values="${H + 0.05};${H + 0.05};0.2;${H + 0.05}" keyTimes="0;0.9;0.94;1" dur="3.6s" repeatCount="indefinite"/></rect>`,
    )
  } else {
    // half shut when it failed, closed when it was stopped
    eyes = eyes.replace(/y="([\d.]+)" width="([\d.]+)" height="[\d.]+"/g, (_, y: string, w: string) =>
      `y="${(Number(y) + (status === 'error' ? 0.5 : 0.8)).toFixed(2)}" width="${w}" height="${status === 'error' ? 0.7 : 0.35}"`,
    )
  }
  const hop =
    status === 'done'
      ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 -1.2;0 0" keyTimes="0;0.7;0.75;0.8" dur="3.6s" repeatCount="indefinite"/>`
      : ''
  const screen =
    status === 'done'
      ? `<g fill="${OK}">${cells([[15, 5], [16, 6], [17, 7], [18, 6], [19, 5], [20, 4]])}</g>`
      : status === 'error'
        ? `<g fill="${ERR}">${cells([[16, 3], [20, 3], [17, 4], [19, 4], [18, 5], [17, 6], [19, 6], [16, 7], [20, 7]])}</g>`
        : ''

  return svg(
    deskSvg(screen) +
      `<g${status === 'killed' ? ' opacity="0.55"' : ''}><g fill="${color}">${hop}${body}` +
      `<g fill="#1b1b1f">${eyes}</g>` +
      `</g></g>`,
  )
}

// The bar's own stripes move while it runs; with no known total a striped block slides along instead.
// `uid` keeps each bar's pattern and clip ids apart, where several bars share one document.
export function barSvg(color: string, fraction: number | undefined, isRunning: boolean, uid: string): string {
  const W = 300
  const H = 6
  const id = uid.replace(/[^A-Za-z0-9_-]/g, '_')
  const stripes =
    `<defs><pattern id="s-${id}" width="8" height="${H}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="4" height="${H}" fill="rgba(255,255,255,0.28)"/>` +
    `<animateTransform attributeName="patternTransform" type="translate" values="0 0;8 0" dur="0.8s" additive="sum" repeatCount="indefinite"/>` +
    `</pattern><clipPath id="c-${id}"><rect width="${W}" height="${H}" rx="3"/></clipPath></defs>`
  const track = `<rect width="${W}" height="${H}" rx="3" fill="${color}" opacity="0.18"/>`
  let fill: string
  if (fraction === undefined && isRunning) {
    const seg = 80
    const slide = `<animate attributeName="x" values="${-seg};${W}" dur="1.8s" repeatCount="indefinite"/>`
    fill =
      `<rect y="0" width="${seg}" height="${H}" rx="3" fill="${color}">${slide}</rect>` +
      `<rect y="0" width="${seg}" height="${H}" fill="url(#s-${id})">${slide}</rect>`
  } else {
    const w = Math.max(H, Math.round(W * Math.min(1, fraction ?? 1)))
    fill = `<rect width="${w}" height="${H}" rx="3" fill="${color}"/>` + (isRunning ? `<rect width="${w}" height="${H}" fill="url(#s-${id})"/>` : '')
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="none">${stripes}<g clip-path="url(#c-${id})">${track}${fill}</g></svg>`
}
