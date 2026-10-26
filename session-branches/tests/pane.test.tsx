import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const PANE = {
  plugin: 'session-branches',
  component: 'Pane',
  requestId: 'session-branches',
  props: {
    title: 'Session branches',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const NOW = 1_800_000_000_000
const SCAN = [
  'S\troot-1', `M\t${NOW / 1000 - 600}`, 'P\t',
  '{"type":"custom-title","customTitle":"Lorel проект","sessionId":"root-1"}',
  'S\tfork-1', `M\t${NOW / 1000 - 60}`, 'P\troot-1',
  '{"type":"custom-title","customTitle":"Lorel проект (fork)","sessionId":"fork-1"}',
  'S\tlone-1', `M\t${NOW / 1000 - 7200}`, 'P\tgone-0',
  '{"type":"ai-title","aiTitle":"Чужая ветка","sessionId":"lone-1"}',
  '',
].join('\n')

const BRANCHES = {
  command: 'branches',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 120 },
} as const

const engine = (
  on: Parameters<TestBody>[1],
  ran: string[],
  commands: string[],
  tabExit = 0,
) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({
    value: commands.map(name => ({ name, description: '', source: 'builtin' as const })),
  }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.run', (_, e) => {
    ran.push(`${e.command} ${e.args}`.trim())
    return { text: '' }
  })
  on('session.id', () => ({ value: 'fork-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('process.run', (_, e) => {
    const script = e.argv[1] ?? ''
    if (script.endsWith('open-tab.sh')) ran.push(`tab ${e.argv.slice(2).join(' ')}`)
    if (script.endsWith('trash.sh')) ran.push(`trash ${e.argv[3]}`)
    const isTab = script.endsWith('open-tab.sh')
    return {
      value: {
        exitCode: isTab ? tabExit : 0,
        stdout: isTab ? 'terminal-tab\n' : SCAN,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('ui.copy', (_, e) => {
    ran.push(`copy ${e.text}`)
    return { value: { isCopied: true } }
  })
  on('clock.now', () => ({ value: NOW }))
  on('ui.open', () => {
    ran.push('open')
    return { value: { isPlaced: true } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

test('the terminal pane opens at start and switches on press', async ($, on) => {
  const ran: string[] = []
  engine(on, ran, ['branch', 'resume'])
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  expect(ran).toEqual(['open'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'root-1' }))?.text).toContain('Lorel проект')
  expect((await ui.find({ key: 'fork-1' }))?.text).toContain('└ ● Lorel проект (fork)')
  expect((await ui.find({ key: 'lone-1' }))?.text).toContain('↳ Чужая ветка')

  expect(await ui.find({ key: 'here:fork-1' })).toBeUndefined()

  await ui.press({ key: 'root-1' })
  expect(ran).toContain('tab /proj root-1')
  await ui.press({ key: 'here:root-1' })
  expect(ran).toContain('resume root-1')
  await ui.press({ key: 'fork' })
  expect(ran).toContain('branch')
  await ui.unmount()
})

test('other surfaces get no pane, no command and the engine drawing', async ($, on) => {
  const ran: string[] = []
  engine(on, ran, ['branch', 'resume'])
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  expect(ran).toEqual([])

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    expect(await ui.find({ key: 'root-1' })).toBeUndefined()
    await ui.unmount()
  }
})

test('an unknown terminal gets the command on the clipboard', async ($, on) => {
  const ran: string[] = []
  engine(on, ran, ['resume'], 2)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'lone-1' })
  expect(ran).toEqual(['open', 'tab /proj lone-1', 'copy claude --resume lone-1'])
  await ui.unmount()
})

test('a delete asks first and never trashes the current session', async ($, on) => {
  const ran: string[] = []
  engine(on, ran, ['resume'])
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'del:fork-1' })).toBeUndefined()

  await ui.press({ key: 'del:root-1' })
  expect(ran).toEqual(['open'])
  // fork-1 sits below root-1 but is this window's session: no "with branches".
  expect(await ui.find({ key: 'all:root-1' })).toBeUndefined()
  await ui.press({ key: 'no:root-1' })
  expect(await ui.find({ key: 'yes:root-1' })).toBeUndefined()

  await ui.press({ key: 'del:lone-1' })
  await ui.press({ key: 'yes:lone-1' })
  expect(ran).toEqual(['open', 'trash lone-1'])
  await ui.unmount()
})
