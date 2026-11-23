// The critter in a terminal: the painted grid turned into half-block cells, and the walk.
// Pure: no `$`, so all of it is tested directly.

import { ART, MINI, PALETTE, paint, paintMini } from './critter-art'
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
export type Look = { art: Art; scale: number; paint: (pose: Pose) => Uint8Array }
/**
 * The four sizes `/critter size` picks from: the hand-drawn mini critter, then the full one at 0.72, 1
 * and 1.5. Scales between whole numbers smear one-pixel eyes, so size 3 is exactly 1, not 1.11.
 */
export const SIZES: readonly Look[] = [
  { art: MINI, scale: 1, paint: paintMini },
  { art: ART, scale: 13 / 18, paint },
  { art: ART, scale: 1, paint },
  { art: ART, scale: 1.5, paint },
]
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
 * The bottom `rows` cell rows of a painting, its left edge at lane column `x`, as Raster cells:
 * `[codepoint, fg, bg]` per cell, ▀ with the top half as fg and the bottom half as bg (▄ when only the bottom is painted). At `scale`
 * each pixel takes that many columns and half-rows. Mirrored about the body, so it keeps its columns.
 */
export function encode(px: Uint8Array, laneCols: number, rows: number, x: number, flip: boolean, scale = 1, art: Art = ART): Uint32Array {
  const out = new Uint32Array(Math.max(0, laneCols) * Math.max(0, rows) * 3)
  const mirror = 2 * art.mid
  // Pixel-space rows for one half of a cell row, counted up from the strip's bottom edge.
  const ys = (row: number, half: number): [number, number] => {
    const fromBottom = (rows - row) * 2 - half
    return [art.h - fromBottom / scale, art.h - (fromBottom - 1) / scale]
  }
  for (let row = 0; row < rows; row++) {
    const top = ys(row, 0)
    const bottom = ys(row, 1)
    for (let col = 0; col < laneCols; col++) {
      const a = (col - x) / scale
      const b = (col - x + 1) / scale
      const [x0, x1] = flip ? [mirror - b, mirror - a] : [a, b]
      const hi = sample(px, art, x0, x1, ...top)
      const lo = sample(px, art, x0, x1, ...bottom)
      // The glyph's ink is always a painted colour: an empty top half is the terminal's background
      // under ▄, never its text colour on top of ▀ (which most terminals draw white).
      const cellOf: [number, number, number] =
        hi === 0 && lo === 0 ? [SPACE, DEFAULT_COLOR, DEFAULT_COLOR] : hi === 0 ? [LOWER_HALF, colorOf(lo), DEFAULT_COLOR] : [UPPER_HALF, colorOf(hi), colorOf(lo)]
      out.set(cellOf, (row * laneCols + col) * 3)
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
  /** How many columns the painting spans; the full critter at 1x when left out. */
  sprite?: number
  /** Columns per pixel, for the walking speed; 1 when left out. */
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
    this.x = Math.max(0, Math.min(Math.max(0, input.laneCols - (input.sprite ?? SPRITE_COLS)), this.x))
    if (this.lastEvent === null || input.busy || input.reminder !== 'none' || (input.trick !== 'none' && input.trick !== 'nap')) this.poke(now)
    this.sleeping = now - this.lastEvent! >= (input.night ? NIGHT_SLEEP_MS : SLEEP_MS)
  }

  step(input: WalkInput) {
    const { now, laneCols } = input
    const scale = input.scale ?? 1
    const right = Math.max(0, laneCols - (input.sprite ?? SPRITE_COLS))
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
