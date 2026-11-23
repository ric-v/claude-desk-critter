// The critter in a terminal: the painted grid turned into half-block cells, and the walk.
// Pure: no `$`, so all of it is tested directly.

import { ART, MINI, PALETTE, miniLift, paintMini } from './critter-art'
import type { Arm, Art, Eyes, Pose, Prop } from './critter-art'

/** The terminal's own colour, for a half with nothing painted on it. */
export const DEFAULT_COLOR = 0x01000000
/** The whole canvas, two pixel rows to a cell. */
export const STRIP_ROWS = ART.h / 2
/** The bottom rows that hold the body and legs; with fewer, the strip shows only the caption. */
export const BODY_ROWS = 5
/** How many columns the painted canvas spans. */
export const SPRITE_COLS = ART.w

/** How a size draws: which painting, at how many columns (and half-rows) per pixel. */
export type Look = {
  art: Art
  scale: number
  paint: (pose: Pose, layer?: 'all' | 'ground' | 'body') => Uint8Array
  /** Pixels off the ground, moved by whole cells after painting so the critter keeps its shape. */
  lift?: (pose: Pose) => number
}
/**
 * The four sizes `/critter size` picks from: one critter, the hand-drawn mini one, at 1, 1.5, 2 and
 * 2.5 times, so every size has the same face, props and animations.
 */
export const SIZES: readonly Look[] = [1, 1.5, 2, 2.5].map(scale => ({ art: MINI, scale, paint: paintMini, lift: miniLift }))
/** Where the terminal shows real pictures: the same critter, drawn crisp at every scale. */
export const PICTURE_SIZES: readonly Look[] = SIZES
/** How wide, how tall, and how tall its body is, for a look. */
export const spriteCols = (look: Look) => Math.ceil(look.art.w * look.scale)
export const stripRows = (look: Look) => Math.ceil((look.art.h * look.scale) / 2)
export const bodyRows = (look: Look) => Math.max(1, Math.ceil((look.art.bodyPx * look.scale) / 2))

const SPACE = 0x20
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584

/**
 * The colour a region of the painting reads as, at any scale. Detail wins: a prop's or an eye's
 * colour covering 30% of the region shows over the body; otherwise the body shows where it covers half.
 */
function sample(px: Uint8Array, art: Art, x0: number, x1: number, y0: number, y1: number): number {
  const area = (x1 - x0) * (y1 - y0)
  const weight = new Map<number, number>()
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(art.h, Math.ceil(y1)); y++) {
    const h = Math.min(y1, y + 1) - Math.max(y0, y)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(art.w, Math.ceil(x1)); x++) {
      const v = px[y * art.w + x]!
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

/**
 * The bottom `rows` cell rows of a painting, its left edge at lane column `x`, as palette indexes, two
 * per cell row (top half, then bottom half): `laneCols` x `rows * 2`. At `scale` each pixel takes that
 * many columns and half-rows. Mirrored about the body, so it keeps its columns.
 */
export function grid(px: Uint8Array, laneCols: number, rows: number, x: number, flip: boolean, scale = 1, art: Art = ART): Uint8Array {
  const halves = Math.max(0, rows) * 2
  const cols = Math.max(0, laneCols)
  const out = new Uint8Array(cols * halves)
  const mirror = 2 * art.mid
  for (let h = 0; h < halves; h++) {
    const fromBottom = halves - h
    const y0 = art.h - fromBottom / scale
    const y1 = art.h - (fromBottom - 1) / scale
    for (let col = 0; col < cols; col++) {
      const a = (col - x) / scale
      const b = (col - x + 1) / scale
      const [x0, x1] = flip ? [mirror - b, mirror - a] : [a, b]
      out[h * cols + col] = sample(px, art, x0, x1, y0, y1)
    }
  }
  return out
}

/**
 * Half-row palette indexes as Raster cells: `[codepoint, fg, bg]` per cell, ▀ with the top half as fg
 * and the bottom half as bg, ▄ when only the bottom is painted.
 */
export function cellsOf(g: Uint8Array, laneCols: number, rows: number): Uint32Array {
  const out = new Uint32Array(Math.max(0, laneCols) * Math.max(0, rows) * 3)
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < laneCols; col++) {
      const hi = g[row * 2 * laneCols + col]!
      const lo = g[(row * 2 + 1) * laneCols + col]!
      // The glyph's ink is always a painted colour: an empty top half is the terminal's background
      // under ▄, never its text colour on top of ▀ (which most terminals draw white).
      const cell: [number, number, number] =
        hi === 0 && lo === 0 ? [SPACE, DEFAULT_COLOR, DEFAULT_COLOR] : hi === 0 ? [LOWER_HALF, colorOf(lo), DEFAULT_COLOR] : [UPPER_HALF, colorOf(hi), colorOf(lo)]
      out.set(cell, (row * laneCols + col) * 3)
    }
  return out
}

/** A painting as Raster cells: `grid`, then `cellsOf`. */
export function encode(px: Uint8Array, laneCols: number, rows: number, x: number, flip: boolean, scale = 1, art: Art = ART): Uint32Array {
  return cellsOf(grid(px, laneCols, rows, x, flip, scale, art), laneCols, rows)
}

/**
 * A pose drawn for the terminal, as half-row palette indexes. A look with a lift paints the ground and
 * the critter apart: the critter is scaled where it stands and then moved up by whole half-rows, so a
 * hop or a bob never reshapes it, however the pixels fall on the cells.
 */
export function renderGrid(look: Look, pose: Pose, laneCols: number, rows: number, x: number, flip: boolean): Uint8Array {
  if (look.lift === undefined) return grid(look.paint(pose), laneCols, rows, x, flip, look.scale, look.art)
  const ground = grid(look.paint(pose, 'ground'), laneCols, rows, x, flip, look.scale, look.art)
  const body = grid(look.paint(pose, 'body'), laneCols, rows, x, flip, look.scale, look.art)
  const k = Math.round(look.lift(pose) * look.scale)
  const halves = rows * 2
  for (let h = 0; h < halves; h++) {
    const from = h + k
    if (from >= halves) continue
    for (let c = 0; c < laneCols; c++) {
      const v = body[from * laneCols + c]!
      if (v !== 0) ground[h * laneCols + c] = v
    }
  }
  return ground
}

/** A pose drawn for the terminal, as Raster cells. */
export const render = (look: Look, pose: Pose, laneCols: number, rows: number, x: number, flip: boolean): Uint32Array =>
  cellsOf(renderGrid(look, pose, laneCols, rows, x, flip), laneCols, rows)

/** Image pixels to a painted pixel; fewer when the lane is so wide the picture would pass 2048 across. */
const PICTURE_PX = 3
const PICTURE_MAX = 2048

/**
 * The same frame as `encode`, as RGBA for an Image over the whole lane: each painted pixel a
 * square block, clear where nothing is painted. The terminal stretches it over `laneCols` x `rows`.
 */
export function picture(px: Uint8Array, laneCols: number, rows: number, x: number, flip: boolean, scale = 1, art: Art = ART): { rgba: Uint8Array; width: number; height: number } {
  const across = Math.max(1, Math.round(laneCols / scale))
  const down = Math.max(1, Math.round((rows * 2) / scale))
  const k = Math.max(1, Math.min(PICTURE_PX, Math.floor(PICTURE_MAX / across)))
  const width = across * k
  const height = down * k
  const rgba = new Uint8Array(width * height * 4)
  const left = Math.round(x / scale)
  const mirror = Math.round(2 * art.mid) - 1
  for (let ay = 0; ay < down; ay++) {
    const sy = art.h - down + ay
    if (sy < 0 || sy >= art.h) continue
    for (let ax = 0; ax < across; ax++) {
      const sx = flip ? mirror - (ax - left) : ax - left
      if (sx < 0 || sx >= art.w) continue
      const v = px[sy * art.w + sx]!
      if (v === 0) continue
      const c = PALETTE[v]!
      for (let dy = 0; dy < k; dy++)
        for (let dx = 0; dx < k; dx++) rgba.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], ((ay * k + dy) * width + ax * k + dx) * 4)
    }
  }
  return { rgba, width, height }
}

export type WalkInput = {
  now: number
  laneCols: number
  busy: boolean
  night: boolean
  trick: Prop
  reminder: 'none' | 'water' | 'rest'
  zoom: boolean
  /** How many columns the painting spans; the full critter at 1x when left out. */
  sprite?: number
  /** Columns per pixel, for the walking speed; 1 when left out. */
  scale?: number
  /** How far its props reach past its left edge when it faces left, in columns; 0 when left out. */
  reach?: number
}

const WALK = 0.5 // columns a tick
const SLEEP_MS = 180_000
const NIGHT_SLEEP_MS = 45_000
const PET_MS = 1500
const HOP_MS = 400
const REST_CHANCE = 1 / 40 // a tick's chance of stopping for a rest
const BLINK_EVERY_MS = 4300
const BLINK_MS = 150
const CHANGE_MS = 400 // a change of prop: the old one goes in a puff, the new one arrives in one
const STILL_MS = 500 // this long without a step and it is standing still: it breathes, it looks about

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
  private movedAt = -Infinity
  private lastProp: Prop = 'none'
  private fromProp: Prop = 'none'
  private propSince = -Infinity
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
    this.x = Math.max(0, Math.min(Math.max(0, input.laneCols - (input.sprite ?? SPRITE_COLS)), this.x))
    if (this.lastEvent === null || input.busy || input.reminder !== 'none' || (input.trick !== 'none' && input.trick !== 'nap')) this.poke(now)
    this.sleeping = now - this.lastEvent! >= (input.night ? NIGHT_SLEEP_MS : SLEEP_MS)
  }

  step(input: WalkInput) {
    const { now, laneCols } = input
    const scale = input.scale ?? 1
    const right = Math.max(0, laneCols - (input.sprite ?? SPRITE_COLS))
    this.settle(input)
    const zooming = input.zoom || input.trick === 'zoomies'
    if (input.busy || (input.trick !== 'none' && !zooming) || input.reminder !== 'none') {
      // At work, it faces the side with room for its props: right, unless it is far over and has the room on its left.
      this.facing = this.x >= (input.reach ?? 0) && this.x > right / 2 ? -1 : 1
    }
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
      const was = this.x
      this.x = Math.max(0, Math.min(right, this.x + this.facing))
      if (this.x !== was) this.movedAt = now
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
    if (prop !== this.lastProp) {
      this.fromProp = this.lastProp
      this.lastProp = prop
      this.propSince = now
    }
    const enter = Math.max(0, Math.min(1, (now - this.propSince) / CHANGE_MS))
    const still = now - this.movedAt >= STILL_MS
    return { stride: this.stride, dancing: prop === 'dance', eyes, arm, hop, prop, hat, t: now / 1000, enter, from: this.fromProp, still }
  }
}
