import type { Register } from 'claude-code'

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Только ответ основного цикла: без сабагентов, прерываний и ошибок.
    if (e.agentId !== undefined || e.isAborted || e.reason !== 'answer') return result
    // Звук не должен задерживать или ломать конец хода.
    void $.audio.play({ asset: 'sounds/glass.aiff' }).catch(() => undefined)
    return result
  })
}
