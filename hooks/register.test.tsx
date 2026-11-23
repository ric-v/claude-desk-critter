import { expect, mock, test } from 'claude-code/testing'

const BACKDROP = {
  plugin: 'desk-critter',
  component: 'Backdrop',
  props: { scene: 'critter', plugin: 'desk-critter', glass: { blur: 0, opacity: 0 } },
} as const

const BAND = {
  plugin: 'desk-critter',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, bodyColumns: 100 },
} as const

const PANE = {
  plugin: 'desk-critter',
  component: 'Pane',
  requestId: 'desk-critter',
  props: { title: 'Critter', isFocused: true, bodyColumns: 60, placement: 'dock' },
} as const

const NOV_23_NOON = new Date(2026, 10, 23, 12, 0, 0).getTime()
const DEC_5_NOON = new Date(2026, 11, 5, 12, 0, 0).getTime()

// What stands beneath the plugins in a session: the clock and store in memory, and the engine's answers.
// Registered before the test's first call on $.
function world(on: any, now = NOV_23_NOON, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now })
  mock.store(on, store)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }) as any)
  on('command.register', () => ({ value: undefined }) as any)
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'r1' } }) as any)
  on('theme.clear', () => ({ value: { isDrawn: false, reason: 'cleared' } }) as any)
  on('ui.toast', () => ({ value: undefined }) as any)
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  on('tool.run', () => ({ result: 'ok' }) as any)
  on('classic.PostToolUse', () => ({}) as any)
  on('classic.PermissionRequest', () => ({}) as any)
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }) as any)
  return clock
}

async function start($: any, clock: any) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await clock.advance(2000) // let the first fades settle
}

// The values the shader is fed right now.
async function shown($: any): Promise<Record<string, number>> {
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' } as any)
  const shader: any = await ui.find({ type: 'Shader' })
  await ui.unmount()
  return shader?.props.values ?? {}
}

// The pane's words, all run together.
async function paneText($: any): Promise<string> {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  const all: any[] = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return all.map(t => t.text).join(' | ')
}

test('the backdrop plays the critter shader over a finished picture', async $ => {
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' } as any)
  const shader: any = await ui.find({ type: 'Shader' })
  expect(shader?.props.module).toContain('critter-shader')
  expect(((await ui.find({ type: 'Svg' })) as any)?.props.alt).toContain('critter')
  await ui.unmount()
})

test('a Read fades in the glasses; a permission prompt has it wave', async ($, on) => {
  const clock = world(on)
  await start($, clock)
  await $.tool.call({ tool: 'Read', file_path: 'C:/x.txt' } as any)
  await clock.advance(400)
  const v = await shown($)
  expect(v.prop).toBe(2)
  expect(v.propOn).toBe(1)

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } } as any)
  expect((await shown($)).ask).toBe(1)
})

test('a finished reply throws a party and is counted', async ($, on) => {
  const clock = world(on)
  await start($, clock)
  await $.turn.complete({ reason: 'answer', category: null, answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' } as any)
  expect((await shown($)).feel).toBe(1)
  expect(await paneText($)).toContain('1 replies watched')
})

test('a water reminder waits above the prompt until Done, then earns xp', async ($, on) => {
  const clock = world(on)
  await start($, clock)
  expect(await paneText($)).toContain('2 / 25 xp')
  await clock.advance(45 * 60 * 1000 + 1000)
  expect((await shown($)).prop).toBe(13)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  expect(((await ui.find({ type: 'Text', text: /water/ })) as any)?.text).toContain('water')
  await ui.press({ key: 'done' })
  await ui.unmount()
  expect(await paneText($)).toContain('5 / 25 xp')
  await clock.advance(1000)
  expect((await shown($)).prop).toBe(0)
})

test('the pane shows its level and stats, and Play starts a dance', async ($, on) => {
  const clock = world(on, NOV_23_NOON, { stats: { xp: 30, turns: 4, tools: 9, sessions: 2, streak: 1, lastDay: '2026-11-22' } })
  await start($, clock)
  const words = await paneText($)
  expect(words).toContain('Level 1')
  expect(words).toContain('2-day streak')
  expect(words).toContain('3 sessions')
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  await pane.press({ key: 'play-dance' })
  await pane.unmount()
  await clock.advance(1000)
  expect((await shown($)).prop).toBe(7)
})

test('on Auto it wears a Santa hat in December; picking No hat takes it off', async ($, on) => {
  const clock = world(on, DEC_5_NOON)
  await start($, clock)
  let v = await shown($)
  expect(v.hat).toBe(6)
  expect(v.hatOn).toBe(1)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  await pane.press({ key: 'hat-none' })
  await pane.unmount()
  await clock.advance(1000)
  v = await shown($)
  expect(v.hatOn).toBe(0)
})

test('/critter away sends it off and brings it back', async ($, on) => {
  const clock = world(on)
  await start($, clock)
  const away: any = await $.command.run({ command: 'critter', args: 'away' } as any)
  expect(away.text).toContain('nap')
  const back: any = await $.command.run({ command: 'critter', args: 'away' } as any)
  expect(back.text).toContain('back')
})
