import { expect, mock, test } from 'claude-code/testing'

import { C, PALETTE } from './critter-art'

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

// ---- The terminal: the critter in a strip above the prompt.
const TERM = { ...BAND, surface: 'terminal', props: { ...BAND.props, maxRows: 30, bodyColumns: 100 } } as const
const term = (props: Record<string, unknown> = {}) => ({ ...TERM, props: { ...TERM.props, ...props } }) as any

async function startTerm($: any, clock: any, on: any, pictures = true) {
  const blits: any[] = []
  on('ui.blit', async (_: any, e: any) => {
    blits.push(e)
    // A terminal that cannot show pictures draws the Image's alt, and refuses its blits.
    return { value: e.source !== undefined && !pictures ? { deny: 'the Image draws its alt here' } : {} }
  })
  on('ui.message', async () => ({}) as any)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as any)
  await clock.advance(2000)
  return blits
}

test('terminal shows the critter strip', async ($, on) => {
  const clock = world(on)
  await startTerm($, clock, on)
  const ui = await $.ui.mount(term())
  const raster: any = await ui.find({ type: 'Raster' })
  expect(raster?.props.rows).toBe(7) // size 1: the mini critter
  expect(await ui.find({ type: 'Text', text: /critter Lv 0/ })).toBeDefined()
  await ui.unmount()
})

test('desktop shows no strip', async ($, on) => {
  const clock = world(on)
  await start($, clock)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, maxRows: 30 } } as any)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('away hides the strip', async ($, on) => {
  const clock = world(on)
  await startTerm($, clock, on)
  await $.command.run({ command: 'critter', args: 'away' } as any)
  const ui = await $.ui.mount(term())
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('short terminal trims, then captions, then hides', async ($, on) => {
  const clock = world(on)
  await startTerm($, clock, on)
  await $.command.run({ command: 'critter', args: 'size 4' } as any) // 18 rows, its body 10
  let ui = await $.ui.mount(term({ maxRows: 10 }))
  expect(((await ui.find({ type: 'Raster' })) as any)?.props.rows).toBe(10)
  await ui.unmount()
  ui = await $.ui.mount(term({ maxRows: 5 })) // too short for size 4's body: size 1 fits
  expect(((await ui.find({ type: 'Raster' })) as any)?.props.rows).toBe(5)
  await ui.unmount()
  ui = await $.ui.mount(term({ maxRows: 1 }))
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /critter Lv/ })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(term({ maxRows: 0 }))
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /critter Lv/ })).toBeUndefined()
  await ui.unmount()
})

test('narrow terminal still fits', async ($, on) => {
  const clock = world(on)
  await startTerm($, clock, on)
  const ui = await $.ui.mount(term({ bodyColumns: 30 }))
  const raster: any = await ui.find({ type: 'Raster' })
  expect(raster?.props.columns).toBeGreaterThanOrEqual(0)
  await ui.unmount()
})

test("another mod's line survives", async ($, on) => {
  const clock = world(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>Other mod</Text>
  })
  await startTerm($, clock, on)
  const ui = await $.ui.mount(term())
  expect(await ui.find({ type: 'Text', text: 'Other mod' })).toBeDefined()
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  await ui.unmount()
})

test('reminder line sits under the strip', async ($, on) => {
  const clock = world(on)
  await startTerm($, clock, on)
  await clock.advance(45 * 60 * 1000 + 1000)
  const ui = await $.ui.mount(term())
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Your critter brought you some water/ })).toBeDefined()
  await ui.unmount()
})

test('a Read shows reading in the caption', async ($, on) => {
  const clock = world(on)
  await startTerm($, clock, on)
  await $.tool.call({ tool: 'Read', file_path: 'C:/x.txt' } as any)
  await clock.advance(400)
  const ui = await $.ui.mount(term())
  expect(await ui.find({ type: 'Text', text: /reading/ })).toBeDefined()
  await ui.unmount()
})

test('asleep, it stops blitting; an event wakes it', async ($, on) => {
  // At night it nods off after 45 quiet seconds (3 minutes by day: the same code, unit-tested in terminal.test.ts).
  // With no strip mounted nothing ticks, so the quiet minute costs nothing here.
  const clock = world(on, new Date(2026, 10, 23, 23, 0, 0).getTime())
  const blits = await startTerm($, clock, on)
  await clock.advance(50_000)
  const ui = await $.ui.mount(term())
  expect(await ui.find({ type: 'Text', text: /asleep/ })).toBeDefined()
  const before = blits.length
  await clock.advance(10_000)
  expect(blits.length - before).toBeLessThanOrEqual(10) // a z frame a second at most
  await $.command.run({ command: 'critter', args: 'dance' } as any) // its legs move every frame
  const woke = blits.length
  await clock.advance(2000)
  expect(blits.length - woke).toBeGreaterThan(4) // awake: more than 2 frames a second; asleep it was at most 1
  await ui.unmount()
})

// The Raster's cells, decoded: [codepoint, fg, bg] per cell.
function cellsOf(base64: string): Uint32Array {
  const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0))
  return new Uint32Array(bytes.buffer)
}
const hasColor = (cells: Uint32Array, color: number) => cells.some((v, i) => i % 3 !== 0 && v === color)

// Where the critter's body is: the strip column of its first clay cell, and the lane's left edge.
async function critterAt(ui: any) {
  const raster: any = await ui.find({ type: 'Raster' })
  const caption: any = await ui.find({ type: 'Text', text: /critter Lv/ })
  const laneLeft = caption.text.length + 2
  const cells = cellsOf(raster.props.cells)
  const cols = raster.props.columns
  let first = cols
  for (let i = 0; i < cells.length / 3; i++) if (cells[i * 3 + 1] === PALETTE[C.CLAY] || cells[i * 3 + 2] === PALETTE[C.CLAY]) first = Math.min(first, i % cols)
  return { laneLeft, body: laneLeft + first, cols, rows: raster.props.rows }
}

test('a click on the critter pets it', async ($, on) => {
  const clock = world(on)
  const blits = await startTerm($, clock, on)
  const ui = await $.ui.mount(term())
  const at = await critterAt(ui)
  await (ui as any).pointer({ type: 'down', x: at.body + 1, y: at.rows - 1, button: 'left' } as any)
  await clock.advance(250)
  expect(blits.some(b => hasColor(cellsOf(b.cells), PALETTE[C.ROSE]!))).toBe(true)
  await ui.unmount()
})

test('a click beside it does nothing', async ($, on) => {
  const clock = world(on)
  const blits = await startTerm($, clock, on)
  const ui = await $.ui.mount(term())
  const at = await critterAt(ui)
  const far = at.body > at.laneLeft + 40 ? at.laneLeft + 1 : 99
  await (ui as any).pointer({ type: 'down', x: far, y: at.rows - 2, button: 'left' } as any)
  await clock.advance(250)
  expect(blits.some(b => hasColor(cellsOf(b.cells), PALETTE[C.ROSE]!))).toBe(false)
  await ui.unmount()
})

test('dragged by the pointer it is carried off; let go, it falls back to the ground', async ($, on) => {
  const clock = world(on)
  const blits = await startTerm($, clock, on)
  const ui = await $.ui.mount(term())
  const at = await critterAt(ui)
  const y = at.rows - 1
  await (ui as any).pointer({ type: 'down', x: at.body + 1, y, button: 'left' } as any)
  await clock.advance(60)
  // Up and to the side: the critter's clay goes up off the bottom row and moves with the pointer.
  for (let i = 1; i <= 6; i++) {
    await (ui as any).pointer({ type: 'move', x: at.body + 1 + i * 2, y: Math.max(0, y - i), button: 'left' } as any)
    await clock.advance(60)
  }
  const clayRows = (b: any) => {
    const cells = cellsOf(b.cells)
    const rows = new Set<number>()
    for (let i = 0; i < cells.length / 3; i++) if (cells[i * 3 + 1] === PALETTE[C.CLAY] || cells[i * 3 + 2] === PALETTE[C.CLAY]) rows.add(Math.floor(i / at.cols))
    return rows
  }
  const held = blits[blits.length - 1]
  expect(clayRows(held).has(at.rows - 1)).toBe(false) // lifted clear of its strip's last row
  await (ui as any).pointer({ type: 'up', x: at.body + 13, y: 0, button: 'left' } as any)
  await clock.advance(3000)
  expect(clayRows(blits[blits.length - 1]).has(at.rows - 1)).toBe(true) // back on its feet
  await ui.unmount()
})

test('a pointer rubbing back and forth over it pets it', async ($, on) => {
  const clock = world(on)
  const blits = await startTerm($, clock, on)
  const ui = await $.ui.mount(term())
  const at = await critterAt(ui)
  for (let i = 0; i < 8; i++) {
    await (ui as any).pointer({ type: 'move', x: at.body + (i % 2 ? 5 : 1), y: at.rows - 2 } as any)
    await clock.advance(40)
  }
  await clock.advance(250)
  expect(blits.some(b => hasColor(cellsOf(b.cells), PALETTE[C.ROSE]!))).toBe(true)
  await ui.unmount()
})

test('/critter size 2 makes a bigger critter', async ($, on) => {
  const clock = world(on)
  await startTerm($, clock, on)
  const said: any = await $.command.run({ command: 'critter', args: 'size 2' } as any)
  expect(said.text).toContain('2')
  const ui = await $.ui.mount(term({ bodyColumns: 200, maxRows: 40 }))
  expect(((await ui.find({ type: 'Raster' })) as any)?.props.rows).toBe(11)
  await ui.unmount()
})

test('a size that does not fit falls back to one that does', async ($, on) => {
  const clock = world(on)
  await startTerm($, clock, on)
  await $.command.run({ command: 'critter', args: 'size 4' } as any)
  const ui = await $.ui.mount(term({ bodyColumns: 90, maxRows: 30 }))
  // sizes 4 and 3 need 80 and 64 columns beside the caption and get 60; size 2 needs 48
  expect(((await ui.find({ type: 'Raster' })) as any)?.props.rows).toBe(11)
  expect(await ui.find({ type: 'Text', text: /size 2/ })).toBeDefined()
  await ui.unmount()
})

test('/critter size with no number says the size; a bad one says how', async ($, on) => {
  const clock = world(on)
  await startTerm($, clock, on)
  expect(((await $.command.run({ command: 'critter', args: 'size' } as any)) as any).text).toContain('1')
  expect(((await $.command.run({ command: 'critter', args: 'size 9' } as any)) as any).text).toContain('1 to 4')
})

test('the pane picks a size', async ($, on) => {
  const clock = world(on)
  await startTerm($, clock, on)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  await pane.press({ key: 'size-4' })
  await pane.unmount()
  const ui = await $.ui.mount(term({ bodyColumns: 200, maxRows: 40 }))
  expect(((await ui.find({ type: 'Raster' })) as any)?.props.rows).toBe(18)
  await ui.unmount()
})

test('a terminal that shows pictures gets the critter as a picture', async ($, on) => {
  const clock = world(on)
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  await startTerm($, clock, on)
  const ui = await $.ui.mount(term())
  const img: any = await ui.find({ type: 'Image' })
  expect(img?.props.rows).toBe(7)
  expect(img?.props.source.width).toBeGreaterThan(0)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('Windows Terminal and the rest get the text critter', async ($, on) => {
  const clock = world(on)
  mock.env(on, { WT_SESSION: 'x', TERM_PROGRAM: 'vscode' })
  await startTerm($, clock, on)
  const ui = await $.ui.mount(term())
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  await ui.unmount()
})

test('a picture the terminal refuses turns into the text critter', async ($, on) => {
  const clock = world(on)
  mock.env(on, { TERM: 'xterm-kitty' })
  await startTerm($, clock, on, false)
  let ui = await $.ui.mount(term())
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await clock.advance(500) // a tick's blit is refused
  await ui.unmount()
  ui = await $.ui.mount(term())
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  await ui.unmount()
})

test('the backdrop is set early, and again once the session has started', async ($, on) => {
  mock.clock(on, { now: NOV_23_NOON })
  mock.store(on, {})
  let themes = 0
  let themesWhenStarted = -1
  on('theme.set', () => {
    themes += 1
    return { value: { isDrawn: true, requestId: 'r1' } } as any
  })
  on('session.start', (_: any, e: any) => {
    themesWhenStarted = themes // the engine's own start (MCP servers and all) runs here
    return { cwd: e.cwd } as any
  })
  on('command.register', () => ({ value: undefined }) as any)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  expect(themesWhenStarted).toBe(1) // early, before the engine's own start
  expect(themes).toBe(2) // and again at the end, in case the app dropped the early one
})
