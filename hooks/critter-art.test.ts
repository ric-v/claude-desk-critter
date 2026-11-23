import { expect, test } from 'claude-code/testing'

import { ART, C, MINI, miniLift, paint, paintMini } from './critter-art'
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
  expect(at(hop, 2, 9)).not.toBe(C.CLAY) // the leg lifted off the ground; its shadow stays
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

// ---- The mini critter, drawn by hand in the mascot's style: flat clay, square eyes, side arms, four legs.
const atMini = (px: Uint8Array, gx: number, gy: number) => px[(gy - MINI.row0) * MINI.w + (gx - MINI.col0)]
const countMini = (px: Uint8Array, keep: (gx: number, gy: number, v: number) => boolean) => {
  let n = 0
  for (let r = 0; r < MINI.h; r++) for (let c = 0; c < MINI.w; c++) if (keep(MINI.col0 + c, MINI.row0 + r, px[r * MINI.w + c]!)) n++
  return n
}

test('every mini action animates', () => {
  for (const prop of ['type', 'read', 'search', 'web', 'shell', 'think', 'ask', 'party', 'sad', 'dance', 'sparkler', 'nap', 'zoomies', 'coffee', 'hearts'] as const)
    expect([prop, paintMini({ ...IDLE, prop, t: 0 }).join() !== paintMini({ ...IDLE, prop, t: 0.5 }).join()]).toEqual([prop, true])
})

test('every mini prop and hat shows', () => {
  const idle = paintMini(IDLE).join()
  for (const prop of ['type', 'read', 'search', 'web', 'shell', 'think', 'ask', 'party', 'sad', 'dance', 'sparkler', 'nap', 'zoomies', 'water', 'coffee', 'hearts'] as const)
    expect(paintMini({ ...IDLE, prop }).join()).not.toBe(idle)
  for (let hat = 1; hat <= 7; hat++) expect(countMini(paintMini({ ...IDLE, hat }), (_, gy, v) => gy < 0 && v !== 0)).toBeGreaterThan(0)
})

test('the body is shaded underneath and a shadow sits under its feet', () => {
  const px = paint(IDLE)
  expect(at(px, 6, 6)).toBe(C.EMBER) // the underside
  expect(at(px, 6, 1)).toBe(C.CLAY) // the top stays lit
  expect(at(px, 3, 9)).toBe(C.SHADOW) // between the legs, on the ground
  expect(at(paint({ ...IDLE, hop: 1 }), 3, 9)).toBe(C.SHADOW) // the shadow stays down when it hops
})

test('white mini props are edged so they show on a light terminal', () => {
  const px = paintMini({ ...IDLE, prop: 'water', arm: 'holding' })
  // the bottle's white shoulder at (13, 1) has nothing to its left, so that pixel is its edge
  expect(atMini(px, 13, 0)).toBe(C.STONE)
})

const frames = (pose: Partial<Pose>) => new Set(Array.from({ length: 48 }, (_, i) => paintMini({ ...IDLE, ...pose, t: i / 8 }).join())).size

test('every work flow plays at least four different frames', () => {
  for (const prop of ['type', 'read', 'search', 'web', 'shell', 'think', 'ask'] as const) expect([prop, frames({ prop }) >= 4]).toEqual([prop, true])
})

test('a new act arrives in a puff, then the prop', () => {
  const puff = paintMini({ ...IDLE, prop: 'shell', enter: 0.2, from: 'none' })
  const done = paintMini({ ...IDLE, prop: 'shell', enter: 1 })
  expect(puff.join()).not.toBe(done.join())
  expect(atMini(done, 15, 2)).toBe(C.NIGHT)
  expect(atMini(puff, 15, 2)).not.toBe(C.NIGHT)
  expect(countMini(puff, (gx, gy, v) => gx >= 13 && gy <= 5 && (v === C.PAPER || v === C.STONE))).toBeGreaterThan(0)
})

test('the critter is a flat clay block with square eyes, side arms and four legs', () => {
  const px = paintMini({ ...IDLE, still: true })
  for (const [x, y] of [[2, 0], [9, 0], [2, 5], [9, 5], [5, 3]] as const) expect(atMini(px, x, y)).toBe(C.CLAY)
  expect([atMini(px, 3, 1), atMini(px, 8, 1), atMini(px, 4, 1)]).toEqual([C.INK, C.INK, C.CLAY])
  for (const [x, y] of [[0, 2], [1, 3], [10, 2], [11, 3]] as const) expect(atMini(px, x, y)).toBe(C.CLAY)
  expect([atMini(px, 0, 1), atMini(px, 0, 4), atMini(px, 1, 0)]).toEqual([0, 0, 0])
  for (const x of [2, 4, 7, 9]) expect([atMini(px, x, 6), atMini(px, x, 7)]).toEqual([C.CLAY, C.CLAY])
  for (const x of [3, 5, 6, 8]) expect(atMini(px, x, 6)).toBe(0)
})

test('walking, it lifts one pair of legs, then the other; a hop lifts it all', () => {
  const a = paintMini({ ...IDLE, stride: 0 })
  const b = paintMini({ ...IDLE, stride: 1 })
  expect([atMini(a, 2, 7), atMini(a, 4, 7)]).toEqual([C.CLAY, C.SHADOW])
  expect([atMini(b, 2, 7), atMini(b, 4, 7)]).toEqual([C.SHADOW, C.CLAY])
  const hop = paintMini({ ...IDLE, hop: 1 })
  expect(atMini(hop, 5, -1)).toBe(C.CLAY)
  expect(atMini(hop, 5, 7)).toBe(C.SHADOW) // the shadow stays on the ground
})

test('happy eyes are carets', () => {
  const px = paintMini({ ...IDLE, eyes: 'happy' })
  expect([atMini(px, 2, 1), atMini(px, 3, 0), atMini(px, 4, 1)]).toEqual([C.INK, C.INK, C.INK])
})

test('the wizard hat has a lilac band and a gold star', () => {
  const px = paintMini({ ...IDLE, hat: 3 })
  expect(atMini(px, 5, -2)).toBe(C.LILAC)
  expect(countMini(px, (_, gy, v) => gy < -2 && v === C.GOLD)).toBeGreaterThan(2)
  expect([atMini(px, 1, -1), atMini(px, 10, -1)]).toEqual([C.PURPLE, C.PURPLE])
})

const body = (pose: Partial<Pose>) => paintMini({ ...IDLE, ...pose }, 'body')
const where = (px: Uint8Array, color: number) => {
  const at: string[] = []
  for (let r = 0; r < MINI.h; r++) for (let c = 0; c < MINI.w; c++) if (px[r * MINI.w + c] === color) at.push(`${MINI.col0 + c},${MINI.row0 + r}`)
  return at.join(' ')
}

test('standing still it looks about, and only then', () => {
  expect(frames({ still: true })).toBeGreaterThan(1)
  expect(frames({ still: false })).toBe(1)
})

test('no act ever covers its body or face', () => {
  for (const prop of ['type', 'read', 'search', 'web', 'think', 'dance', 'shell', 'water', 'coffee', 'sparkler', 'ask', 'sad'] as const)
    for (let i = 0; i < 24; i++) {
      const px = body({ prop, t: i / 8, eyes: prop === 'dance' ? 'happy' : 'open', dancing: prop === 'dance' })
      for (let y = 0; y <= 5; y++)
        for (let x = 2; x <= 9; x++) {
          const v = atMini(px, x, y)!
          const ok = v === C.CLAY || v === C.INK || (prop === 'read' && v === C.GOLD) // reading glasses
          if (!ok) expect([prop, i, x, y, v]).toEqual([prop, i, x, y, C.CLAY])
        }
    }
})

test('typing sits at a laptop: code on its screen, keys lighting under its hand', () => {
  const px = paintMini({ ...IDLE, prop: 'type', t: 0.5 })
  expect(where(px, C.NIGHT)).not.toBe('')
  const keys = new Set(Array.from({ length: 16 }, (_, i) => where(paintMini({ ...IDLE, prop: 'type', t: i / 8 }), C.GOLD)))
  expect(keys.size).toBeGreaterThan(1)
  expect(new Set(Array.from({ length: 24 }, (_, i) => where(paintMini({ ...IDLE, prop: 'type', t: i / 8 }), C.SKY))).size).toBeGreaterThan(3) // the code grows
})

test('reading has a book open on a stand beside it, a page turning across it', () => {
  const px = paintMini({ ...IDLE, prop: 'read' })
  expect(where(px, C.NIGHT)).toBe('') // no screen: it is not the laptop
  expect(countMini(px, (gx, _, v) => gx >= 13 && v === C.PAPER)).toBeGreaterThan(20)
  expect(countMini(px, (gx, gy, v) => gx >= 17 && gy >= 4 && v === C.EMBER)).toBeGreaterThan(2) // the stand
  const pages = new Set(Array.from({ length: 40 }, (_, i) => where(paintMini({ ...IDLE, prop: 'read', t: i / 8 }), C.PAPER)))
  expect(pages.size).toBeGreaterThan(5)
})

test('searching slides files past its lens until one matches', () => {
  const xs = (t: number) => where(paintMini({ ...IDLE, prop: 'search', t }), C.PAPER)
  expect(xs(0)).not.toBe(xs(0.25))
  const found = Array.from({ length: 48 }, (_, i) => paintMini({ ...IDLE, prop: 'search', t: i / 8 })).some(px => countMini(px, (gx, gy, v) => gx >= 13 && gy < 2 && v === C.LEAF) > 0)
  expect(found).toBe(true)
})

test('the web turns a globe beside it and sends packets to it', () => {
  const land = (t: number) => where(paintMini({ ...IDLE, prop: 'web', t }), C.LEAF)
  expect(land(0)).not.toBe('')
  expect(land(0)).not.toBe(land(0.5))
  expect(atMini(paintMini({ ...IDLE, prop: 'web', still: true }), 4, 7)).toBe(C.CLAY) // standing on its own legs, no cloud
})

test('thinking fills a big bubble to its side: gears, then dots, then a bulb', () => {
  const at = (t: number) => paintMini({ ...IDLE, prop: 'think', t })
  expect(countMini(at(0), (gx, _, v) => gx >= 17 && v === C.PAPER)).toBeGreaterThan(30)
  expect(countMini(at(4), (gx, _, v) => gx >= 17 && v === C.GOLD)).toBeGreaterThan(4) // the bulb
  expect(where(at(0), C.STONE)).not.toBe(where(at(0.25), C.STONE)) // the gears turn
})

test('its eyes follow the work', () => {
  expect(atMini(paintMini(IDLE), 4, 1)).toBe(C.CLAY)
  expect(atMini(paintMini({ ...IDLE, prop: 'type' }), 4, 1)).toBe(C.INK)
  expect(atMini(paintMini({ ...IDLE, prop: 'think' }), 4, 0)).toBe(C.INK)
})

test('dancing, its arms swing and the floor lights up; it bobs without changing shape', () => {
  const a = body({ prop: 'dance', dancing: true, t: 0 })
  const b = body({ prop: 'dance', dancing: true, t: 0.4 })
  expect(where(a, C.CLAY)).not.toBe(where(b, C.CLAY))
  expect(countMini(paintMini({ ...IDLE, prop: 'dance', dancing: true }, 'ground'), (_, gy, v) => gy === 7 && v !== C.SHADOW && v !== 0)).toBeGreaterThan(2)
  expect(miniLift({ ...IDLE, prop: 'dance', dancing: true, t: 0 })).not.toBe(miniLift({ ...IDLE, prop: 'dance', dancing: true, t: 0.4 }))
})
