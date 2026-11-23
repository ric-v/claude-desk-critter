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
/** The mini critter, drawn by hand for the smallest size: a 12 x 8 body with room for hats and props. */
export const MINI = { col0: -3, row0: -6, w: 21, h: 14, mid: 9, bodyFrom: 3, bodyTo: 14, bodyPx: 8 } as const

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
export type Pose = { stride: 0 | 1; dancing: boolean; eyes: Eyes; arm: Arm; hop: 0 | 1; prop: Prop; hat: number; t: number }

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

/** Paint the mini critter, facing right: MINI.w x MINI.h palette indexes, row-major. */
export function paintMini(p: Pose): Uint8Array {
  const px = new Uint8Array(MINI.w * MINI.h)
  // Frame `n` of an animation of `count` frames playing `rate` frames a second.
  const frame = (count: number, rate = 2) => Math.floor(p.t * rate) % count
  let lift = p.hop as number
  if (p.prop === 'web' || p.prop === 'dance') lift += frame(2) // it bobs on its cloud, and to the beat
  const set = (gx: number, gy: number, color: number, ground = false) => {
    const r = gy - (ground ? 0 : lift) - MINI.row0
    const c = gx - MINI.col0
    if (r >= 0 && r < MINI.h && c >= 0 && c < MINI.w) px[r * MINI.w + c] = color
  }
  const isEmpty = (gx: number, gy: number) => {
    const r = gy - lift - MINI.row0
    const c = gx - MINI.col0
    return r < 0 || r >= MINI.h || c < 0 || c >= MINI.w || px[r * MINI.w + c] === 0
  }
  const dot = (gx: number, gy: number, color: number) => set(gx, gy, color)
  const row = (x0: number, x1: number, gy: number, color: number) => {
    for (let x = x0; x <= x1; x++) dot(x, gy, color)
  }
  /** Rows of a little picture, top row at `gy`: each character a pixel, looked up in `key`; '.' is nothing. */
  const sprite = (gx: number, gy: number, rows: string[], key: Record<string, number>) => {
    rows.forEach((line, dy) => [...line].forEach((ch, dx) => key[ch] !== undefined && dot(gx + dx, gy + dy, key[ch]!)))
  }
  const heart = (gx: number, gy: number) => sprite(gx, gy, ['r.r', 'rrr', '.r.'], { r: C.ROSE })

  // On the ground: its shadow, or the web cloud in its place.
  if (p.prop === 'web') {
    for (let x = -2; x <= 13; x++) set(x, 7, x === -2 || x === 13 ? C.STONE : C.PAPER, true)
    for (let x = -1; x <= 12; x++) set(x, 6, x === -1 || x === 12 ? C.STONE : C.PAPER, true)
    for (const x of [1, 2, 5, 6, 9, 10]) set(x, 5, C.PAPER, true)
  } else for (let x = 0; x <= 11; x++) set(x, 7, C.SHADOW, true)

  // Behind it: the rain cloud.
  if (p.prop === 'sad') {
    sprite(2, -6, ['.ssss.', 'ssssss', '.ssss.'], { s: C.STONE })
    row(8, 9, -5, C.STONE)
    const f = frame(3, 4)
    for (const [i, x] of [3, 6, 9].entries()) dot(x, -3 + ((f + i) % 3), C.BLUE)
  }

  // The body: rounded, lit from the top left, shaded underneath and on its far side.
  row(1, 10, 0, C.CLAY)
  for (const y of [1, 2, 3, 4]) row(0, 11, y, C.CLAY)
  row(1, 10, 5, C.EMBER)
  for (const y of [1, 2, 3, 4]) dot(11, y, C.EMBER)
  row(2, 4, 0, C.LIGHT)
  dot(1, 1, C.LIGHT)
  dot(-1, 2, C.CLAY) // the near side's nub
  dot(-1, 3, C.CLAY)

  // Legs that step, or tap along while dancing; tucked up on the cloud.
  if (p.prop !== 'web') {
    const stride = p.dancing ? frame(2, 5) : p.stride
    for (const x of [1, 4, 7, 10]) dot(x, 6, C.CLAY)
    for (const x of stride === 0 ? [1, 7] : [4, 10]) dot(x, 7, C.CLAY)
  }

  // Eyes: 2 x 2 with a glint; a line shut; ^ ^ and a blush when happy.
  for (const x of [2, 8]) {
    if (p.eyes === 'happy') {
      dot(x, 3, C.INK)
      dot(x + 1, 2, C.INK)
      dot(x + 2, 3, C.INK)
    } else if (p.eyes === 'shut' || p.eyes === 'blink') row(x, x + 1, 3, C.INK)
    else if (p.eyes === 'lidded') {
      row(x, x + 1, 2, C.EMBER)
      row(x, x + 1, 3, C.INK)
    } else {
      dot(x, 2, C.PAPER)
      dot(x + 1, 2, C.INK)
      row(x, x + 1, 3, C.INK)
    }
  }
  if (p.eyes === 'happy') {
    dot(1, 4, C.ROSE)
    dot(10, 4, C.ROSE)
  }

  // The far arm: resting, held out, tapping, or up to wave.
  const holding = p.arm === 'holding'
  if (p.arm === 'raised' || p.arm === 'wave') {
    const out = p.arm === 'wave' && frame(2, 3) === 1
    dot(12, 1, C.CLAY)
    dot(12, 0, C.CLAY)
    dot(out ? 13 : 12, -1, C.CLAY)
  } else if (holding) row(12, 13, p.prop === 'type' ? 4 : 3, C.CLAY)
  else {
    dot(12, 2, C.CLAY)
    dot(12, 3, C.CLAY)
  }

  switch (p.prop) {
    case 'type': {
      // A laptop: a lit screen with lines of text scrolling up, the arm tapping its keys.
      for (let y = 0; y <= 4; y++) dot(17, y, C.STONE)
      row(15, 17, -1, C.STONE)
      const f = frame(4, 6)
      for (const y of [0, 1, 2, 3]) row(15, 16, y, (y + f) % 4 === 3 ? C.SKY : (y + f) % 2 ? C.PAPER : C.SKY)
      row(14, 17, 4, C.STONE)
      row(12, 17, 5, C.STONE)
      dot(frame(2, 6) ? 13 : 14, 4, C.CLAY)
      break
    }
    case 'shell': {
      // A little terminal: a prompt, a line of output scrolling, a blinking cursor.
      for (let y = 0; y <= 5; y++) row(13, 17, y, y === 0 || y === 5 ? C.STONE : C.NIGHT)
      for (let y = 0; y <= 5; y++) dot(17, y, C.STONE)
      const f = frame(3, 2)
      sprite(14, 1 + (f === 2 ? 0 : 0), ['g..', '.g.', 'g..'], { g: C.LEAF })
      if (frame(2, 3)) row(16, 16, 3, C.LEAF)
      row(14, 14 + f, 5 - 0, f === 0 ? C.NIGHT : C.STONE)
      break
    }
    case 'read': {
      // Round glasses, and an open book whose pages turn.
      for (const x of [1, 7]) {
        row(x, x + 3, 1, C.INK)
        dot(x, 2, C.INK)
        dot(x + 3, 2, C.INK)
      }
      row(5, 6, 2, C.INK)
      sprite(3, 4, ['pppppp', 'bbssbb', 'bbbbbb'], { p: C.PAPER, b: C.BLUE, s: C.SKY })
      dot(frame(2) ? 7 : 4, 3, C.PAPER) // a page lifting, one side then the other
      break
    }
    case 'search': {
      // A magnifying glass swept back and forth.
      const x = [12, 13, 14, 13][frame(4, 3)]!
      sprite(x, -3, ['.ii.', 'ikki', 'ikki', '.ii.'], { i: C.STONE, k: C.SKY })
      dot(x, 1, C.STONE)
      dot(x - 1, 2, C.STONE)
      break
    }
    case 'think': {
      // A spark turning over its head.
      const shapes = [
        ['.e.', 'ege', '.e.'],
        ['e.e', '.g.', 'e.e'],
      ]
      sprite(4, -4, shapes[frame(2, 3)]!, { e: C.EMBER, g: C.GOLD })
      dot(8, -2, C.EMBER)
      if (frame(2)) dot(9, -3, C.EMBER)
      break
    }
    case 'ask':
      // A speech bubble with a "!" flashing for attention, over a waving arm.
      sprite(2, -6, ['.ssssss.', 'sppkkpps', 'sppkkpps', 'spppppps', 'sppkkpps', '.ssssss.'], { s: C.STONE, p: C.PAPER, k: frame(2, 3) ? C.ROSE : C.INK })
      break
    case 'party': {
      // A striped party hat with a pom, and confetti falling past.
      sprite(3, -6, ['..rr..', '..gg..', '.bbbb.', '.gggg.', 'bbbbbb'], { r: C.ROSE, g: C.GOLD, b: C.BLUE })
      const tints = [C.GOLD, C.BLUE, C.ROSE, C.LEAF]
      const f = frame(6, 6)
      for (let i = 0; i < 6; i++) {
        const x = [-3, -1, 10, 13, 15, 16][i]!
        const y = -6 + ((f + i * 2) % 12)
        if (isEmpty(x, y)) dot(x, y, tints[i % 4]!)
      }
      break
    }
    case 'dance':
      // Notes bobbing on either side, one up while the other is down.
      for (const [i, x] of [-3, 14].entries()) {
        const y = (frame(2, 3) + i) % 2 === 0 ? -3 : -2
        sprite(x, y, ['.ii', '.i.', 'ii.'], { i: C.BLUE })
      }
      break
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
      // Z's, big to small, drifting up.
      const f = frame(3, 2)
      sprite(12, -1 - f, ['zz', '.z', 'zz'], { z: C.SKY })
      sprite(14, -4 - f, ['zzz', '.z.', 'zzz'], { z: C.SKY })
      break
    }
    case 'zoomies':
      // Speed lines streaming behind it.
      for (const [i, y] of [1, 3, 5].entries()) row(-3 + ((frame(2, 6) + i) % 2), -2, y, C.STONE)
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
      heart(1, -3 - f)
      heart(7, -5 + f)
      break
    }
  }

  // The hat, set aside for the party hat and the speech bubble.
  if (p.prop !== 'party' && p.prop !== 'ask') {
    switch (p.hat) {
      case 1: // beanie
        sprite(1, -4, ['....pp....', '..bbbbbb..', '.bbbbbbbb.', 'nnnnnnnnnn'], { b: C.BLUE, p: C.PAPER, n: C.NIGHTCAP })
        break
      case 2: // flower crown
        row(0, 11, -1, C.LEAF)
        for (const x of [2, 6, 10]) sprite(x - 1, -3, ['.r.', 'rgr', '.r.'], { r: x === 6 ? C.PAPER : C.ROSE, g: C.GOLD })
        break
      case 3: // wizard
        sprite(0, -6, ['.....uu.....', '....uuuu....', '....uguu....', '...uuuuuu...', '..uuuuuuuu..', 'uuuuuuuuuuuu'], { u: C.PURPLE, g: C.GOLD })
        break
      case 4: // crown
        sprite(2, -3, ['g..gg..g', 'gggggggg', 'grgbbgrg'], { g: C.GOLD, r: C.ROSE, b: C.BLUE })
        break
      case 5: // nightcap
      case 6: {
        // santa
        const c = p.hat === 5 ? C.NIGHTCAP : C.ROSE
        sprite(-2, -5, ['ww.........', 'wwccc......', '..ccccc....', '...ccccccc..', '..rrrrrrrrrr'], { c, w: C.PAPER, r: p.hat === 6 ? C.PAPER : c })
        break
      }
      case 7: // witch
        sprite(-1, -6, ['........s.....', '.......sn.....', '......snn.....', '.....snnn.....', '....uuuuuu....', 'ssssssssssssss'], { n: C.NIGHT, s: C.STONE, u: C.PURPLE })
        break
    }
  }

  // White things get a stone edge where they meet the ground, so they hold their shape on a light terminal too.
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
