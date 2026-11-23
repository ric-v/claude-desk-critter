// The critter in a terminal: the painted grid turned into half-block cells, and the walk.
// Pure: no `$`, so all of it is tested directly.

import { ART, PALETTE } from './critter-art'
import type { Arm, Eyes, Pose, Prop } from './critter-art'

/** The terminal's own colour, for a half with nothing painted on it. */
export const DEFAULT_COLOR = 0x01000000
/** The whole canvas, two pixel rows to a cell. */
export const STRIP_ROWS = ART.h / 2
/** The bottom rows that hold the body and legs; with fewer, the strip shows only the caption. */
export const BODY_ROWS = 5
/** How many columns the painted canvas spans. */
export const SPRITE_COLS = ART.w

/** The four sizes `/critter size` picks from: how many columns (and half-rows) each pixel takes. */
export const SIZES = [1 / 3, 13 / 18, 10 / 9, 1.5] as const
/** How wide, how tall, and how tall its body (the bottom 10 pixel rows) is at a scale. */
export const spriteCols = (scale: number) => Math.ceil(ART.w * scale)
export const stripRows = (scale: number) => Math.ceil((ART.h * scale) / 2)
export const bodyRows = (scale: number) => Math.max(1, Math.ceil((BODY_PX * scale) / 2))

const BODY_PX = 10
const SPACE = 0x20
const UPPER_HALF = 0x2580
// Quarter blocks by which quarters are filled: 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right.
const QUARTERS = [0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588]
// Below this scale a half block would lose the one-pixel eyes, so cells split into quarters instead.
const QUARTER_BELOW = 0.7
// Mirroring about the body's centre (grid x 6.5) keeps the body in its columns.
const MIRROR = 2 * (0 - ART.col0) + 13

/**
 * The colour a region of the painting reads as, at any scale. Detail wins: a prop's or an eye's
 * colour covering 30% of the region shows over the body; otherwise the body shows where it covers half.
 */
function sample(px: Uint8Array, x0: number, x1: number, y0: number, y1: number): number {
  const area = (x1 - x0) * (y1 - y0)
  const weight = new Map<number, number>()
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(ART.h, Math.ceil(y1)); y++) {
    const h = Math.min(y1, y + 1) - Math.max(y0, y)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(ART.w, Math.ceil(x1)); x++) {
      const v = px[y * ART.w + x]!
      if (v === 0) continue
      weight.set(v, (weight.get(v) ?? 0) + h * (Math.min(x1, x + 1) - Math.max(x0, x)))
    }
  }
  let accent = 0
  let accentW = 0
  for (const [v, w] of weight) if (v !== 1 && w > accentW) [accent, accentW] = [v, w]
  const clayW = weight.get(1) ?? 0
  if (accentW >= 0.3 * area) return accent
  if (clayW + accentW >= 0.5 * area) return clayW >= accentW ? 1 : accent
  return 0
}

const colorOf = (v: number) => (v === 0 ? DEFAULT_COLOR : PALETTE[v]!)

/** Four quarters' colours as one cell: the two that matter most, the rest folded into them. */
function quarterCell(q: number[]): [number, number, number] {
  const count = new Map<number, number>()
  for (const v of q) count.set(v, (count.get(v) ?? 0) + 1)
  if (count.size === 1) return q[0] === 0 ? [SPACE, DEFAULT_COLOR, DEFAULT_COLOR] : [QUARTERS[15]!, colorOf(q[0]!), DEFAULT_COLOR]
  // Details (anything but body and nothing) first, so a lone eye survives; then the commonest.
  const rank = [...count.entries()].sort((a, b) => Number(b[0] > 1) - Number(a[0] > 1) || b[1] - a[1])
  let fg = rank[0]![0]
  let bg = rank[1]![0]
  if (fg === 0) [fg, bg] = [bg, fg] // nothing is the background, never the ink
  let bits = 0
  q.forEach((v, i) => {
    if (v === fg || (v !== bg && bg === 0)) bits |= 1 << i
  })
  return [QUARTERS[bits]!, colorOf(fg), colorOf(bg)]
}

/**
 * The bottom `rows` cell rows of the painted canvas, its left edge at lane column `x`, as Raster
 * cells: `[codepoint, fg, bg]` per cell. At `scale` each pixel takes that many columns and half-rows.
 * From 0.7 up a cell is ▀ with the top half as fg and the bottom half as bg; below, a quarter block.
 */
export function encode(px: Uint8Array, laneCols: number, rows: number, x: number, flip: boolean, scale = 1): Uint32Array {
  const out = new Uint32Array(Math.max(0, laneCols) * Math.max(0, rows) * 3)
  const quarters = scale < QUARTER_BELOW
  // Pixel-space ranges for a slice of a cell: half-rows counted up from the strip's bottom edge.
  const ys = (row: number, half: number): [number, number] => {
    const fromBottom = (rows - row) * 2 - half // half-rows from the bottom to this half's bottom edge, plus one
    return [ART.h - fromBottom / scale, ART.h - (fromBottom - 1) / scale]
  }
  const xs = (c: number, from: number, to: number): [number, number] => {
    const a = (c + from) / scale
    const b = (c + to) / scale
    return flip ? [MIRROR - b, MIRROR - a] : [a, b]
  }
  for (let row = 0; row < rows; row++) {
    const top = ys(row, 0)
    const bottom = ys(row, 1)
    for (let col = 0; col < laneCols; col++) {
      const c = col - x
      const i = (row * laneCols + col) * 3
      if (quarters) {
        const l = xs(c, 0, 0.5)
        const r = xs(c, 0.5, 1)
        out.set(quarterCell([sample(px, ...l, ...top), sample(px, ...r, ...top), sample(px, ...l, ...bottom), sample(px, ...r, ...bottom)]), i)
      } else {
        const whole = xs(c, 0, 1)
        const hi = sample(px, ...whole, ...top)
        const lo = sample(px, ...whole, ...bottom)
        out.set(hi === 0 && lo === 0 ? [SPACE, DEFAULT_COLOR, DEFAULT_COLOR] : [UPPER_HALF, colorOf(hi), colorOf(lo)], i)
      }
    }
  }
  return out
}

export type WalkInput = {
  now: number
  laneCols: number
  busy: boolean
  night: boolean
  trick: Prop
  reminder: 'none' | 'water' | 'rest'
  zoom: boolean
  /** Columns (and half-rows) per pixel; 1 when left out. */
  scale?: number
}

const WALK = 0.5 // columns a tick
const SLEEP_MS = 180_000
const NIGHT_SLEEP_MS = 45_000
const PET_MS = 1500
const HOP_MS = 400
const REST_CHANCE = 1 / 40 // a tick's chance of stopping for a rest
const BLINK_EVERY_MS = 4300
const BLINK_MS = 150

/** mulberry32: a small seeded random, so tests walk the same way every time. */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Where the critter is in its lane and what it is up to, one tick at a time. Kept for the session only. */
export class Walker {
  x = 0
  facing: 1 | -1 = 1
  sleeping = false
  private stride: 0 | 1 = 0
  private progress = 0
  private restUntil = 0
  private lastEvent: number | null = null
  private petUntil = 0
  private hopUntil = 0
  private readonly rand: () => number

  constructor(seed = Date.now()) {
    this.rand = random(seed)
  }

  /** Something happened: wake up and start the idle clock again. */
  poke(now: number) {
    this.lastEvent = now
    this.sleeping = false
  }

  /** Clicked: hearts and a hop. */
  pet(now: number) {
    this.poke(now)
    this.petUntil = now + PET_MS
    this.hopUntil = now + HOP_MS
  }

  /** Catch up without moving: asleep or not by now, and inside a lane that may have shrunk. */
  settle(input: WalkInput) {
    const { now } = input
    this.x = Math.max(0, Math.min(Math.max(0, input.laneCols - spriteCols(input.scale ?? 1)), this.x))
    if (this.lastEvent === null || input.busy || input.reminder !== 'none' || (input.trick !== 'none' && input.trick !== 'nap')) this.poke(now)
    this.sleeping = now - this.lastEvent! >= (input.night ? NIGHT_SLEEP_MS : SLEEP_MS)
  }

  step(input: WalkInput) {
    const { now, laneCols } = input
    const scale = input.scale ?? 1
    const right = Math.max(0, laneCols - spriteCols(scale))
    this.settle(input)
    if (this.sleeping || input.busy || now < this.petUntil) return
    const zoom = input.zoom || input.trick === 'zoomies'
    if (input.trick !== 'none' && !zoom) return

    let speed = WALK * scale * (zoom ? 3 : 1) * (input.night ? 0.5 : 1)
    if (input.reminder !== 'none') {
      const mid = Math.floor(right / 2)
      if (this.x === mid) return
      this.facing = mid > this.x ? 1 : -1
      speed = WALK * scale
    } else {
      if (now < this.restUntil) return
      if (!zoom && this.rand() < REST_CHANCE) {
        this.restUntil = now + 2000 + this.rand() * 4000
        return
      }
      if (this.x >= right) this.facing = -1
      else if (this.x <= 0) this.facing = 1
    }
    this.progress += speed
    while (this.progress >= 1) {
      this.progress -= 1
      this.x = Math.max(0, Math.min(right, this.x + this.facing))
      this.stride = this.stride ? 0 : 1
      if (input.reminder !== 'none' && this.x === Math.floor(right / 2)) break
    }
  }

  /** The frame to paint now. `act` is what Claude is doing ('none' when idle); `feel` is +1 party, -1 sad. */
  pose(input: WalkInput, act: Prop, feel: number, asking: boolean, hat: number): Pose {
    const { now } = input
    const petting = now < this.petUntil
    const prop: Prop = petting
      ? 'hearts'
      : asking
        ? 'ask'
        : feel > 0
          ? 'party'
          : feel < 0
            ? 'sad'
            : input.trick !== 'none'
              ? input.trick
              : input.reminder === 'water'
                ? 'water'
                : input.reminder === 'rest'
                  ? 'coffee'
                  : act !== 'none'
                    ? act
                    : this.sleeping
                      ? 'nap'
                      : 'none'
    const eyes: Eyes =
      this.sleeping || prop === 'nap'
        ? 'shut'
        : prop === 'party' || prop === 'dance' || prop === 'hearts'
          ? 'happy'
          : input.night
            ? 'lidded'
            : now % BLINK_EVERY_MS < BLINK_MS
              ? 'blink'
              : 'open'
    const arm: Arm =
      prop === 'ask' || prop === 'wave'
        ? 'wave'
        : prop === 'type' || prop === 'shell' || prop === 'sparkler' || prop === 'water' || prop === 'coffee'
          ? 'holding'
          : 'rest'
    const hop: 0 | 1 = now < this.hopUntil || (prop === 'jump' && Math.floor(now / 250) % 2 === 1) ? 1 : 0
    return { stride: this.stride, dancing: prop === 'dance', eyes, arm, hop, prop, hat, t: now / 1000 }
  }
}
