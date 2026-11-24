// The critter in a terminal: the painted grid turned into half-block cells, and the walk.
// Pure: no `$`, so all of it is tested directly.

import { ART, MINI, PALETTE, miniLift, paintMini } from './critter-art'
import type { Arm, Art, Eyes, Pose, Prop } from './critter-art'
import { light } from './light'

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
 * Half-row colours as Raster cells: `[codepoint, fg, bg]` per cell, ▀ with the top half as fg and the
 * bottom half as bg, ▄ when only the bottom is painted. DEFAULT_COLOR is a half with nothing on it.
 */
export function cellsFrom(colors: Uint32Array, laneCols: number, rows: number): Uint32Array {
  const out = new Uint32Array(Math.max(0, laneCols) * Math.max(0, rows) * 3)
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < laneCols; col++) {
      const hi = colors[row * 2 * laneCols + col]!
      const lo = colors[(row * 2 + 1) * laneCols + col]!
      // The glyph's ink is always a painted colour: an empty top half is the terminal's background
      // under ▄, never its text colour on top of ▀ (which most terminals draw white).
      const cell: [number, number, number] =
        hi === DEFAULT_COLOR && lo === DEFAULT_COLOR ? [SPACE, DEFAULT_COLOR, DEFAULT_COLOR] : hi === DEFAULT_COLOR ? [LOWER_HALF, lo, DEFAULT_COLOR] : [UPPER_HALF, hi, lo]
      out.set(cell, (row * laneCols + col) * 3)
    }
  return out
}

/** Half-row palette indexes as Raster cells, flat: each index its palette colour. */
export const cellsOf = (g: Uint8Array, laneCols: number, rows: number): Uint32Array => cellsFrom(Uint32Array.from(g, colorOf), laneCols, rows)

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

/** The side face shows from size 2 up; smaller, a pixel of it would cover too much. */
const depthAt = (per: number) => (per >= 2 ? 0.5 : 0)

/** A pose drawn for the terminal, as Raster cells, lit: bevelled, with a side face from size 2. */
export function render(look: Look, pose: Pose, laneCols: number, rows: number, x: number, flip: boolean): Uint32Array {
  const g = renderGrid(look, pose, laneCols, rows, x, flip)
  const lit = light(g, laneCols, rows * 2, look.scale, { depth: depthAt(look.scale) })
  const colors = new Uint32Array(lit.rgb.length)
  for (let i = 0; i < colors.length; i++) colors[i] = lit.alpha[i] === 0 ? DEFAULT_COLOR : lit.rgb[i]!
  return cellsFrom(colors, laneCols, rows)
}

/** Image pixels per terminal cell: the picture is exactly the lane's size, so the terminal never resamples it. */
export const CELL_PX_X = 4
export const CELL_PX_Y = 8

/**
 * A pose as RGBA for an Image over the whole lane. The picture is the lane's exact size in pixels, so
 * the terminal shows it without resampling; each painted pixel is one flat square block of
 * `scale * 4` image pixels, lit at painted resolution, so every pixel stays crisp. Clear where nothing
 * is painted. The bottom of the picture is the ground, so a hop or fall moves the critter by whole
 * painted pixels.
 */
export function picture(look: Look, pose: Pose, laneCols: number, rows: number, x: number, flip: boolean): { rgba: Uint8Array; width: number; height: number } {
  const { art, scale } = look
  const width = Math.max(1, laneCols) * CELL_PX_X
  const height = Math.max(1, rows) * CELL_PX_Y
  const pp = Math.max(1, Math.round(scale * CELL_PX_X)) // a painted pixel, square
  const left = Math.round(x * CELL_PX_X)
  // The painted blocks the picture covers: block `i0 + c` for column c, block `ny - 1 - r` up from the ground for row r.
  const i0 = Math.floor(-left / pp)
  const nx = Math.floor((width - 1 - left) / pp) - i0 + 1
  const ny = Math.floor((height - 1) / pp) + 1
  const mirror = Math.round(2 * art.mid) - 1
  const g = new Uint8Array(nx * ny)
  const lifted = look.lift === undefined ? 0 : Math.round(look.lift(pose))
  const ground = look.lift === undefined ? look.paint(pose) : look.paint(pose, 'ground')
  const body = look.lift === undefined ? null : look.paint(pose, 'body')
  const at = (px: Uint8Array, sx: number, sy: number) => (sx < 0 || sx >= art.w || sy < 0 || sy >= art.h ? 0 : px[sy * art.w + sx]!)
  for (let r = 0; r < ny; r++) {
    const up = ny - 1 - r
    for (let c = 0; c < nx; c++) {
      const pi = c + i0
      const sx = flip ? mirror - pi : pi
      let v = at(ground, sx, art.h - 1 - up)
      if (body !== null) {
        const b = at(body, sx, art.h - 1 - (up - lifted))
        if (b !== 0) v = b
      }
      g[r * nx + c] = v
    }
  }
  const lit = light(g, nx, ny, 1, { depth: 1, soft: true })
  const rgba = new Uint8Array(width * height * 4)
  for (let v = 0; v < height; v++) {
    const up = Math.floor((height - 1 - v) / pp)
    const r = ny - 1 - up
    for (let u = 0; u < width; u++) {
      const c = Math.floor((u - left) / pp) - i0
      if (r < 0 || c < 0 || c >= nx) continue
      const k = r * nx + c
      const a = lit.alpha[k]!
      if (a === 0) continue
      const col = lit.rgb[k]!
      const o = (v * width + u) * 4
      rgba[o] = (col >> 16) & 255
      rgba[o + 1] = (col >> 8) & 255
      rgba[o + 2] = col & 255
      rgba[o + 3] = a
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
  /** Columns from its left edge to the middle of its body, the same either way it faces; 0 when left out. */
  center?: number
  /** How many pixels it can be lifted and still show whole in the strip; 0 when left out. */
  headroom?: number
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
// Picked up and thrown. Heights are in painted pixels, across in columns, time in seconds.
const GRAVITY = 90 // pixels a second, every second
const BOUNCE_FROM = 12 // a landing faster than this bounces
const BOUNCE = 0.38 // how much of its speed a bounce keeps
const HARD_LANDING = 40 // a landing faster than this leaves it dizzy
const DIZZY_MS = 1600
const WALL = 0.55 // how much of its speed it keeps off the lane's ends
const SLIDE = 7 // how fast a slide along the ground stops
const MAX_THROW_X = 140
const MAX_THROW_UP = 55
const DRAG_FROM = 1 // columns, or pixels up, the pointer moves before a press becomes a pick-up
const THROW_WINDOW_MS = 120 // how far back the throw's speed is measured
// The pointer near it.
const HOVER_MS = 2500 // with no word from the pointer this long, it stops looking
const RUB_MS = 1200 // three turns of the pointer over it within this are a pet
const LOOK_FROM = 2 // pixels off its middle before it looks to one side

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
  // Off the ground: 'held' by the pointer, or 'flying' after a throw or a drop.
  mode: 'ground' | 'held' | 'flying' = 'ground'
  /** Painted pixels off the ground. */
  air = 0
  private vx = 0
  private vy = 0
  private lastStep: number | null = null
  private dizzyUntil = 0
  private right = 0
  private headroom = 0
  private pressed: { col: number; up: number; dx: number; dAir: number } | null = null
  private trail: { t: number; x: number; air: number }[] = []
  private hovered: { col: number; up: number; at: number } | null = null
  private rub: { dir: number; at: number[] } = { dir: 0, at: [] }

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

  /** Pressed: on its body, a pet, and the start of a pick-up should the pointer move. False when it missed. */
  press(now: number, col: number, up: number, onBody: boolean): boolean {
    if (!onBody) return false
    this.pet(now)
    this.pressed = { col, up, dx: this.x - col, dAir: this.air - up }
    return true
  }

  /** The pointer moved with the button down: past a little way, it is picked up and follows. */
  drag(now: number, col: number, up: number) {
    const p = this.pressed
    if (p === null) return
    if (this.mode !== 'held') {
      if (Math.abs(col - p.col) < DRAG_FROM && Math.abs(up - p.up) < DRAG_FROM) return
      this.mode = 'held'
      this.petUntil = 0
      this.hopUntil = 0
      this.trail = []
      p.dAir += 1 // a little up off its feet as it is lifted
    }
    this.poke(now)
    const was = this.x
    this.x = Math.max(0, Math.min(this.right, col + p.dx))
    this.air = Math.max(0, Math.min(this.headroom + 4, up + p.dAir))
    if (Math.abs(this.x - was) > 0.3) this.facing = this.x > was ? 1 : -1
    this.trail.push({ t: now, x: this.x, air: this.air })
    while (this.trail.length > 2 && now - this.trail[0]!.t > THROW_WINDOW_MS) this.trail.shift()
  }

  /** The button came up: a held critter is thrown with the pointer's last speed; a tap was only a pet. */
  release(now: number) {
    this.pressed = null
    if (this.mode !== 'held') return
    const first = this.trail[0]
    const dt = first === undefined ? 0 : (now - first.t) / 1000
    this.vx = dt > 0.01 ? Math.max(-MAX_THROW_X, Math.min(MAX_THROW_X, (this.x - first!.x) / dt)) : 0
    this.vy = dt > 0.01 ? Math.max(-MAX_THROW_UP, Math.min(MAX_THROW_UP, (this.air - first!.air) / dt)) : 0
    this.mode = 'flying'
    this.lastStep = now
    this.trail = []
    this.poke(now)
  }

  /** Whether a press on it is still down. */
  get isPressed() {
    return this.pressed !== null
  }

  /** Whether it is moving on its own clock rather than walking: held, flying or sliding. */
  get lively() {
    return this.mode !== 'ground' || this.vx !== 0
  }

  /**
   * The pointer moved over the strip with no button down: `col` the lane column, `up` pixels above the
   * ground. Over its body it stops to look; rubbed back and forth, it is petted. True when that pets it.
   */
  hover(now: number, col: number, up: number, onBody: boolean): boolean {
    const last = this.hovered
    this.hovered = { col, up, at: now }
    if (!onBody) {
      this.rub = { dir: 0, at: [] }
      return false
    }
    if (!this.sleeping) this.restUntil = Math.max(this.restUntil, now + 800)
    if (last === null || col === last.col) return false
    const dir = Math.sign(col - last.col)
    if (this.rub.dir !== 0 && dir !== this.rub.dir) this.rub.at.push(now)
    this.rub.dir = dir
    this.rub.at = this.rub.at.filter(t => now - t < RUB_MS)
    if (this.rub.at.length < 3) return false
    this.rub = { dir: 0, at: [] }
    this.pet(now)
    return true
  }

  /** The pointer left the strip. */
  unhover() {
    this.hovered = null
    this.rub = { dir: 0, at: [] }
  }

  /** Off the ground or sliding: gravity, bounces, the lane's ends, and dizzy after a hard landing. */
  private fly(now: number) {
    const dt = this.lastStep === null ? 0 : Math.min(0.1, Math.max(0, (now - this.lastStep) / 1000))
    if (this.mode === 'flying') {
      this.vy -= GRAVITY * dt
      this.air += this.vy * dt
      if (this.air <= 0) {
        this.air = 0
        const impact = -this.vy
        if (impact > HARD_LANDING) this.dizzyUntil = now + DIZZY_MS
        if (impact > BOUNCE_FROM) this.vy = impact * BOUNCE
        else {
          this.vy = 0
          this.mode = 'ground'
          this.restUntil = now + 700
        }
      }
    } else this.vx *= Math.exp(-SLIDE * dt)
    this.x += this.vx * dt
    if (this.x <= 0 || this.x >= this.right) {
      this.x = Math.max(0, Math.min(this.right, this.x))
      this.vx = -this.vx * WALL
    }
    if (Math.abs(this.vx) > 3) this.facing = this.vx > 0 ? 1 : -1
    if (this.mode === 'ground' && Math.abs(this.vx) < 2) {
      this.vx = 0
      this.x = Math.round(this.x)
    }
  }

  /** Catch up without moving: asleep or not by now, and inside a lane that may have shrunk. */
  settle(input: WalkInput) {
    const { now } = input
    this.right = Math.max(0, input.laneCols - (input.sprite ?? SPRITE_COLS))
    this.headroom = Math.max(0, input.headroom ?? 0)
    this.x = Math.max(0, Math.min(this.right, this.x))
    if (this.lastEvent === null || input.busy || input.reminder !== 'none' || (input.trick !== 'none' && input.trick !== 'nap')) this.poke(now)
    this.sleeping = now - this.lastEvent! >= (input.night ? NIGHT_SLEEP_MS : SLEEP_MS)
  }

  step(input: WalkInput) {
    const { now, laneCols } = input
    const scale = input.scale ?? 1
    const right = Math.max(0, laneCols - (input.sprite ?? SPRITE_COLS))
    this.settle(input)
    if (this.hovered !== null && now - this.hovered.at > HOVER_MS) this.unhover()
    if (this.lively) {
      this.fly(now)
      this.lastStep = now
      return
    }
    this.lastStep = now
    if (now < this.dizzyUntil) return
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
    const held = this.mode === 'held'
    const dizzy = now < this.dizzyUntil
    const prop: Prop = held || dizzy
      ? 'none'
      : petting
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
    const eyes: Eyes = dizzy
      ? 'crossed'
      : this.sleeping || prop === 'nap'
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
    const still = now - this.movedAt >= STILL_MS && !this.lively
    // Its eyes follow the pointer: to one side past a couple of pixels off its middle, up when above its head.
    let look: [number, number] | undefined
    if (this.hovered !== null && !this.sleeping) {
      const scale = input.scale ?? 1
      const off = (this.hovered.col - this.x - (input.center ?? 0)) / scale
      const side = Math.abs(off) < LOOK_FROM ? 0 : Math.sign(off) * this.facing
      look = [side, this.hovered.up - this.air > 9 ? -1 : 0]
    }
    return {
      stride: this.stride,
      dancing: prop === 'dance',
      eyes,
      arm,
      hop: held || this.mode === 'flying' ? 0 : hop,
      prop,
      hat,
      t: now / 1000,
      enter,
      from: this.fromProp,
      still,
      air: this.air,
      held,
      dizzy,
      look,
    }
  }
}
