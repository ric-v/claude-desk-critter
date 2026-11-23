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

const SPACE = 0x20
const UPPER_HALF = 0x2580
// Mirroring about the body's centre (grid x 6.5) keeps the body in its columns.
const MIRROR = 2 * (0 - ART.col0) + 12

/**
 * The bottom `rows` cell rows of the painted canvas, its left edge at lane column `x`, as Raster
 * cells: `[codepoint, fg, bg]` per cell. A cell is ▀ with the top pixel as fg and the bottom one as bg.
 * At `scale` N each pixel takes N columns and N half-rows, so the critter keeps its shape.
 */
export function encode(px: Uint8Array, laneCols: number, rows: number, x: number, flip: boolean, scale = 1): Uint32Array {
  const out = new Uint32Array(Math.max(0, laneCols) * Math.max(0, rows) * 3)
  const top = ART.h * scale - rows * 2 // scaled half-row of the strip's first pixel row; negative pads above
  const pixel = (hr: number, cs: number) => {
    if (hr < 0) return 0
    const r = Math.floor(hr / scale)
    const c = Math.floor(cs / scale)
    if (r >= ART.h) return 0
    const src = flip ? MIRROR - c : c
    return src < 0 || src >= ART.w ? 0 : px[r * ART.w + src]!
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < laneCols; col++) {
      const c = col - x
      const hi = pixel(top + row * 2, c)
      const lo = pixel(top + row * 2 + 1, c)
      const i = (row * laneCols + col) * 3
      if (hi === 0 && lo === 0) out.set([SPACE, DEFAULT_COLOR, DEFAULT_COLOR], i)
      else out.set([UPPER_HALF, hi ? PALETTE[hi]! : DEFAULT_COLOR, lo ? PALETTE[lo]! : DEFAULT_COLOR], i)
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
    this.x = Math.max(0, Math.min(Math.max(0, input.laneCols - SPRITE_COLS * (input.scale ?? 1)), this.x))
    if (this.lastEvent === null || input.busy || input.reminder !== 'none' || (input.trick !== 'none' && input.trick !== 'nap')) this.poke(now)
    this.sleeping = now - this.lastEvent! >= (input.night ? NIGHT_SLEEP_MS : SLEEP_MS)
  }

  step(input: WalkInput) {
    const { now, laneCols } = input
    const scale = input.scale ?? 1
    const right = Math.max(0, laneCols - SPRITE_COLS * scale)
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
