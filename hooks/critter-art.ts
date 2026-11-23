// The critter painted on the CPU, for surfaces with no shader (the terminal).
// Same grid, same shapes, same colours as the art pass in critter-shader.ts: grid x grows right,
// grid y grows down, the top of its head is row 0, its feet stand on row 10. Each grid pixel is
// sampled at its centre, so a shape covers a pixel when it covers that pixel's middle.

/** The painted canvas: grid columns col0..col0+w-1, rows row0..row0+h-1. */
export const ART = { col0: -6, row0: -8, w: 30, h: 20 } as const

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

/** Paint one frame, facing right: ART.w x ART.h palette indexes, row-major, 0 where nothing is. */
export function paint(pose: Pose): Uint8Array {
  const cv = new Canvas()
  cv.lift = pose.hop
  const body = critterMask(pose)
  cv.fill(C.CLAY, body)
  cv.fill(C.INK, (x, y) => body(x, y) && eyesMask(pose.eyes)(x, y))
  return cv.px
}
