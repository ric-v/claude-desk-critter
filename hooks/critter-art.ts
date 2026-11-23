// The critter painted on the CPU, for surfaces with no shader (the terminal).
// Same grid, same shapes, same colours as the art pass in critter-shader.ts: grid x grows right,
// grid y grows down, the top of its head is row 0, its feet stand on row 10. Each grid pixel is
// sampled at its centre, so a shape covers a pixel when it covers that pixel's middle.

/**
 * A painted canvas: grid columns col0..col0+w-1, rows row0..row0+h-1, its feet on the last row.
 * `mid` is the canvas x the body mirrors about, `bodyFrom`..`bodyTo` the canvas columns the body
 * spans, `bodyPx` how many bottom rows the body and legs take.
 */
export type Art = { col0: number; row0: number; w: number; h: number; mid: number; bodyFrom: number; bodyTo: number; bodyPx: number }

/** The full critter: the shader's own grid. */
export const ART = { col0: -6, row0: -10, w: 30, h: 20, mid: 12.5, bodyFrom: 6, bodyTo: 18, bodyPx: 10 } as const
/**
 * The mini critter, drawn by hand in the mascot's style: a flat 8 x 6 clay block, square eyes, 2 x 2
 * arms on its sides and four thin legs. Its props stand beside it, 16 pixels to its right; facing left
 * they mirror to its left, and at work it turns to face whichever side has the room.
 */
export const MINI = { col0: -4, row0: -6, w: 32, h: 14, mid: 10, bodyFrom: 4, bodyTo: 15, bodyPx: 8 } as const

const rgb = (r: number, g: number, b: number) => (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)

// The shader's colours, in the shader's order; index 0 is transparent.
export const PALETTE: readonly number[] = [
  0,
  rgb(0.851, 0.467, 0.341), // CLAY
  rgb(0.78, 0.38, 0.26), // EMBER
  rgb(0.118, 0.118, 0.114), // INK
  rgb(0.898, 0.282, 0.302), // ROSE
  rgb(0.985, 0.98, 0.965), // PAPER
  rgb(0.6, 0.59, 0.56), // STONE
  rgb(0.16, 0.16, 0.17), // NIGHT
  rgb(0.45, 0.82, 0.48), // LEAF
  rgb(0.62, 0.8, 0.95), // SKY
  rgb(0.93, 0.7, 0.29), // GOLD
  rgb(0.36, 0.55, 0.94), // BLUE
  rgb(0.42, 0.33, 0.72), // PURPLE
  rgb(0.46, 0.53, 0.78), // NIGHTCAP
  rgb(0.24, 0.23, 0.22), // SHADOW: the terminal's own, under its feet
  rgb(0.94, 0.62, 0.5), // LIGHT: where the light catches its top
  rgb(0.71, 0.62, 0.9), // LILAC: the wizard hat's band
]

/** Palette indexes by name. */
export const C = {
  CLAY: 1,
  EMBER: 2,
  INK: 3,
  ROSE: 4,
  PAPER: 5,
  STONE: 6,
  NIGHT: 7,
  LEAF: 8,
  SKY: 9,
  GOLD: 10,
  BLUE: 11,
  PURPLE: 12,
  NIGHTCAP: 13,
  SHADOW: 14,
  LIGHT: 15,
  LILAC: 16,
} as const

export type Eyes = 'open' | 'blink' | 'lidded' | 'shut' | 'happy' | 'crossed'
export type Arm = 'rest' | 'holding' | 'raised' | 'wave'
export type Prop =
  | 'none'
  | 'type'
  | 'read'
  | 'search'
  | 'web'
  | 'shell'
  | 'think'
  | 'ask'
  | 'party'
  | 'sad'
  | 'dance'
  | 'wave' // the arm alone: Arm 'wave'
  | 'jump' // the hop alone
  | 'sparkler'
  | 'nap'
  | 'zoomies'
  | 'water'
  | 'coffee'
  | 'hearts'
/** One frame of the critter. `t` is seconds, for the bits that move on their own (blinks, sparks, confetti). */
export type Pose = {
  stride: 0 | 1
  dancing: boolean
  eyes: Eyes
  arm: Arm
  hop: 0 | 1
  prop: Prop
  hat: number
  t: number
  /** How far into a change of prop, 0 to 1: a puff first, then the new prop. 1 when left out. */
  enter?: number
  /** The prop before the change, which goes in a puff of its own. */
  from?: Prop
  /** Standing still for a moment: it breathes and looks about. */
  still?: boolean
}

type Mask = (x: number, y: number) => boolean

/** Inside the grid box [x0,x1) x [y0,y1). */
const box =
  (x0: number, x1: number, y0: number, y1: number): Mask =>
  (x, y) =>
    x >= x0 && x < x1 && y >= y0 && y < y1
/** Inside a disc of radius r. */
const disc =
  (cx: number, cy: number, r: number): Mask =>
  (x, y) =>
    (x - cx) ** 2 + (y - cy) ** 2 <= r * r
/** Within `w` of the segment a-b. */
const segment =
  (ax: number, ay: number, bx: number, by: number, w: number): Mask =>
  (x, y) => {
    const dx = bx - ax
    const dy = by - ay
    const h = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(x - ax - dx * h, y - ay - dy * h) < w
  }
const any =
  (...masks: Mask[]): Mask =>
  (x, y) =>
    masks.some(m => m(x, y))
const minus =
  (a: Mask, b: Mask): Mask =>
  (x, y) =>
    a(x, y) && !b(x, y)

/** A canvas to paint masks onto, later layers over earlier ones. `lift` raises everything painted. */
class Canvas {
  readonly px = new Uint8Array(ART.w * ART.h)
  lift = 0
  fill(color: number, mask: Mask) {
    for (let r = 0; r < ART.h; r++) {
      const y = ART.row0 + r + 0.5 + this.lift
      for (let c = 0; c < ART.w; c++) if (mask(ART.col0 + c + 0.5, y)) this.px[r * ART.w + c] = color
    }
  }
}

/** Body, side nub, arm and legs. */
function critterMask(p: Pose): Mask {
  const legA = p.dancing ? 3 - (Math.floor(p.t * 2.5) % 2) : 3 - p.stride
  const legB = p.dancing ? 2 + (Math.floor(p.t * 2.5) % 2) : 2 + p.stride
  const tap = Math.floor(p.t * 6) % 2
  const wave = Math.floor(p.t * 2.5) % 2
  const rest = box(12, 13, 3, 5)
  const arm =
    p.arm === 'holding'
      ? any(box(12, 15, 4 + tap, 5 + tap), rest)
      : p.arm === 'raised'
        ? any(box(12, 13, -2, 1), box(12, 13, 0, 5))
        : p.arm === 'wave'
          ? any(box(12 + wave, 13 + wave, -2, 1), box(12, 13, 0, 5))
          : rest
  return any(
    box(1, 12, 0, 7),
    box(0, 1, 3, 5),
    arm,
    box(2, 3, 7, 7 + legA),
    box(8, 9, 7, 7 + legA),
    box(4, 5, 7, 7 + legB),
    box(10, 11, 7, 7 + legB),
  )
}

/** The eyes, for each state; the critter faces right, so it looks a little ahead. */
function eyesMask(eyes: Eyes): Mask {
  const ex = 0.2
  switch (eyes) {
    case 'happy':
      return any(box(3, 4, 2, 3), box(2, 3, 3, 4), box(4, 5, 3, 4), box(9, 10, 2, 3), box(8, 9, 3, 4), box(10, 11, 3, 4))
    case 'crossed':
      return any(
        box(2, 3, 2, 3),
        box(4, 5, 2, 3),
        box(3, 4, 3, 4),
        box(2, 3, 4, 5),
        box(4, 5, 4, 5),
        box(8, 9, 2, 3),
        box(10, 11, 2, 3),
        box(9, 10, 3, 4),
        box(8, 9, 4, 5),
        box(10, 11, 4, 5),
      )
    case 'lidded':
      return any(box(3 + ex, 4 + ex, 3, 4), box(9 + ex, 10 + ex, 3, 4))
    case 'blink':
    case 'shut':
      return any(box(2.5, 4.5, 3.2, 3.8), box(8.5, 10.5, 3.2, 3.8))
    default:
      return any(box(3 + ex, 4 + ex, 2, 4), box(9 + ex, 10 + ex, 2, 4))
  }
}

const fract = (v: number) => v - Math.floor(v)
/** A small pixel heart, 3 wide and 3 tall, its top-left at (x, y). */
const heart = (x: number, y: number): Mask =>
  any(box(x, x + 1, y, y + 2), box(x + 2, x + 3, y, y + 2), box(x + 1, x + 2, y + 1, y + 3))
/** A "z", 2 wide and 2 tall, its top-left at (x, y). */
const zed = (x: number, y: number): Mask => any(box(x, x + 2, y, y + 0.6), box(x, x + 2, y + 1.4, y + 2))

/** Behind the critter: the web cloud, the rain cloud, the thinking spark. */
function paintBehind(cv: Canvas, p: Pose) {
  if (p.prop === 'web') {
    // No lift in the terminal: the cloud sits around its feet.
    const up = 3.5
    cv.fill(C.STONE, any(disc(2.5, 11 - up, 2.6), disc(6.5, 10.4 - up, 3.3), disc(10.5, 11 - up, 2.6), box(1.6, 11.4, 11 - up, 13.4 - up)))
    cv.fill(C.PAPER, any(disc(2.5, 11 - up, 2.2), disc(6.5, 10.4 - up, 2.9), disc(10.5, 11 - up, 2.2), box(2, 11, 11 - up, 13 - up)))
  }
  if (p.prop === 'sad') {
    cv.fill(C.STONE, any(disc(4.5, -5, 1.8), disc(7, -5.8, 2.3), disc(9.5, -5, 1.8)))
    for (const i of [0, 1, 2]) {
      const fall = fract(p.t * 1.4 + i * 0.33)
      cv.fill(C.BLUE, box(4.5 + i * 2.2, 5.5 + i * 2.2, -3 + fall * 5, -2 + fall * 5))
    }
  }
  if (p.prop === 'think') {
    cv.fill(C.EMBER, (x, y) => {
      const dx = x - 6.5
      const dy = y + 4.2
      const r = Math.hypot(dx, dy)
      const spoke = Math.abs(fract(Math.atan2(dy, dx) / (Math.PI / 4) + p.t * 0.5) - 0.5)
      return r <= 2.6 && r >= 0.35 && spoke <= 0.16 * (1 - r / 2.6) + 0.12
    })
  }
}

/** What it holds or does in front of it. */
function paintProp(cv: Canvas, p: Pose, body: Mask) {
  const off = (m: Mask): Mask => (x, y) => m(x, y) && !body(x, y)
  switch (p.prop) {
    case 'type':
      cv.fill(C.STONE, any(box(13, 20, 9, 10), box(18.5, 20, 3.5, 9)))
      cv.fill(C.SKY, box(18.5, 19.5, 4, 8.5))
      break
    case 'shell': {
      cv.fill(C.NIGHT, box(13.5, 21, 3, 10))
      const cursor = fract(p.t * 1.2) >= 0.5 ? box(17, 19, 6.5, 7.5) : () => false
      cv.fill(C.LEAF, any(box(14.5, 15.5, 4.5, 5.5), box(15.5, 16.5, 5.5, 6.5), box(14.5, 15.5, 6.5, 7.5), cursor))
      break
    }
    case 'read':
      cv.fill(C.PAPER, box(3, 10, 5, 8.5))
      cv.fill(C.STONE, box(6, 7, 5, 8.5))
      cv.fill(C.INK, any(minus(disc(3.5, 3, 1.75), disc(3.5, 3, 1.25)), minus(disc(9.5, 3, 1.75), disc(9.5, 3, 1.25)), box(5.2, 7.8, 2.5, 3.2)))
      break
    case 'search': {
      const gx = 15.5 + Math.sin(p.t * 2.2) * 1.4
      const gy = 2.5
      cv.fill(C.SKY, disc(gx, gy, 1.7))
      cv.fill(C.INK, any(minus(disc(gx, gy, 2.3), disc(gx, gy, 1.7)), segment(gx - 1.4, gy + 1.6, 12.8, 6.5, 0.5)))
      break
    }
    case 'ask':
      cv.fill(C.CLAY, disc(6.5, -5.2, 3.6))
      cv.fill(C.PAPER, disc(6.5, -5.2, 3.1))
      cv.fill(C.INK, any(box(6, 7, -7.5, -4.5), box(6, 7, -4, -3)))
      break
    case 'dance':
      for (const i of [0, 1]) {
        const nx = i === 0 ? -2.5 : 15.5
        const ny = -3 + Math.sin(p.t * 3 + i * 2) * 1.2
        cv.fill(C.INK, off(any(disc(nx, ny + 2, 0.9), box(nx + 0.5, nx + 1.5, ny - 1.5, ny + 2), box(nx + 0.5, nx + 2, ny - 1.5, ny - 0.5))))
      }
      break
    case 'sparkler':
      cv.fill(C.STONE, segment(14.5, 4.5, 17.5, -0.5, 0.5))
      for (const i of [0, 1, 2, 3, 4, 5]) {
        const life = fract(p.t * 0.9 + i / 6)
        const a = i * 1.05 + 0.4
        const sx = 17.5 + Math.cos(a) * life * 3.5
        const sy = -0.5 - Math.sin(a) * life * 3.5
        if (life < 0.8) cv.fill(C.GOLD, (x, y) => Math.abs(x - sx) + Math.abs(y - sy) <= 0.75)
      }
      break
    case 'nap':
      for (const i of [0, 1, 2]) {
        const rise = fract(p.t * 0.35 + i / 3)
        cv.fill(C.INK, off(zed(Math.round(11 + i * 1.5 + rise * 2), Math.round(-1 - rise * 6))))
      }
      break
    case 'zoomies':
      cv.fill(C.STONE, any(box(-5, -1.5, 1.5, 2.5), box(-6, -1.5, 3.5, 4.5), box(-4.5, -1.5, 5.5, 6.5)))
      break
    case 'water':
      cv.fill(C.PAPER, box(13.6, 16.2, 2.2, 9))
      cv.fill(C.SKY, box(13.9, 15.9, 4.2, 8.7))
      cv.fill(C.BLUE, box(14.2, 15.6, 1.2, 2.2))
      break
    case 'coffee':
      cv.fill(C.PAPER, any(box(13.5, 17, 5, 9), minus(disc(17.3, 6.8, 1.3), disc(17.3, 6.8, 0.6))))
      cv.fill(C.EMBER, box(13.8, 16.7, 5, 6))
      for (const i of [0, 1]) {
        const sway = Math.round(Math.sin(p.t * 2 + i))
        cv.fill(C.STONE, box(14 + i * 2 + sway * 0.5, 15 + i * 2 + sway * 0.5, 1, 4))
      }
      break
    case 'party': {
      cv.fill(C.GOLD, (x, y) => -y >= 0 && -y <= 6 && Math.abs(x - 6.5) <= ((6 + y) / 6) * 2.6 && fract(-y / 2) < 0.5)
      cv.fill(C.BLUE, (x, y) => -y >= 0 && -y <= 6 && Math.abs(x - 6.5) <= ((6 + y) / 6) * 2.6 && fract(-y / 2) >= 0.5)
      cv.fill(C.ROSE, disc(6.5, -6.4, 0.85))
      for (let i = 0; i < 8; i++) {
        const fall = fract(p.t * 0.55 + i * 0.37)
        const across = ((i * 3.7) % 22) - 4 + Math.sin(p.t * 2 + i) * 0.8
        const tint = i % 3 === 0 ? C.GOLD : i % 3 === 1 ? C.BLUE : C.ROSE
        cv.fill(tint, off(box(across, across + 1, -8 + fall * 18, -7 + fall * 18)))
      }
      break
    }
    case 'hearts':
      for (const i of [0, 1, 2]) {
        const phase = fract(p.t * 0.8 + i / 3)
        cv.fill(C.ROSE, heart(Math.round(5.5 + (i - 1) * 4), Math.round(-4 - phase * 4)))
      }
      break
  }
}

/** The hat, set aside for the party hat and the speech bubble. 1 beanie, 2 flower crown, 3 wizard,
 * 4 crown, 5 nightcap, 6 santa, 7 witch: the shader's numbers. */
function paintHat(cv: Canvas, p: Pose) {
  if (p.prop === 'party' || p.prop === 'ask') return
  const above = (y: number) => -y // 0 at the top of its head, growing upward
  switch (p.hat) {
    case 1:
      cv.fill(C.BLUE, any((x, y) => disc(6.5, 0.6, 4.4)(x, y) && above(y) <= 4 && above(y) >= -0.4, box(1.6, 11.4, -0.6, 0.4)))
      cv.fill(C.PAPER, disc(6.5, -4.6, 1))
      break
    case 2:
      cv.fill(C.LEAF, box(1.5, 11.5, -1, 0.1))
      for (const i of [0, 1, 2, 3]) cv.fill(i % 3 === 0 ? C.ROSE : i % 3 === 1 ? C.GOLD : C.PAPER, disc(2.5 + i * 2.7, -0.8, 0.95))
      break
    case 3:
      cv.fill(C.PURPLE, any((x, y) => above(y) >= 0 && above(y) <= 9 && Math.abs(x - 6.5) <= ((9 - above(y)) / 9) * 4.2, box(1, 12, -0.6, 0.3)))
      cv.fill(C.GOLD, (x, y) => Math.abs(x - 6.5) + Math.abs(y + 4) <= 1.1)
      break
    case 4:
      cv.fill(C.GOLD, any(box(3, 10, -2, 0.2), box(3, 4, -3.5, -2), box(6, 7, -3.5, -2), box(9, 10, -3.5, -2)))
      cv.fill(C.ROSE, disc(6.5, -1, 0.55))
      break
    case 5:
    case 6: {
      const [ax, ay, bx, by] = [6.5, -0.4, 0.5, -4.6] // the tip droops behind its head
      const cap: Mask = (x, y) => {
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
        return Math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t)) <= 3.4 + (0.6 - 3.4) * t && above(y) >= -0.4
      }
      cv.fill(p.hat === 5 ? C.NIGHTCAP : C.ROSE, cap)
      cv.fill(C.PAPER, p.hat === 5 ? disc(bx, by, 1) : any(box(2.2, 10.8, -0.9, 0.3), disc(bx, by, 1)))
      break
    }
    case 7:
      cv.fill(C.NIGHT, any(box(-0.5, 13.5, -0.8, 0.1), (x, y) => above(y) >= 0 && above(y) <= 8 && Math.abs(x - 6.5 - above(y) * 0.25) <= ((8 - above(y)) / 8) * 3.2))
      cv.fill(C.CLAY, box(3.4, 9.8, -1.9, -0.9))
      break
  }
}

/** Paint one frame, facing right: ART.w x ART.h palette indexes, row-major, 0 where nothing is. */
export function paint(pose: Pose): Uint8Array {
  const cv = new Canvas()
  cv.lift = pose.hop
  const body = critterMask(pose)
  // Its shadow stays on the ground when it hops; the web cloud takes its place.
  if (pose.prop !== 'web') {
    cv.lift = 0
    cv.fill(C.SHADOW, box(1, 12, 9, 10))
    cv.lift = pose.hop
  }
  paintBehind(cv, pose)
  cv.fill(C.CLAY, body)
  // Lit from the top left: the underside and the far side a shade darker.
  cv.fill(C.EMBER, (x, y) => box(1, 12, 0, 7)(x, y) && (y >= 6 || x >= 11) && y >= 1)
  cv.fill(C.INK, (x, y) => body(x, y) && eyesMask(pose.eyes)(x, y))
  paintProp(cv, pose, body)
  paintHat(cv, pose)
  return cv.px
}

// ---- The mini critter. Shrinking the full art loses everything that makes it a critter, so the
// smallest size is drawn by hand, pixel by pixel: grid x 0..11 is the body, grid y 0..5 the body
// and 6..7 the legs. Hats and props sit around it, and every action has a few frames of its own.

/**
 * How many pixels the critter is up off the ground: a hop, or the bob of a dance. The terminal moves
 * the drawn critter by whole cells for this rather than painting it higher, so it keeps its shape.
 */
export function miniLift(p: Pose): number {
  const bob = p.prop === 'dance' ? Math.floor(p.t * 3) % 2 : 0
  return p.hop + bob
}

/**
 * Paint the mini critter, facing right: MINI.w x MINI.h palette indexes, row-major.
 * `layer` 'ground' is what stays on the ground (its shadow, the laptop, the book stand, the globe),
 * 'body' the critter and what it holds with no lift, 'all' both with the lift painted in.
 */
export function paintMini(p: Pose, layer: 'all' | 'ground' | 'body' = 'all'): Uint8Array {
  const px = new Uint8Array(MINI.w * MINI.h)
  // Frame `n` of an animation of `count` frames playing `rate` frames a second.
  const frame = (count: number, rate = 2) => Math.floor(p.t * rate) % count
  const enter = p.enter ?? 1
  // Halfway into a change the puff clears and the new prop is there.
  const prop: Prop = enter < 0.5 && PUFF_AT[p.prop] !== undefined ? 'none' : p.prop
  const lift = layer === 'all' ? miniLift(p) : 0
  // Whether what is drawn now stands on the ground (and stays there when it hops) or is the critter's.
  let grounded = false
  const set = (gx: number, gy: number, color: number) => {
    if (layer === 'ground' ? !grounded : layer === 'body' && grounded) return
    const r = gy - (grounded ? 0 : lift) - MINI.row0
    const c = gx - MINI.col0
    if (r >= 0 && r < MINI.h && c >= 0 && c < MINI.w) px[r * MINI.w + c] = color
  }
  const dot = set
  const row = (x0: number, x1: number, gy: number, color: number) => {
    for (let x = x0; x <= x1; x++) dot(x, gy, color)
  }
  const col = (gx: number, y0: number, y1: number, color: number) => {
    for (let y = y0; y <= y1; y++) dot(gx, y, color)
  }
  /** Rows of a little picture, top row at `gy`: each character a pixel, looked up in `key`; '.' is nothing. */
  const sprite = (gx: number, gy: number, rows: string[], key: Record<string, number>) => {
    rows.forEach((line, dy) => [...line].forEach((ch, dx) => key[ch] !== undefined && dot(gx + dx, gy + dy, key[ch]!)))
  }
  const heart = (gx: number, gy: number) => sprite(gx, gy, ['r.r', 'rrr', '.r.'], { r: C.ROSE })
  const shadow = (x0: number, x1: number) => {
    grounded = true
    row(x0, x1, 7, C.SHADOW)
    grounded = false
  }

  // Where its eyes look: at the work beside it, up at a thought, or about when idle.
  let lookX = 0
  let lookY = 0
  if (['type', 'shell', 'search', 'web', 'water', 'coffee', 'sparkler'].includes(prop)) lookX = 1
  else if (prop === 'think') [lookX, lookY] = [1, -1]
  else if (prop === 'none' && p.still) lookX = p.t % 7 >= 6.3 ? 1 : p.t % 7 >= 5.6 ? -1 : 0

  // Under its feet: its shadow, or a dance floor lighting up.
  if (prop === 'dance') {
    grounded = true
    const tiles = [C.ROSE, C.GOLD, C.BLUE, C.LEAF]
    for (let x = -2; x <= 13; x++) dot(x, 7, tiles[(Math.floor((x + 2) / 2) + frame(4, 4)) % 4]!)
    grounded = false
  } else shadow(0, 11)

  // Behind it: the rain cloud.
  if (prop === 'sad') {
    sprite(2, -6, ['.ssssss.', 'ssssssss', '.ssssss.'], { s: C.STONE })
    const f = frame(3, 4)
    for (const [i, x] of [3, 6, 8].entries()) dot(x, -3 + ((f + i) % 3), C.BLUE)
  }

  // Four thin legs: all down standing still; walking or dancing, one pair lifts, then the other.
  const step = p.dancing ? frame(2, 3) : p.stride
  for (const x of [2, 4, 7, 9]) {
    dot(x, 6, C.CLAY)
    const lifted = (p.dancing || !p.still) && (step === 0 ? x === 4 || x === 9 : x === 2 || x === 7)
    if (!lifted) dot(x, 7, C.CLAY)
  }

  // The body: one flat block of clay, never covered.
  for (let y = 0; y <= 5; y++) row(2, 9, y, C.CLAY)

  // Eyes: one square each, looking where it looks; a line shut; ^ ^ when happy.
  const eyes: Eyes = enter < 0.15 && p.eyes === 'open' ? 'blink' : p.eyes
  for (const [x0, side] of [
    [3, -1],
    [8, 1],
  ] as const) {
    const x = x0 + lookX
    const y = 1 + lookY
    if (eyes === 'happy') {
      dot(x0 - 1, 1, C.INK)
      dot(x0, 0, C.INK)
      dot(x0 + 1, 1, C.INK)
    } else if (eyes === 'shut') row(Math.min(x0, x0 + side), Math.max(x0, x0 + side), 2, C.INK)
    else if (eyes === 'lidded') dot(x, y + 1, C.INK)
    else if (eyes !== 'blink') dot(x, y, C.INK)
  }

  // Arms, 2 x 2 on each side. Dancing they swing up in turn; otherwise the far one waves, holds or works.
  const arm = (x: number, up: boolean) => sprite(x, up ? 0 : 2, ['cc', 'cc'], { c: C.CLAY })
  const swing = prop === 'dance' ? frame(2, 3) : -1
  arm(0, swing === 0)
  const works = ['type', 'shell', 'search', 'read', 'web'].includes(prop)
  if (prop === 'dance') arm(10, swing === 1)
  else if (!works) {
    if (p.arm === 'raised' || p.arm === 'wave') {
      const out = p.arm === 'wave' && frame(2, 3) === 1
      sprite(10, 0, ['c', 'c'], { c: C.CLAY })
      sprite(out ? 11 : 10, -2, ['c', 'c'], { c: C.CLAY })
    } else if (p.arm === 'holding') sprite(10, 2, ['ccc', 'ccc'], { c: C.CLAY })
    else arm(10, false)
  } else arm(10, false)

  switch (prop) {
    case 'type': {
      // A laptop on the ground beside it: code types out on its screen line by line, colour by colour,
      // and scrolls up; the critter's hand taps, and the key under it lights.
      const f = Math.floor(p.t * 8)
      grounded = true
      // screen: a frame round a dark display, a gutter of line numbers down its left
      row(16, 25, -3, C.STONE)
      row(16, 25, 4, C.STONE)
      col(16, -3, 4, C.STONE)
      col(25, -3, 4, C.STONE)
      for (let y = -2; y <= 3; y++) row(17, 24, y, C.NIGHT)
      // the code: each line a keyword then a few tokens, indented, typed a character a frame
      const len = (n: number) => 3 + ((n * 5) % 4) // 3..6 characters
      const ind = (n: number) => [0, 1, 2, 1][n % 4]!
      // twelve lines make a whole pattern; the screen loops through it for as long as it types
      let cycle = 0
      for (let n = 0; n < 12; n++) cycle += len(n) + 2
      const g = f % cycle
      let at = 0
      let line = 0
      while (at + len(line) + 2 <= g) {
        at += len(line) + 2 // a line, then a beat before the next
        line++
      }
      const typed = Math.min(len(line), g - at)
      const starts: number[] = []
      for (let n = line - 5; n <= line; n++) starts.push(n)
      starts.forEach((m, r) => {
        const n = ((m % 12) + 12) % 12
        const y = -2 + r
        dot(17, y, C.STONE) // its line number
        const chars = m === line ? typed : len(n)
        // a keyword, a space, then a name or a string
        for (let i = 0; i < chars; i++) {
          const x = 18 + ind(n) + i
          if (x > 24 || i === 2) continue
          dot(x, y, i < 2 ? C.ROSE : n % 3 === 0 ? C.LEAF : C.SKY)
        }
        if (m === line && f % 2 === 0) dot(Math.min(24, 18 + ind(n) + chars), y, C.PAPER) // the cursor
      })
      // keyboard and base
      for (let x = 14; x <= 25; x++) dot(x, 5, x % 2 ? C.STONE : C.PAPER)
      const tap = f % 2 === 0
      if (tap) dot(14, 5, C.GOLD)
      row(13, 26, 6, C.STONE)
      row(13, 26, 7, C.SHADOW)
      grounded = false
      // the far hand reaching to the keys, tapping
      dot(12, 3, C.CLAY)
      dot(13, 4, C.CLAY)
      dot(14, tap ? 4 : 3, C.CLAY)
      break
    }
    case 'read': {
      // A big book open on a stand beside it, reading glasses on; a gold mark runs down its lines,
      // and when a spread is read a page lifts and sweeps across to the other side.
      sprite(2, 0, ['ggg..ggg', 'g.gggg.g', 'ggg..ggg'], { g: C.GOLD }) // round glasses, eyes in the middle
      const cycle = Math.floor(p.t * 8) % 31
      const spread = Math.floor(p.t * 8 / 31)
      grounded = true
      // the stand
      col(19, 3, 6, C.EMBER)
      col(20, 3, 6, C.EMBER)
      row(17, 22, 7, C.EMBER)
      row(13, 26, 7, C.SHADOW)
      row(17, 22, 7, C.EMBER)
      // the book: covers under the pages, a spine down the middle
      row(13, 26, 3, C.BLUE)
      for (let y = -1; y <= 2; y++) row(13, 26, y, C.PAPER)
      col(19, -1, 2, C.STONE)
      col(20, -1, 2, C.STONE)
      // lines of text, three to a page, a new spread's after a turn
      const reading = cycle < 24 ? Math.floor(cycle / 4) : -1 // which of the six lines
      for (let i = 0; i < 6; i++) {
        const left = i < 3
        const y = i % 3
        const x0 = left ? 14 : 21
        const w = 3 + ((i + spread) % 3)
        for (let x = x0; x < x0 + w; x++) dot(x, y, i === reading ? C.EMBER : C.CLAY)
        if (i === reading) dot(x0 - 1, y, C.GOLD) // the mark where it's reading
      }
      // a page turning: up from the right, over the spine, down on the left
      if (cycle >= 24) {
        const sweep: [number, number][] = [
          [24, -1],
          [22, -2],
          [21, -3],
          [19, -4],
          [17, -3],
          [16, -2],
          [14, -1],
        ]
        const [x, y] = sweep[cycle - 24]!
        sprite(x, y, ['pp', 'pp', 'pp', 'pp'], { p: C.PAPER })
      }
      grounded = false
      // its far hand on the book's edge, holding the page
      dot(12, 2, C.CLAY)
      break
    }
    case 'search': {
      // A lens held out over a belt: files ride past under it, each one magnified as it goes by;
      // the one it is after stops, glows and gets a tick.
      const f = Math.floor(p.t * 8)
      const SPACE = 5
      const lens = 15 // the lens's inside, x 15..17, y 3..5
      grounded = true
      // the belt, its marks running toward the lens
      for (let x = 13; x <= 27; x++) dot(x, 7, (x + f) % 3 === 0 ? C.STONE : C.SHADOW)
      // the files: docs, and every fourth one the folder it is after
      let match = false
      for (let k = 0; k < 4; k++) {
        const x = 27 - ((f + k * SPACE) % (SPACE * 4))
        const n = Math.floor((f + k * SPACE) / (SPACE * 4)) * 4 + k
        const isMatch = n % 4 === 3
        if (x < lens) continue
        if (isMatch && x >= lens - 4 && x <= lens) match = true // it lingers a moment as it's found
        if (x <= 17 && x !== lens) continue // passing under the lens, seen only through it
        if (x === lens) continue
        if (isMatch) sprite(x, 4, ['gg.', 'ggg', 'ggg'], { g: C.GOLD })
        else sprite(x, 4, ['pp.', 'pkp', 'ppp'], { p: C.PAPER, k: C.STONE })
      }
      grounded = false
      // the lens: a ring, its glass showing what is under it, a glint; its handle in the critter's hand
      const under = (() => {
        for (let k = 0; k < 4; k++) {
          const x = 27 - ((f + k * SPACE) % (SPACE * 4))
          const n = Math.floor((f + k * SPACE) / (SPACE * 4)) * 4 + k
          if (x >= lens - 2 && x <= lens + 2) return n % 4 === 3 ? C.GOLD : C.PAPER
        }
        return C.SKY
      })()
      sprite(14, 2, ['sssss', 's...s', 's...s', 's...s', 'sssss'], { s: C.STONE })
      for (let y = 3; y <= 5; y++) row(15, 17, y, under)
      dot(15, 3, under === C.SKY ? C.PAPER : C.SKY)
      dot(12, 2, C.CLAY)
      dot(13, 2, C.STONE)
      if (match) {
        sprite(14, -3, ['...l', 'l.l.', '.l..'], { l: C.LEAF }) // a tick
        dot(19, -2, C.GOLD)
        dot(13, -1, C.GOLD)
      } else sprite(15, -3, ['sss', '..s', '.s.', '...', '.s.'], { s: C.SKY })
      break
    }
    case 'web': {
      // A globe on a stand beside it, turning; packets run out to it along a line and come back.
      const f = Math.floor(p.t * 6)
      grounded = true
      const LAND = ['..gg....g.....', '.gggg..ggg..g.', 'gggg....gg.ggg', '.gg...ggg...gg', '..g..gggg.....', '.....gg....g..', '..............']
      const SHAPE = ['..xxx..', '.xxxxx.', 'xxxxxxx', 'xxxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..']
      for (let y = 0; y < 7; y++)
        for (let x = 0; x < 7; x++) {
          if (SHAPE[y]![x] !== 'x') continue
          const land = LAND[y]![(x + f) % 14] === 'g'
          dot(20 + x, -1 + y, land ? C.LEAF : C.BLUE)
        }
      dot(21, 0, C.PAPER) // a glint
      dot(23, 6, C.STONE)
      row(21, 25, 7, C.STONE)
      // the line out to it, and packets: gold going, sky coming back
      for (let x = 13; x <= 19; x += 2) dot(x, 2, C.STONE)
      const g = frame(7, 8)
      dot(13 + g, 1, C.GOLD)
      dot(19 - ((g + 3) % 7), 3, C.SKY)
      grounded = false
      dot(12, 2, C.CLAY)
      break
    }
    case 'think': {
      // Bubbles rising to its side into a big one, where gears turn, then dots gather, then a bulb lights.
      const f = frame(18, 4)
      dot(12, 0, C.PAPER)
      sprite(15, -3, ['pp', 'pp'], { p: C.PAPER })
      sprite(18, -6, ['.pppppppp.', 'pppppppppp', 'pppppppppp', 'pppppppppp', 'pppppppppp', 'pppppppppp', '.pppppppp.'], { p: C.PAPER })
      if (f < 6) {
        const turn = Math.floor(p.t * 6) % 2
        sprite(19, -5, turn ? ['s.s', '.g.', 's.s'] : ['.s.', 'sgs', '.s.'], { s: C.STONE, g: C.GOLD })
        sprite(22, -3, turn ? ['.s.', 'sgs', '.s.'] : ['s.s', '.g.', 's.s'], { s: C.STONE, g: C.GOLD })
      } else if (f < 12) {
        for (let i = 0; i <= Math.min(2, Math.floor((f - 6) / 2)); i++) dot(20 + i * 2, -3, C.INK)
      } else {
        sprite(21, -5, ['.g.', 'ggg', 'ggg', '.s.'], { g: C.GOLD, s: C.STONE })
        if (f % 2) {
          dot(19, -5, C.GOLD)
          dot(25, -5, C.GOLD)
          dot(19, -2, C.GOLD)
          dot(25, -2, C.GOLD)
        }
      }
      break
    }
    case 'shell': {
      // A terminal window: a prompt, a command typed out, its output printing, the lot scrolling up.
      grounded = true
      row(14, 21, -2, C.STONE)
      dot(15, -2, C.ROSE)
      dot(16, -2, C.GOLD)
      dot(17, -2, C.LEAF)
      for (let y = -1; y <= 5; y++) {
        dot(14, y, C.STONE)
        dot(21, y, C.STONE)
        row(15, 20, y, C.NIGHT)
      }
      row(14, 21, 6, C.STONE)
      row(14, 21, 7, C.SHADOW)
      const step = Math.floor(p.t * 6)
      const cmd = Math.floor(step / 8)
      const at = step % 8
      type Line = { prompt: boolean; len: number; color: number }
      const lines: Line[] = []
      for (let c = Math.max(0, cmd - 3); c <= cmd; c++) {
        const done = c < cmd ? 8 : at
        lines.push({ prompt: true, len: Math.min(4, done), color: C.PAPER })
        if (done >= 5) lines.push({ prompt: false, len: 2 + (c % 4), color: c % 2 ? C.SKY : C.GOLD })
        if (done >= 6) lines.push({ prompt: false, len: 1 + ((c + 1) % 5), color: C.SKY })
      }
      if (at >= 7) lines.push({ prompt: true, len: 0, color: C.PAPER }) // the next prompt, waiting
      const shown = lines.slice(-7)
      shown.forEach((l, i) => {
        const y = -1 + i
        if (l.prompt) {
          dot(15, y, C.LEAF)
          if (l.len > 0) row(16, 15 + l.len, y, l.color)
        } else row(15, 14 + l.len, y, l.color)
      })
      const last = shown[shown.length - 1]!
      if (last.prompt && last.len < 4 && frame(2, 4)) dot(16 + last.len, -1 + shown.length - 1, C.PAPER)
      grounded = false
      dot(12, 3, C.CLAY)
      dot(13, at < 5 && step % 2 ? 4 : 3, C.CLAY)
      break
    }
    case 'ask':
      // A speech bubble with a "!" flashing for attention, rays around it, over a waving arm.
      sprite(2, -6, ['.ssssss.', 'sppkkpps', 'sppkkpps', 'spppppps', 'sppkkpps', '.ssssss.'], { s: C.STONE, p: C.PAPER, k: frame(2, 3) ? C.ROSE : C.INK })
      if (frame(2, 6) === 0) for (const x of [0, 11]) dot(x, frame(4, 6) === 0 ? -5 : -2, C.GOLD)
      break
    case 'party': {
      // A striped party hat with a pom, and confetti falling past on both sides.
      sprite(3, -6, ['..rr..', '..gg..', '.bbbb.', '.gggg.', 'bbbbbb'], { r: C.ROSE, g: C.GOLD, b: C.BLUE })
      const tints = [C.GOLD, C.BLUE, C.ROSE, C.LEAF]
      const f = frame(12, 6)
      for (let i = 0; i < 10; i++) {
        const x = [-3, -1, 13, 15, 17, 19, 21, 23, 25, 27][i]!
        const y = -6 + ((f + i * 3) % 13)
        dot(x, y, tints[i % 4]!)
      }
      break
    }
    case 'dance': {
      // Notes floating off to its side on a wave, and one to the other side.
      const f = Math.floor(p.t * 4)
      const tints = [C.BLUE, C.ROSE, C.GOLD]
      for (let k = 0; k < 3; k++) {
        const x = 13 + ((f + k * 4) % 12)
        const y = -3 + [0, -1, -2, -1][(f + k) % 4]!
        sprite(x, y, ['.ii', '.i.', 'ii.'], { i: tints[k]! })
      }
      sprite(-3, -3 + frame(2, 3), ['.ii', '.i.', 'ii.'], { i: C.BLUE })
      break
    }
    case 'sparkler': {
      // A stick held out, sparks fanning from its tip.
      dot(13, 2, C.STONE)
      dot(14, 1, C.STONE)
      dot(15, 0, C.STONE)
      const sparks = [
        ['g.g', '.g.', 'g.g'],
        ['.g.', 'ggg', '.g.'],
        ['g.g', '...', 'g.g'],
      ]
      sprite(15, -3, sparks[frame(3, 4)]!, { g: C.GOLD })
      break
    }
    case 'nap': {
      // Z's, big to small, drifting up and away.
      const f = frame(3, 2)
      sprite(11 + f, -1 - f, ['zz', '.z', 'zz'], { z: C.SKY })
      sprite(14 + f, -4 - f, ['zzz', '.z.', 'zzz'], { z: C.SKY })
      break
    }
    case 'zoomies':
      // Speed lines streaming behind it.
      for (const [i, y] of [1, 3, 5].entries()) row(-4 + ((frame(2, 6) + i) % 2), -2, y, C.STONE)
      break
    case 'water':
      // A bottle held out: a blue cap, water inside, a glint.
      sprite(13, -1, ['.b.', '.p.', 'pkp', 'pkp', 'pkp', 'ppp'], { b: C.BLUE, p: C.PAPER, k: C.SKY })
      break
    case 'coffee': {
      // A mug of coffee, steam curling up.
      sprite(13, 1, ['eee.', 'ppp.', 'pppp', 'ppp.'], { e: C.EMBER, p: C.PAPER })
      dot(16, 2, C.PAPER)
      const f = frame(2, 3)
      dot(13 + f, -1, C.STONE)
      dot(14 - f, 0, C.STONE)
      dot(15, -2 + f, C.STONE)
      break
    }
    case 'hearts': {
      // Hearts floating up from its head.
      const f = frame(3, 3)
      heart(2, -3 - f)
      heart(7, -5 + f)
      break
    }
  }

  // A change of act: the old prop goes in a puff, the new one arrives in one, with a sparkle.
  const puff = (at: [number, number] | undefined, big: boolean) => {
    if (at === undefined) return
    const [x, y] = at
    if (big) sprite(x - 2, y - 1, ['.p.p.', 'p.s.p', '.p.p.'], { p: C.PAPER, s: C.STONE })
    else sprite(x - 1, y - 1, ['.s.', 'sps', '.s.'], { s: C.STONE, p: C.PAPER })
  }
  if (enter < 1) {
    if (p.from !== undefined && p.from !== p.prop && enter < 0.25) puff(PUFF_AT[p.from], true)
    if (enter < 0.25) puff(PUFF_AT[p.prop], false)
    else if (enter < 0.5) puff(PUFF_AT[p.prop], true)
    else if (enter < 0.75 && PUFF_AT[p.prop] !== undefined) {
      const [x, y] = PUFF_AT[p.prop]!
      dot(x + 2, y - 2, C.GOLD)
    }
  }

  // The hat, set aside for the party hat and the speech bubble.
  if (prop !== 'party' && prop !== 'ask') {
    switch (p.hat) {
      case 1: // beanie
        sprite(2, -4, ['...pp...', '.bbbbbb.', 'bbbbbbbb', 'nnnnnnnn'], { b: C.BLUE, p: C.PAPER, n: C.NIGHTCAP })
        break
      case 2: // flower crown
        row(2, 9, -1, C.LEAF)
        for (const x of [3, 8]) sprite(x - 1, -3, ['.r.', 'rgr', '.r.'], { r: C.ROSE, g: C.GOLD })
        row(5, 6, -2, C.PAPER)
        break
      case 3: // wizard: a purple cone with a gold star, a lilac band, a wide brim
        sprite(1, -6, ['....uu....', '...uguu...', '..ugggu...', '..uuguuu..', '.llllllll.', 'uuuuuuuuuu'], { u: C.PURPLE, g: C.GOLD, l: C.LILAC })
        break
      case 4: // crown
        sprite(2, -3, ['g.g..g.g', 'gggggggg', 'grgbbgrg'], { g: C.GOLD, r: C.ROSE, b: C.BLUE })
        break
      case 5: // nightcap
      case 6: {
        // santa
        const c = p.hat === 5 ? C.NIGHTCAP : C.ROSE
        sprite(-1, -5, ['ww.........', 'wwccc......', '..ccccc....', '...cccccc..', '...rrrrrrrr'], { c, w: C.PAPER, r: p.hat === 6 ? C.PAPER : c })
        break
      }
      case 7: // witch
        sprite(0, -6, ['.......s....', '......sn....', '.....snn....', '....snnn....', '...uuuuuu...', 'ssssssssssss'], { n: C.NIGHT, s: C.STONE, u: C.PURPLE })
        break
    }
  }

  // White things get a stone edge where they meet nothing, so they hold their shape on a light terminal too.
  const edge: number[] = []
  for (let r = 0; r < MINI.h; r++)
    for (let c = 0; c < MINI.w; c++) {
      if (px[r * MINI.w + c] !== 0) continue
      const near = [r > 0 && px[(r - 1) * MINI.w + c], r < MINI.h - 1 && px[(r + 1) * MINI.w + c], c > 0 && px[r * MINI.w + c - 1], c < MINI.w - 1 && px[r * MINI.w + c + 1]]
      if (near.includes(C.PAPER)) edge.push(r * MINI.w + c)
    }
  for (const i of edge) px[i] = C.STONE
  return px
}

/** Where a prop appears, for the puff it arrives and leaves in; props with none (hearts, for a pet) just appear. */
const PUFF_AT: Partial<Record<Prop, [number, number]>> = {
  type: [20, 1],
  shell: [17, 2],
  search: [16, 3],
  water: [14, 2],
  coffee: [14, 2],
  sparkler: [15, 0],
  think: [21, -3],
  ask: [5, -4],
  party: [5, -4],
  sad: [5, -4],
  nap: [14, -3],
  web: [23, 2],
  read: [19, 0],
}
