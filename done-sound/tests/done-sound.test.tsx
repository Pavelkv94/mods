import { expect, test } from 'claude-code/testing'

const TURN = { answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as const

async function played($: any, on: any, turn: object): Promise<string[]> {
  const clips: string[] = []
  on('fs.read', (_$: unknown, e: { path: string }) => ({ value: { base64: btoa(e.path) } }))
  on('audio.play', (_$: unknown, e: { clip: { base64?: string; mime?: string } }) => {
    clips.push(`${e.clip.mime} ${atob(e.clip.base64 ?? '')}`)
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: 'ok' }))
  await $.turn.complete(turn as never)
  // Звук запускается в фоне — даём ему стартовать.
  for (let i = 0; i < 50 && clips.length === 0; i++) await Promise.resolve()
  return clips
}

test('main-loop answer plays the system Glass sound', async ($, on) => {
  expect(await played($, on, TURN)).toEqual(['audio/aiff /System/Library/Sounds/Glass.aiff'])
})

test('subagent turn plays nothing', async ($, on) => {
  expect(await played($, on, { ...TURN, agentId: 'a1' })).toEqual([])
})

test('aborted turn plays nothing', async ($, on) => {
  expect(await played($, on, { ...TURN, isAborted: true, reason: 'aborted' })).toEqual([])
})

test('error turn plays nothing', async ($, on) => {
  expect(await played($, on, { ...TURN, reason: 'error' })).toEqual([])
})
