import { expect, test } from 'claude-code/testing'

import { ART, C, MINI, paint, paintMini } from './critter-art'
import type { Pose } from './critter-art'

const IDLE: Pose = { stride: 0, dancing: false, eyes: 'open', arm: 'rest', hop: 0, prop: 'none', hat: 0, t: 0 }
const at = (px: Uint8Array, gx: number, gy: number) => px[(gy - ART.row0) * ART.w + (gx - ART.col0)]

test('body is clay', () => {
  const px = paint(IDLE)
  expect(at(px, 6, 1)).toBe(C.CLAY)
  expect(at(px, 0, 4)).toBe(C.CLAY) // side nub
})

test('eyes are ink at rest', () => {
  const px = paint(IDLE)
  expect(at(px, 3, 3)).toBe(C.INK)
  expect(at(px, 9, 3)).toBe(C.INK)
})

test('happy eyes make carets', () => {
  const px = paint({ ...IDLE, eyes: 'happy' })
  expect(at(px, 3, 2)).toBe(C.INK)
  expect(at(px, 3, 3)).toBe(C.CLAY)
})

test('legs step', () => {
  expect(at(paint({ ...IDLE, stride: 0 }), 2, 9)).not.toBe(at(paint({ ...IDLE, stride: 1 }), 2, 9))
})

test('hop lifts one row', () => {
  const idle = paint(IDLE)
  const hop = paint({ ...IDLE, hop: 1 })
  expect(at(hop, 6, 0)).toBe(at(idle, 6, 1))
  expect(at(idle, 6, -1)).toBe(0)
  expect(at(hop, 6, -1)).toBe(C.CLAY)
  expect(at(hop, 2, 9)).toBe(0)
})

test('nothing outside the critter at rest', () => {
  const px = paint(IDLE)
  for (let gy = ART.row0; gy < -1; gy++) for (let gx = ART.col0; gx < ART.col0 + ART.w; gx++) expect(at(px, gx, gy)).toBe(0)
})

const count = (px: Uint8Array, keep: (gx: number, gy: number, v: number) => boolean) => {
  let n = 0
  for (let r = 0; r < ART.h; r++) for (let c = 0; c < ART.w; c++) if (keep(ART.col0 + c, ART.row0 + r, px[r * ART.w + c]!)) n++
  return n
}

test('type puts a laptop in front', () => {
  expect(at(paint({ ...IDLE, prop: 'type', arm: 'holding' }), 18, 6)).toBe(C.SKY)
})

test('shell shows a terminal', () => {
  expect(at(paint({ ...IDLE, prop: 'shell', arm: 'holding' }), 20, 4)).toBe(C.NIGHT)
})

test('ask shows the bubble and hides the hat', () => {
  const px = paint({ ...IDLE, prop: 'ask', arm: 'wave', hat: 4 })
  expect(at(px, 6, -6)).toBe(C.INK)
  expect(count(px, (_, gy, v) => gy >= -4 && gy <= -2 && v === C.GOLD)).toBe(0)
})

test('each hat paints above the head', () => {
  for (let hat = 1; hat <= 7; hat++) expect(count(paint({ ...IDLE, hat }), (_, gy, v) => gy < 0 && v !== 0)).toBeGreaterThan(0)
})

test('wizard hat fits the canvas', () => {
  const px = paint({ ...IDLE, hat: 3 })
  expect(count(px, (_, gy, v) => gy === ART.row0 && v !== 0)).toBeLessThanOrEqual(1)
})

test('water holds a bottle, coffee a mug', () => {
  const water = paint({ ...IDLE, prop: 'water', arm: 'holding' })
  const coffee = paint({ ...IDLE, prop: 'coffee', arm: 'holding' })
  expect(water.join()).not.toBe(coffee.join())
  expect(count(water, (gx, _, v) => gx >= 13 && v !== 0 && v !== C.CLAY)).toBeGreaterThan(0)
  expect(count(coffee, (gx, _, v) => gx >= 13 && v !== 0 && v !== C.CLAY)).toBeGreaterThan(0)
})

test('hearts are rose above its head', () => {
  expect(count(paint({ ...IDLE, prop: 'hearts', eyes: 'happy' }), (_, gy, v) => gy < 0 && v === C.ROSE)).toBeGreaterThan(0)
})

// ---- The mini critter, drawn by hand for the smallest size.
const atMini = (px: Uint8Array, gx: number, gy: number) => px[(gy - MINI.row0) * MINI.w + (gx - MINI.col0)]
const countMini = (px: Uint8Array, keep: (gx: number, gy: number, v: number) => boolean) => {
  let n = 0
  for (let r = 0; r < MINI.h; r++) for (let c = 0; c < MINI.w; c++) if (keep(MINI.col0 + c, MINI.row0 + r, px[r * MINI.w + c]!)) n++
  return n
}

test('the mini critter has a clay body, two eyes and legs', () => {
  const px = paintMini(IDLE)
  expect(atMini(px, 4, 2)).toBe(C.CLAY)
  expect(atMini(px, 2, 1)).toBe(C.INK)
  expect(atMini(px, 6, 1)).toBe(C.INK)
  expect(atMini(px, 1, 4)).toBe(C.CLAY)
})

test('the mini critter steps and hops', () => {
  expect(paintMini({ ...IDLE, stride: 0 }).join()).not.toBe(paintMini({ ...IDLE, stride: 1 }).join())
  expect(atMini(paintMini({ ...IDLE, hop: 1 }), 4, -1)).toBe(C.CLAY)
})

test('every mini prop and hat shows', () => {
  const idle = paintMini(IDLE).join()
  for (const prop of ['type', 'read', 'search', 'web', 'shell', 'think', 'ask', 'party', 'sad', 'dance', 'sparkler', 'nap', 'zoomies', 'water', 'coffee', 'hearts'] as const)
    expect(paintMini({ ...IDLE, prop }).join()).not.toBe(idle)
  for (let hat = 1; hat <= 7; hat++) expect(countMini(paintMini({ ...IDLE, hat }), (_, gy, v) => gy < 0 && v !== 0)).toBeGreaterThan(0)
})
