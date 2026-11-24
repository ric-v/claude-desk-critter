import { expect, test } from 'claude-code/testing'

import { ART, C, MINI, PALETTE, paint, paintMini } from './critter-art'
import type { Pose } from './critter-art'
import { BODY_ROWS, DEFAULT_COLOR, PICTURE_SIZES, SIZES, SPRITE_COLS, STRIP_ROWS, Walker, bodyRows, encode, picture, render, renderGrid, spriteCols, stripRows } from './terminal'
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
    [32, 7, 4],
    [48, 11, 6],
    [64, 14, 8],
    [80, 18, 10],
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
  w.step({ ...IN, laneCols: 40, sprite: spriteCols(SIZES[0]!) })
  expect(w.x).toBeLessThanOrEqual(40 - spriteCols(SIZES[0]!))
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
const MINI1 = SIZES[0]!
const ROWS1 = stripRows(MINI1)
// Image pixels whose colour is exactly the clay: the flat middle of its body.
const clayPixels = (pic: { rgba: Uint8Array; width: number; height: number }) => {
  const at: [number, number][] = []
  for (let v = 0; v < pic.height; v++) for (let u = 0; u < pic.width; u++) if (rgbaAt(pic, u, v).join() === clayRGBA.join()) at.push([u, v])
  return at
}

test('a picture draws each painted pixel as a block of four, clear where nothing is painted', () => {
  const pic = picture(MINI1, IDLE, 40, ROWS1, 0, false)
  expect([pic.width, pic.height]).toEqual([40 * 4, MINI.h * 4])
  expect(rgbaAt(pic, 0, 0)).toEqual([0, 0, 0, 0])
  // the middle of its body, painted pixel (5, 2) of the mini grid: the same clay all through the block
  const u = (5 - MINI.col0) * 4
  const v = (2 - MINI.row0) * 4
  for (let d = 0; d < 4; d++) expect(rgbaAt(pic, u + d, v + d)).toEqual(clayRGBA)
})

test('a picture is lit from the top left: a lighter edge there, a darker one at the lower right', () => {
  const pic = picture(MINI1, IDLE, 40, ROWS1, 0, false)
  const lum = (u: number, v: number) => rgbaAt(pic, u, v).slice(0, 3).reduce((a, b) => a + b, 0)
  const top = (0 - MINI.row0) * 4 // the body's top row, painted row 0
  const mid = (5 - MINI.col0) * 4
  expect(lum(mid, top)).toBeGreaterThan(lum(mid, top + 10))
  const rightEdge = (10 - MINI.col0) * 4 - 1 // the body's last image column, painted column 9
  expect(lum(rightEdge, top + 18)).toBeLessThan(lum(mid, top + 10))
})

test('a picture keeps its light on the screen when the critter turns', () => {
  for (const flip of [false, true]) {
    const pic = picture(MINI1, IDLE, 40, ROWS1, 0, flip)
    const v = pic.height - 1 - 4 * 4 - 2 // a row through the middle of its body, clear of its eyes and arms
    const lum = (u: number) => rgbaAt(pic, u, v).slice(0, 3).reduce((a, b) => a + b, 0)
    const solid: number[] = []
    for (let u = 0; u < pic.width; u++) if (rgbaAt(pic, u, v)[3] === 255) solid.push(u)
    // lit on its left edge, in shadow on its right, whichever way it faces
    expect([flip, lum(solid[0]!) > lum(solid[solid.length - 1]!)]).toEqual([flip, true])
  }
})

test('a picture shows a side face and dark open eyes', () => {
  const pic = picture(MINI1, IDLE, 40, ROWS1, 0, false)
  const ink = [(PALETTE[C.INK]! >> 16) & 255, (PALETTE[C.INK]! >> 8) & 255, PALETTE[C.INK]! & 255, 255].join()
  const colours = new Set<string>()
  for (let i = 0; i < pic.width * pic.height; i++) colours.add(Array.from(pic.rgba.slice(i * 4, i * 4 + 4)).join())
  expect(colours.has(ink)).toBe(true)
  const sideFace = [(PALETTE[C.CLAY]! >> 16) & 255, (PALETTE[C.CLAY]! >> 8) & 255, PALETTE[C.CLAY]! & 255].map(c => Math.round(c * 0.52))
  expect(colours.has([...sideFace, 255].join())).toBe(true)
})

test('a picture is flat blocks: each painted pixel is one colour, not a gradient', () => {
  const pic = picture(MINI1, IDLE, 40, ROWS1, 0, false)
  const pp = 4
  for (let v = 0; v < pic.height; v += pp) for (let u = 0; u < pic.width; u += pp) {
    const first = rgbaAt(pic, u, v).join()
    for (let dy = 0; dy < pp; dy++) for (let dx = 0; dx < pp; dx++) expect(rgbaAt(pic, u + dx, v + dy).join()).toBe(first)
  }
})

test('its shadow is soft: see-through, never a flat grey', () => {
  const pic = picture(MINI1, IDLE, 40, ROWS1, 0, false)
  const v = pic.height - 1
  const alphas = new Set<number>()
  for (let u = 0; u < pic.width; u++) {
    const [r, g, b, a] = rgbaAt(pic, u, v)
    if (a! > 0 && r === 0 && g === 0 && b === 0) alphas.add(a!)
  }
  expect(alphas.size).toBeGreaterThan(1)
  for (const a of alphas) expect(a).toBeLessThan(255)
})

test('a picture walks by a fraction of a pixel, and turns about its body', () => {
  const base = clayPixels(picture(MINI1, IDLE, 40, ROWS1, 0, false))
  const moved = clayPixels(picture(MINI1, IDLE, 40, ROWS1, 0.5, false))
  expect(moved[0]![0] - base[0]![0]).toBe(2)
  const flipped = clayPixels(picture(MINI1, IDLE, 40, ROWS1, 0, true))
  const span = (ps: [number, number][]) => [Math.min(...ps.map(p => p[0])), Math.max(...ps.map(p => p[0]))]
  expect(Math.abs(span(flipped)[0]! - span(base)[0]!)).toBeLessThanOrEqual(4)
})

test('a picture never passes the image size limit, and stays small on a wide lane', () => {
  for (const look of SIZES) {
    const pic = picture(look, IDLE, 512, stripRows(look), 0, false)
    expect(pic.width).toBeLessThanOrEqual(2048)
    expect([pic.width, pic.height]).toEqual([512 * 4 > 2048 ? 2048 : 512 * 4, stripRows(look) * 8])
    expect(pic.rgba.length).toBe(pic.width * pic.height * 4)
  }
})

test('lifted, a picture rises by image pixels and its shadow shrinks', () => {
  const ground = (pic: { rgba: Uint8Array; width: number; height: number }) => {
    let n = 0
    for (let u = 0; u < pic.width; u++) if (rgbaAt(pic, u, pic.height - 1)[3]! > 0) n++
    return n
  }
  const low = picture(MINI1, IDLE, 40, ROWS1, 0, false)
  const high = picture(MINI1, { ...IDLE, air: 4.5 }, 40, ROWS1, 0, false)
  expect(clayPixels(low)[0]![1] - clayPixels(high)[0]![1]).toBe(20) // 4.5 pixels rounds to 5 painted pixels, 4 image pixels each
  expect(ground(high)).toBeLessThan(ground(low))
})

test('the text critter is lit too, with a flat clay middle', () => {
  const cells = render(MINI1, IDLE, 40, ROWS1, 0, false)
  const colors = new Set<number>()
  for (let i = 0; i < cells.length / 3; i++) if (cells[i * 3] !== 0x20) colors.add(cells[i * 3 + 1]!)
  expect(colors.has(PALETTE[C.CLAY]!)).toBe(true)
  expect([...colors].filter(c => c !== DEFAULT_COLOR && !PALETTE.includes(c)).length).toBeGreaterThan(0)
  for (let i = 0; i < cells.length / 3; i++) if (cells[i * 3] !== 0x20) expect(cells[i * 3 + 1]).not.toBe(DEFAULT_COLOR)
})

// The pointer, in lane columns and pixels above the ground.
const LIVE: WalkInput = { ...IN, sprite: 32, center: 10, headroom: 6 }

test('a tap pets it; it is only picked up once the pointer moves', () => {
  const w = new Walker(1)
  w.x = 20
  w.settle(LIVE)
  expect(w.press(IN.now, 30, 2, true)).toBe(true)
  expect(w.pose(LIVE, 'none', 0, false, 0).prop).toBe('hearts')
  w.drag(IN.now + 20, 30.4, 2.3)
  expect(w.mode).toBe('ground')
  w.release(IN.now + 60)
  expect([w.mode, w.x]).toEqual(['ground', 20])
  expect(w.press(IN.now, 5, 2, false)).toBe(false)
})

test('dragged, it follows the pointer up off the ground, arms up and legs kicking', () => {
  const w = new Walker(1)
  w.x = 20
  w.settle(LIVE)
  w.press(IN.now, 30, 2, true)
  w.drag(IN.now + 50, 36, 5)
  expect(w.mode).toBe('held')
  expect(w.x).toBe(26)
  expect(w.air).toBeGreaterThan(3)
  const pose = w.pose({ ...LIVE, now: IN.now + 60 }, 'type', 0, false, 0)
  expect([pose.held, pose.prop, pose.hop]).toEqual([true, 'none', 0])
  for (let i = 0; i < 10; i++) w.step({ ...LIVE, now: IN.now + 100 + i * 50 })
  expect(w.x).toBe(26) // held, it does not walk off
})

test('thrown, it flies, falls, bounces and lands; a hard landing leaves it dizzy', () => {
  const w = new Walker(1)
  w.x = 20
  w.settle(LIVE)
  w.press(IN.now, 30, 2, true)
  w.drag(IN.now + 20, 32, 4)
  w.drag(IN.now + 60, 40, 9)
  w.drag(IN.now + 100, 48, 10)
  w.release(IN.now + 100)
  expect(w.mode).toBe('flying')
  let t = IN.now + 100
  let landed = false
  let dizzy = false
  for (let i = 0; i < 80 && !landed; i++) {
    t += 50
    w.step({ ...LIVE, now: t })
    if (w.pose({ ...LIVE, now: t }, 'none', 0, false, 0).dizzy) dizzy = true
    landed = w.mode === 'ground' && !w.lively
  }
  expect(landed).toBe(true)
  expect(w.air).toBe(0)
  expect(w.x).toBeGreaterThan(38) // it carried on the way it was thrown
  expect(w.x).toBeLessThanOrEqual(80 - 32)
  expect(dizzy).toBe(true)
})

test('dropped gently, it lands without seeing stars', () => {
  const w = new Walker(1)
  w.x = 20
  w.settle(LIVE)
  w.press(IN.now, 30, 2, true)
  w.drag(IN.now + 200, 30, 4)
  w.drag(IN.now + 400, 30, 4)
  w.release(IN.now + 400)
  let t = IN.now + 400
  for (let i = 0; i < 40; i++) {
    t += 50
    w.step({ ...LIVE, now: t })
    expect(w.pose({ ...LIVE, now: t }, 'none', 0, false, 0).dizzy).toBe(false)
  }
  expect([w.mode, w.air]).toEqual(['ground', 0])
})

test('thrown at the end of the lane, it bounces back off it', () => {
  const w = new Walker(1)
  w.x = 10
  w.settle(LIVE)
  w.press(IN.now, 20, 2, true)
  w.drag(IN.now + 50, 30, 3)
  w.drag(IN.now + 100, 45, 4)
  w.release(IN.now + 100)
  let t = IN.now + 100
  let hit = false
  for (let i = 0; i < 60; i++) {
    t += 50
    w.step({ ...LIVE, now: t })
    if (w.x >= 48) hit = true
  }
  expect(hit).toBe(true)
  expect(w.x).toBeLessThan(48)
})

test('its eyes follow the pointer, and up when the pointer is over its head', () => {
  const w = new Walker(1)
  w.x = 20
  w.settle(LIVE)
  w.hover(IN.now, 60, 1, false)
  expect(w.pose(LIVE, 'none', 0, false, 0).look).toEqual([w.facing, 0])
  w.hover(IN.now, 0, 12, false)
  expect(w.pose(LIVE, 'none', 0, false, 0).look).toEqual([-w.facing, -1])
  w.hover(IN.now, 30, 2, true)
  expect(w.pose(LIVE, 'none', 0, false, 0).look).toEqual([0, 0])
  w.unhover()
  expect(w.pose(LIVE, 'none', 0, false, 0).look).toBeUndefined()
})

test('rubbed back and forth, it is petted', () => {
  const w = new Walker(1)
  w.x = 20
  w.settle(LIVE)
  const cols = [28, 31, 28, 31, 28]
  const pets = cols.map((c, i) => w.hover(IN.now + i * 100, c, 3, true))
  expect(pets.slice(0, 3)).toEqual([false, false, false])
  expect(pets.includes(true)).toBe(true)
  expect(w.pose({ ...LIVE, now: IN.now + 500 }, 'none', 0, false, 0).prop).toBe('hearts')
})

test('resting the pointer on it stops its walk', () => {
  const w = new Walker(1)
  w.x = 20
  for (let i = 0; i < 40; i++) {
    w.hover(IN.now + i * 125, 30, 3, true)
    w.step({ ...LIVE, now: IN.now + i * 125 })
  }
  expect(w.x).toBe(20)
})

test('a picture draws the same critter as the text', () => {
  expect(PICTURE_SIZES).toBe(SIZES)
})

test('facing left keeps a prop whole', () => {
  const look = SIZES[0]!
  const painted = (flip: boolean) => {
    const cells = encode(look.paint({ ...IDLE, prop: 'type', arm: 'holding' }), 60, stripRows(look), 20, flip, 1, look.art)
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

test('a hop moves the whole critter by whole cells, so it keeps its shape at any size', () => {
  for (const look of SIZES) {
    const rows = stripRows(look)
    const cols = spriteCols(look)
    const g0 = renderGrid(look, { ...IDLE }, cols, rows, 0, false)
    const g1 = renderGrid(look, { ...IDLE, hop: 1 }, cols, rows, 0, false)
    const k = Math.round(look.scale)
    const clay = (g: Uint8Array, shift: number) => {
      const at: string[] = []
      for (let h = 0; h < rows * 2; h++) for (let c = 0; c < cols; c++) if (g[h * cols + c] === C.CLAY) at.push(`${c},${h + shift}`)
      return at.join(' ')
    }
    expect([look.scale, clay(g1, k)]).toEqual([look.scale, clay(g0, 0)])
  }
})

test('at work it turns to face the side with room for its props', () => {
  const near = new Walker(1)
  near.x = 5
  near.facing = -1
  near.step({ ...IN, busy: true, sprite: 32, reach: 12 })
  expect(near.facing).toBe(1)
  const far = new Walker(1)
  far.x = 40
  far.step({ ...IN, busy: true, sprite: 32, reach: 12 })
  expect(far.facing).toBe(-1)
})
