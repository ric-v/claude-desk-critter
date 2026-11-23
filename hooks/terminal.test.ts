import { expect, test } from 'claude-code/testing'

import { ART, C, PALETTE, paint } from './critter-art'
import type { Pose } from './critter-art'
import { BODY_ROWS, DEFAULT_COLOR, SPRITE_COLS, STRIP_ROWS, Walker, encode } from './terminal'
import type { WalkInput } from './terminal'

const IDLE: Pose = { stride: 0, dancing: false, eyes: 'open', arm: 'rest', hop: 0, prop: 'none', hat: 0, t: 0 }
const cell = (cells: Uint32Array, cols: number, row: number, col: number) => Array.from(cells.slice((row * cols + col) * 3, (row * cols + col) * 3 + 3))
const IN: WalkInput = { now: 1_000_000, laneCols: 80, busy: false, night: false, trick: 'none', reminder: 'none', zoom: false }

test('empty pixels are default spaces', () => {
  const cells = encode(new Uint8Array(ART.w * ART.h), 40, STRIP_ROWS, 0, false)
  for (let i = 0; i < 40 * STRIP_ROWS; i++) expect(Array.from(cells.slice(i * 3, i * 3 + 3))).toEqual([0x20, DEFAULT_COLOR, DEFAULT_COLOR])
})

test('half blocks carry top and bottom colours', () => {
  const px = new Uint8Array(ART.w * ART.h)
  px[(ART.h - 2) * ART.w + (0 - ART.col0)] = C.CLAY // the canvas's last two pixel rows
  px[(ART.h - 1) * ART.w + (0 - ART.col0)] = C.INK
  const cells = encode(px, 40, STRIP_ROWS, 0, false)
  expect(cell(cells, 40, STRIP_ROWS - 1, 0 - ART.col0)).toEqual([0x2580, PALETTE[C.CLAY]!, PALETTE[C.INK]!])
})

test('flip keeps the body in place', () => {
  const clayCols = (flip: boolean) => {
    const cells = encode(paint(IDLE), 40, STRIP_ROWS, 0, flip)
    const cols = new Set<number>()
    for (let i = 0; i < 40 * STRIP_ROWS; i++) if (cells[i * 3 + 1] === PALETTE[C.CLAY] || cells[i * 3 + 2] === PALETTE[C.CLAY]) cols.add(i % 40)
    return [...cols].sort((a, b) => a - b).join()
  }
  expect(clayCols(true)).toBe(clayCols(false))
})

test('crop keeps the feet', () => {
  const cells = encode(paint(IDLE), 40, BODY_ROWS, 0, false)
  const last = Array.from({ length: 40 }, (_, c) => cell(cells, 40, BODY_ROWS - 1, c))
  expect(last.some(([, fg]) => fg === PALETTE[C.CLAY])).toBe(true) // the legs' last pixels, on the strip's last row
})

test('walker stays in lane after a resize', () => {
  const w = new Walker(1)
  w.x = 60
  w.step({ ...IN, laneCols: 40 })
  expect(w.x).toBeLessThanOrEqual(40 - SPRITE_COLS)
  w.step({ ...IN, laneCols: 10 })
  expect(w.x).toBe(0)
})

test('walker sleeps after 3 idle minutes, sooner at night', () => {
  const day = new Walker(1)
  day.step(IN)
  day.step({ ...IN, now: IN.now + 179_000 })
  expect(day.sleeping).toBe(false)
  day.step({ ...IN, now: IN.now + 180_000 })
  expect(day.sleeping).toBe(true)
  day.poke(IN.now + 181_000)
  expect(day.sleeping).toBe(false)

  const night = new Walker(1)
  night.step({ ...IN, night: true })
  night.step({ ...IN, night: true, now: IN.now + 45_000 })
  expect(night.sleeping).toBe(true)
})

test('busy stands still', () => {
  const w = new Walker(1)
  w.x = 20
  for (let i = 0; i < 20; i++) w.step({ ...IN, now: IN.now + i * 125, busy: true })
  expect(w.x).toBe(20)
})

test('reminder walks to the middle', () => {
  const w = new Walker(1)
  for (let i = 0; i < 400; i++) w.step({ ...IN, now: IN.now + i * 125, reminder: 'water' })
  expect(w.x).toBe(Math.floor((IN.laneCols - SPRITE_COLS) / 2))
})

test('pet shows hearts then stops', () => {
  const w = new Walker(1)
  w.pet(IN.now)
  expect(w.pose({ ...IN, now: IN.now + 100 }, 'none', 0, false, 0).prop).toBe('hearts')
  expect(w.pose({ ...IN, now: IN.now + 1600 }, 'none', 0, false, 0).prop).not.toBe('hearts')
})

test('it walks when nothing is happening', () => {
  const w = new Walker(1)
  const start = w.x
  for (let i = 0; i < 200; i++) w.step({ ...IN, now: IN.now + i * 125 })
  expect(w.x).not.toBe(start)
})
