import { expect, test } from 'claude-code/testing'

import { ART, C, MINI, PALETTE, paint, paintMini } from './critter-art'
import type { Pose } from './critter-art'
import { BODY_ROWS, DEFAULT_COLOR, PICTURE_SIZES, SIZES, SPRITE_COLS, STRIP_ROWS, Walker, bodyRows, encode, picture, spriteCols, stripRows } from './terminal'
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

test('settle catches up on sleep without moving', () => {
  const w = new Walker(1)
  w.x = 7
  w.settle(IN)
  w.settle({ ...IN, now: IN.now + 180_000 })
  expect(w.sleeping).toBe(true)
  expect(w.x).toBe(7)
})

test('scale 2 doubles each pixel', () => {
  const px = new Uint8Array(ART.w * ART.h)
  px[(ART.h - 1) * ART.w + (0 - ART.col0)] = C.CLAY // one pixel on the bottom row
  const cols = 80
  const cells = encode(px, cols, STRIP_ROWS * 2, 0, false, 2)
  const c0 = (0 - ART.col0) * 2
  expect(cell(cells, cols, STRIP_ROWS * 2 - 1, c0)).toEqual([0x2580, PALETTE[C.CLAY]!, PALETTE[C.CLAY]!])
  expect(cell(cells, cols, STRIP_ROWS * 2 - 1, c0 + 1)).toEqual([0x2580, PALETTE[C.CLAY]!, PALETTE[C.CLAY]!])
  expect(cell(cells, cols, STRIP_ROWS * 2 - 1, c0 + 2)).toEqual([0x20, DEFAULT_COLOR, DEFAULT_COLOR])
  expect(cell(cells, cols, STRIP_ROWS * 2 - 2, c0)).toEqual([0x20, DEFAULT_COLOR, DEFAULT_COLOR])
})

test('a bigger critter needs a wider lane', () => {
  const w = new Walker(1)
  w.x = 70
  w.step({ ...IN, laneCols: 100, sprite: SPRITE_COLS * 2 })
  expect(w.x).toBeLessThanOrEqual(100 - SPRITE_COLS * 2)
})

test('every size is the same critter, at 1, 1.5, 2 and 2.5 times', () => {
  expect(SIZES.map(look => look.scale)).toEqual([1, 1.5, 2, 2.5])
  for (const look of SIZES) expect([look.art, look.paint]).toEqual([MINI, paintMini])
  expect(SIZES.map(look => [spriteCols(look), stripRows(look), bodyRows(look)])).toEqual([
    [26, 7, 4],
    [39, 11, 6],
    [52, 14, 8],
    [65, 18, 10],
  ])
})

test('the mini critter draws with its eyes in half blocks', () => {
  const look = SIZES[0]!
  const cells = encode(look.paint(IDLE), spriteCols(look), stripRows(look), 0, false, look.scale, look.art)
  expect(cells.some((v, i) => i % 3 !== 0 && v === PALETTE[C.INK])).toBe(true)
  expect(cells.some((v, i) => i % 3 !== 0 && v === PALETTE[C.CLAY])).toBe(true)
})

test('flip keeps the mini body in place', () => {
  const look = SIZES[0]!
  const clayCols = (flip: boolean) => {
    const cells = encode(look.paint(IDLE), 30, stripRows(look), 0, flip, 1, look.art)
    const cols = new Set<number>()
    const body = [PALETTE[C.CLAY], PALETTE[C.EMBER]] // lit or shaded, it is all body
    for (let i = 0; i < cells.length / 3; i++) if (body.includes(cells[i * 3 + 1]) || body.includes(cells[i * 3 + 2])) cols.add(i % 30)
    return [...cols].sort((a, b) => a - b).join()
  }
  expect(clayCols(true)).toBe(clayCols(false))
})

test('a small critter fits its lane', () => {
  const w = new Walker(1)
  w.x = 50
  w.step({ ...IN, laneCols: 30, sprite: spriteCols(SIZES[0]!) })
  expect(w.x).toBeLessThanOrEqual(30 - spriteCols(SIZES[0]!))
})

test('a cell with only its bottom half painted is a lower half block on the terminal background', () => {
  const px = new Uint8Array(ART.w * ART.h)
  px[(ART.h - 1) * ART.w + (0 - ART.col0)] = C.CLAY
  const cells = encode(px, 40, STRIP_ROWS, 0, false)
  expect(cell(cells, 40, STRIP_ROWS - 1, 0 - ART.col0)).toEqual([0x2584, PALETTE[C.CLAY]!, DEFAULT_COLOR])
})

test('no drawn cell ever takes the terminal text colour', () => {
  for (const look of SIZES) {
    for (const prop of ['none', 'type', 'ask', 'party', 'web'] as const) {
      const cells = encode(look.paint({ ...IDLE, prop, hat: 3 }), spriteCols(look), stripRows(look), 0, false, look.scale, look.art)
      for (let i = 0; i < cells.length / 3; i++) if (cells[i * 3] !== 0x20) expect(cells[i * 3 + 1]).not.toBe(DEFAULT_COLOR)
    }
  }
})

const rgbaAt = (pic: { rgba: Uint8Array; width: number }, u: number, v: number) => Array.from(pic.rgba.slice((v * pic.width + u) * 4, (v * pic.width + u) * 4 + 4))
const clayRGBA = [(PALETTE[C.CLAY]! >> 16) & 255, (PALETTE[C.CLAY]! >> 8) & 255, PALETTE[C.CLAY]! & 255, 255]

test('a picture draws each pixel as a square block, clear where nothing is painted', () => {
  const px = new Uint8Array(ART.w * ART.h)
  px[(ART.h - 1) * ART.w + (0 - ART.col0)] = C.CLAY // one pixel on the bottom row
  const pic = picture(px, 40, STRIP_ROWS, 0, false)
  expect([pic.width, pic.height]).toEqual([40 * 3, ART.h * 3])
  const u = (0 - ART.col0) * 3
  expect(rgbaAt(pic, u, pic.height - 1)).toEqual(clayRGBA)
  expect(rgbaAt(pic, u + 2, pic.height - 3)).toEqual(clayRGBA)
  expect(rgbaAt(pic, u + 3, pic.height - 1)).toEqual([0, 0, 0, 0])
  expect(rgbaAt(pic, u, pic.height - 4)).toEqual([0, 0, 0, 0])
})

test('a picture walks and turns like the text critter', () => {
  const px = new Uint8Array(ART.w * ART.h)
  px[(ART.h - 1) * ART.w + (0 - ART.col0)] = C.CLAY
  const moved = picture(px, 40, STRIP_ROWS, 5, false)
  expect(rgbaAt(moved, (5 - ART.col0) * 3, moved.height - 1)).toEqual(clayRGBA)
  const flipped = picture(px, 40, STRIP_ROWS, 0, true)
  expect(rgbaAt(flipped, (2 * ART.mid - 1 - (0 - ART.col0)) * 3, flipped.height - 1)).toEqual(clayRGBA)
})

test('a picture never passes the image size limit', () => {
  const pic = picture(paint(IDLE), 512, STRIP_ROWS, 0, false, 13 / 18)
  expect(pic.width).toBeLessThanOrEqual(2048)
  expect(pic.rgba.length).toBe(pic.width * pic.height * 4)
})

test('a picture draws the same critter as the text', () => {
  expect(PICTURE_SIZES).toBe(SIZES)
})

test('facing left keeps a prop whole', () => {
  const look = SIZES[0]!
  const painted = (flip: boolean) => {
    const cells = encode(look.paint({ ...IDLE, prop: 'type', arm: 'holding' }), 60, stripRows(look), 10, flip, 1, look.art)
    let n = 0
    for (let i = 0; i < cells.length / 3; i++) if (cells[i * 3] !== 0x20) n++
    return n
  }
  expect(painted(true)).toBe(painted(false))
})

test('a new act starts a short transition from the last one', () => {
  const w = new Walker(1)
  expect(w.pose(IN, 'none', 0, false, 0).enter).toBe(1)
  const start = w.pose({ ...IN, now: IN.now + 1000 }, 'type', 0, false, 0)
  expect([start.enter, start.from]).toEqual([0, 'none'])
  expect(w.pose({ ...IN, now: IN.now + 1200 }, 'type', 0, false, 0).enter).toBe(0.5)
  expect(w.pose({ ...IN, now: IN.now + 1600 }, 'type', 0, false, 0).enter).toBe(1)
})

test('it is still when it has not moved for a moment', () => {
  const w = new Walker(1)
  for (let i = 0; i < 10; i++) w.step({ ...IN, now: IN.now + i * 125, busy: true })
  expect(w.pose({ ...IN, now: IN.now + 1250 }, 'none', 0, false, 0).still).toBe(true)
})
