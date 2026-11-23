import { expect, test } from 'claude-code/testing'

import { ART, C, paint } from './critter-art'
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
