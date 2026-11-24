// Light and depth for the terminal critter: the painted grid, already laid out on the screen (mirrored,
// moved, lifted), lit the way the backdrop's shader lights it. Its clay is a rounded block whose edges
// bevel away, lit from the top left with a soft highlight; a darker side face shows to its lower right;
// its eyes catch a glint; its shadow is soft. The light stays put on the screen whichever way it faces.
// Pure: no `$`, so all of it is tested directly.

import { C, PALETTE } from './critter-art'

const norm = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
}

/** From the top left, toward the viewer: the shader's light, with y turned to grow down. */
const L = norm(-0.5, -0.65, 0.75)
const HALF = norm(L[0], L[1], L[2] + 1)
/** How far in from an edge the bevel reaches, in painted pixels. */
const BEVEL = 1.5
/** How round the bevel is: smaller is rounder. */
const FLAT = 1.15
const GLOSS_POW = 28
const GLOSS = 0.32
const DIFFUSE = 0.66
// A flat face keeps its colour exactly: the light's share of a face turned straight at the viewer.
const AMBIENT = 1 - DIFFUSE * L[2]
const FLAT_GLOSS = Math.pow(HALF[2], GLOSS_POW) * GLOSS
/** The side face: the clay in shadow. */
const SIDE = 0.52
/** How dark the soft shadow on the ground is at its middle. */
const SHADOW_ALPHA = 0.42

export type LightOptions = {
  /** The side face, pushed this many painted pixels to the lower right; 0 for none. */
  depth?: number
  /** The ground shadow as a see-through ellipse rather than a flat grey. */
  soft?: boolean
}

/** A lit frame: a colour (0xRRGGBB) and a coverage (0 nothing, 255 solid) per cell. */
export type Lit = { rgb: Uint32Array; alpha: Uint8Array }

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

const scaled = (c: number, f: number, add: number) => {
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((c >> s) & 255) * f + add * 255)))
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/**
 * Light a laid-out grid of palette indexes, `w` x `h`, at `per` cells to a painted pixel.
 * Empty cells stay empty, except where the side face shows.
 */
export function light(g: Uint8Array, w: number, h: number, per: number, opts: LightOptions = {}): Lit {
  const n = w * h
  const rgb = new Uint32Array(n)
  const alpha = new Uint8Array(n)

  // The block: its clay, and its eyes: ink with clay beside it and clay above or below it, so an eye
  // looking out over the body's edge is still part of its face.
  const body = new Uint8Array(n)
  const clayPast = (x: number, y: number, dx: number, dy: number) => {
    while (x >= 0 && y >= 0 && x < w && y < h && g[y * w + x] === C.INK) [x, y] = [x + dx, y + dy]
    return x >= 0 && y >= 0 && x < w && y < h && g[y * w + x] === C.CLAY
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x]!
      if (v === C.CLAY) body[y * w + x] = 1
      else if (v === C.INK && (clayPast(x, y, -1, 0) || clayPast(x, y, 1, 0)) && (clayPast(x, y, 0, -1) || clayPast(x, y, 0, 1))) body[y * w + x] = 2
    }

  // How near each edge of the block a cell is, across its row and down its column.
  const nx = new Float32Array(n)
  const ny = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    const r = y * w
    for (let a = 0; a < w; ) {
      if (!body[r + a]) {
        a++
        continue
      }
      let b = a
      while (b < w && body[r + b]) b++
      for (let x = a; x < b; x++) nx[r + x] = smooth(0, BEVEL, (x + 0.5 - a) / per) - smooth(0, BEVEL, (b - x - 0.5) / per)
      a = b
    }
  }
  for (let x = 0; x < w; x++) {
    for (let a = 0; a < h; ) {
      if (!body[a * w + x]) {
        a++
        continue
      }
      let b = a
      while (b < h && body[b * w + x]) b++
      for (let y = a; y < b; y++) ny[y * w + x] = smooth(0, BEVEL, (y + 0.5 - a) / per) - smooth(0, BEVEL, (b - y - 0.5) / per)
      a = b
    }
  }

  const depth = Math.max(0, Math.round((opts.depth ?? 0) * per))
  const side = scaled(PALETTE[C.CLAY]!, SIDE, 0)
  for (let y = 0; y < h; y++) {
    const r = y * w
    for (let x = 0; x < w; x++) {
      const i = r + x
      const v = g[i]!
      if (v === 0 || v === C.SHADOW) {
        // Behind it, past its edge: the side face, pushed to the lower right.
        if (depth > 0 && x >= depth && y >= depth && body[i - depth * w - depth]) {
          rgb[i] = side
          alpha[i] = 255
          continue
        }
        if (v === 0) continue
        if (opts.soft) {
          // A soft shadow: darkest under its middle, fading toward its ends.
          let a = x
          while (a > 0 && g[r + a - 1] === C.SHADOW) a--
          let b = x + 1
          while (b < w && g[r + b] === C.SHADOW) b++
          const t = (x + 0.5 - (a + b) / 2) / ((b - a) / 2)
          rgb[i] = 0
          alpha[i] = Math.round(255 * SHADOW_ALPHA * Math.sqrt(Math.max(0.15, 1 - t * t)))
          continue
        }
      }
      alpha[i] = 255
      const base = PALETTE[v]!
      if (body[i] !== 1 || (nx[i] === 0 && ny[i] === 0)) {
        rgb[i] = base
        continue
      }
      // A cell of the bevel: tilt the face by how near the edges it is, and light it.
      const [qx, qy, qz] = norm(nx[i]!, ny[i]!, FLAT)
      const diffuse = Math.max(0, qx * L[0] + qy * L[1] + qz * L[2])
      const gloss = Math.max(0, Math.pow(Math.max(0, qx * HALF[0] + qy * HALF[1] + qz * HALF[2]), GLOSS_POW) * GLOSS - FLAT_GLOSS)
      rgb[i] = scaled(base, AMBIENT + DIFFUSE * diffuse, gloss)
    }
  }

  return { rgb, alpha }
}
