// The critter lives in the app's backdrop and walks the outside of the prompt box:
// up its left side, along its top, down its right side, then back again.
// When Claude is busy it heads for the top of the box (its desk) and acts out the work with a prop.
// Grab it and it dangles from the pointer; let go and it flies, bounces, and floats down under an umbrella.
// Points, y up. Three state texels:
//   0: where on the path, how petted, distance walked, facing
//   1: mode (0 on the path, 1 held, 2 flying, 3 walking the floor back), free x, free y, dizzy seconds left
//   2: velocity x, velocity y, umbrella open, 0
import {
  PI,
  abs,
  atan,
  buffer,
  clamp,
  composer,
  dot,
  dt,
  exp,
  first,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mod,
  normalize,
  pow,
  picture,
  pointers,
  scene,
  shader,
  sin,
  cos,
  size,
  smoothstep,
  sqrt,
  step,
  time,
  values,
  vec2,
  vec3,
  vec4,
} from 'claude-code/shader'
import type { Buffer } from 'claude-code/shader'

// What the mod tells the critter. `prop` names one thing it holds or does, faded in and out by `propOn`
// (the mod changes `prop` only while `propOn` is down, so the eased index never shows a wrong prop);
// `hat` works the same way with `hatOn`.
//   prop: 1 type, 2 read, 3 search, 4 web, 5 shell, 6 think,
//         7 dance, 8 wave, 9 jump, 10 sparkler, 11 nap, 12 zoomies, 13 water, 14 coffee
//   hat:  1 beanie, 2 flower crown, 3 wizard, 4 crown, 5 nightcap, 6 santa, 7 witch
const v = values({
  prop: [0, 14],
  propOn: [0, 1],
  ask: [0, 1],
  feel: [-1, 1],
  hat: [0, 7],
  hatOn: [0, 1],
  sleepy: [0, 1],
})

// How much prop k is showing: 0..1.
function is(k: number): number {
  return v.propOn * (1 - step(0.5, abs(v.prop - k)))
}
function pType(): number {
  return is(1)
}
function pRead(): number {
  return is(2)
}
function pSearch(): number {
  return is(3)
}
function pWeb(): number {
  return is(4)
}
function pShell(): number {
  return is(5)
}
function pThink(): number {
  return is(6)
}
// A reminder (water or coffee) waiting for you.
function reminder(): number {
  return max(is(13), is(14))
}
// A trick that keeps it standing where it is.
function standing(): number {
  return max(max(max(is(7), is(8)), max(is(9), is(10))), is(11))
}
// How much hat k is showing: 0..1.
function hatIs(k: number): number {
  return v.hatOn * (1 - step(0.5, abs(v.hat - k)))
}

const U = 3 // points per sprite pixel; the critter is 13 x 10 of them
const SPEED = 34 // points a second while strolling
const GRAVITY = 1100 // points a second squared
const BOUNCE = 0.45 // how much speed a bounce keeps
const SETTLE = 170 // an impact slower than this lands instead of bouncing
const DAZE = 750 // an impact faster than this leaves it dizzy
const GRAB = 26 // how close to its middle a press picks it up, in points
const CLAY = vec3(0.851, 0.467, 0.341)
const EMBER = vec3(0.78, 0.38, 0.26)
const INK = vec3(0.118, 0.118, 0.114)
const ROSE = vec3(0.898, 0.282, 0.302)
const PAPER = vec3(0.985, 0.98, 0.965)
const STONE = vec3(0.6, 0.59, 0.56)
const NIGHT = vec3(0.16, 0.16, 0.17)
const LEAF = vec3(0.45, 0.82, 0.48)
const SKY = vec3(0.62, 0.8, 0.95)
const GOLD = vec3(0.93, 0.7, 0.29)
const BLUE = vec3(0.36, 0.55, 0.94)

// The prompt box in points.
function box(): vec4 {
  return vec4(composer.x * size.x, composer.y * size.y, composer.z * size.x, composer.w * size.y)
}

// Length of the open path: left side, top, right side.
function pathLength(b: vec4): number {
  return max(1, (b.w - b.y) * 2 + (b.z - b.x))
}

// Where on the path distance d is: feet position in xy, "up" direction in zw.
function placeAt(b: vec4, d: number): vec4 {
  const side = b.w - b.y
  const top = b.z - b.x
  const onLeft = vec4(b.x, b.y + d, -1, 0)
  const onTop = vec4(b.x + (d - side), b.w, 0, 1)
  const onRight = vec4(b.z, b.w - (d - side - top), 1, 0)
  return d < side ? onLeft : d < side + top ? onTop : onRight
}

// How busy Claude is: anything on stage pulls the critter to its desk.
function busy(): number {
  return max(max(max(pType(), pRead()), max(pSearch(), pWeb())), max(max(pShell(), v.ask), max(abs(v.feel), max(pThink(), reminder()))))
}

const state: Buffer = buffer({ size: [3, 1], float: 32, filter: 'nearest' }, p => {
  const s0 = state.at(vec2(0, 0))
  const s1 = state.at(vec2(1, 0))
  const s2 = state.at(vec2(2, 0))
  const b = box()
  const len = pathLength(b)
  const side = b.w - b.y
  const top = b.z - b.x
  const d = first ? side + top * 0.5 : clamp(s0.x, 0, len)
  const rub = first ? 0 : s0.y
  const walked = first ? 0 : s0.z
  const dir = first ? 1 : s0.w < 0 ? -1 : 1
  const mode = first ? 0 : floor(s1.x + 0.5)
  const pos = first ? vec2(0, 0) : vec2(s1.y, s1.z)
  const dizzy = first ? 0 : s1.w
  const vel = first ? vec2(0, 0) : vec2(s2.x, s2.y)
  const umbrella = first ? 0 : s2.z
  const onPath = step(mode, 0.5)

  // Where it is now.
  const at = placeAt(b, d)
  const feet = vec2(mix(pos, vec2(at.x, at.y), onPath))
  const up = vec2(mix(vec2(0, 1), vec2(at.z, at.w), onPath))
  const centre = vec2(feet + up * (U * 5))

  // The pointers: a fresh press on it picks it up; the nearest pressed one carries it; others pet it.
  let grab = 0
  let hover = 0
  let stroke = 0
  let carrier = vec2(0, 0)
  let carrierVel = vec2(0, 0)
  let carrierDist = 100000
  for (const ptr of pointers) {
    const here = step(ptr.gone, 0)
    const pressed = ptr.down * here
    const dist = length(ptr.at - centre)
    grab = max(grab, pressed * step(ptr.age, 0.25) * step(dist, GRAB))
    const hd = dist + (1 - pressed) * 100000
    carrier = hd < carrierDist ? vec2(ptr.at.x, ptr.at.y) : carrier
    carrierVel = hd < carrierDist ? vec2((ptr.at - ptr.was) / max(dt, 0.001)) : carrierVel
    carrierDist = min(carrierDist, hd)
    const near = (1 - smoothstep(18, 34, dist)) * here * (1 - pressed)
    hover = max(hover, near)
    stroke = stroke + near * min(length(ptr.at - ptr.was) / max(dt, 0.001), 600) / 600
  }

  // --- On the path (mode 0): stroll, or head for the desk while Claude is busy; still while dizzy.
  // A reminder brings it to the middle of the top, where you'll see it.
  const work = step(0.5, busy())
  const nearestDesk = clamp(d, side + 24, side + max(top - 24, 24))
  const desk = mix(nearestDesk, side + top * 0.5, step(0.5, reminder()))
  const toDesk = desk - d
  const deskDir = toDesk < 0 ? -1 : 1
  const deskMove = min(abs(toDesk), dt * SPEED * 1.8) * deskDir
  // Zoomies: three times the speed and no rests. Night: half speed. Tricks and naps: stay put.
  const zoom = step(0.5, is(12))
  const rests = mix(step(fract(time / 11), 0.64), 1, zoom)
  const pace = SPEED * mix(1, 3, zoom) * (1 - v.sleepy * 0.5)
  const strolling = rests * (1 - hover) * (1 - step(0.5, standing()))
  const strollMove = dt * pace * strolling * dir
  const calm = step(dizzy, 0)
  const pathMove = mix(strollMove, deskMove, work) * calm
  const pathD = clamp(d + pathMove, 0, len)
  const bounced = pathD >= len ? -1 : pathD <= 0 ? 1 : dir
  const pathDir = work > 0.5 ? (abs(toDesk) > 0.5 ? deskDir : dir) : bounced

  // --- Held (mode 1): dangle from the pointer by the top of its head; let go and it flies.
  const stillHeld = step(carrierDist, 90)
  const heldFeet = vec2(carrier - vec2(0, U * 9))
  const heldVel = vec2(mix(vel, carrierVel, 0.35))

  // --- Flying (mode 2): gravity, walls, ceiling, the top of the prompt box, the floor.
  const high = step(b.w + 70, pos.y) * step(vel.y, -40) * step(abs(vel.x), 500)
  const opened = max(umbrella, high)
  let fv = vec2(vel.x * exp(-dt * opened * 1.6), max(vel.y - GRAVITY * dt, mix(-100000, -70, opened)))
  let fp = vec2(pos + fv * dt)
  const wallL = 14
  const wallR = size.x - 14
  fv = vec2(fp.x < wallL ? abs(fv.x) * BOUNCE : fp.x > wallR ? -abs(fv.x) * BOUNCE : fv.x, fv.y)
  fp = vec2(clamp(fp.x, wallL, wallR), fp.y)
  const ceiling = size.y - U * 12
  fv = vec2(fv.x, fp.y > ceiling ? -abs(fv.y) * BOUNCE : fv.y)
  fp = vec2(fp.x, min(fp.y, ceiling))
  // Onto the top of the prompt box, coming down from above it.
  const overBox = step(b.x, fp.x) * step(fp.x, b.z)
  const hitsBox = overBox * step(b.w - 1, pos.y) * step(fp.y, b.w) * step(fv.y, 0)
  const hitsFloor = step(fp.y, 0) * (1 - hitsBox)
  const landY = hitsBox > 0.5 ? b.w : 0
  const impact = -fv.y * max(hitsBox, hitsFloor)
  const lands = max(hitsBox, hitsFloor) * step(impact, SETTLE)
  const bounces = max(hitsBox, hitsFloor) * (1 - lands)
  fv = vec2(fv.x * mix(1, 0.8, bounces), mix(fv.y, impact * BOUNCE, bounces))
  fp = vec2(fp.x, max(hitsBox, hitsFloor) > 0.5 ? landY : fp.y)
  const knock = step(DAZE, impact)
  const flyUmbrella = opened * (1 - max(hitsBox, hitsFloor))

  // --- Back on the floor (mode 3): walk to the nearer side of the prompt box, then climb on.
  const goLeft = pos.x < (b.x + b.z) * 0.5 ? 1 : 0
  const sideX = goLeft > 0.5 ? b.x : b.z
  const floorDir = sideX < pos.x ? -1 : 1
  const floorStep = min(abs(sideX - pos.x), dt * SPEED * 1.5 * calm) * floorDir
  const floorX = pos.x + floorStep
  const reached = step(abs(sideX - floorX), 1.5)

  // --- Pick the next mode and state.
  const m0 = mode < 0.5 ? 1 : 0
  const m1 = mode > 0.5 && mode < 1.5 ? 1 : 0
  const m2 = mode > 1.5 && mode < 2.5 ? 1 : 0
  const m3 = mode > 2.5 ? 1 : 0
  const picked = grab * (1 - m1)
  const dropped = m1 * (1 - stillHeld)
  const landedTop = m2 * lands * hitsBox
  const landedFloor = m2 * lands * hitsFloor
  const climbed = m3 * reached

  const nextMode =
    picked > 0.5 ? 1
    : dropped > 0.5 ? 2
    : landedTop > 0.5 ? 0
    : landedFloor > 0.5 ? 3
    : climbed > 0.5 ? 0
    : mode

  const nextD =
    landedTop > 0.5 ? side + clamp(fp.x - b.x, 0, top)
    : climbed > 0.5 ? (goLeft > 0.5 ? 0 : len)
    : m0 > 0.5 ? pathD
    : d
  const nextDir =
    climbed > 0.5 ? (goLeft > 0.5 ? 1 : -1)
    : m3 > 0.5 ? floorDir
    : m2 > 0.5 ? (fv.x < 0 ? -1 : 1)
    : m0 > 0.5 ? pathDir
    : dir

  const nextPos =
    picked > 0.5 ? heldFeet
    : m1 > 0.5 ? heldFeet
    : m2 > 0.5 ? fp
    : m3 > 0.5 ? vec2(floorX, 0)
    : feet
  const nextVel =
    picked > 0.5 ? vec2(0, 0)
    : m1 > 0.5 ? (dropped > 0.5 ? vec2(clamp(heldVel.x, -2200, 2200), clamp(heldVel.y, -2200, 2200)) : heldVel)
    : m2 > 0.5 ? fv
    : vec2(0, 0)
  const nextUmbrella = m2 > 0.5 && dropped < 0.5 ? flyUmbrella : 0

  const moved = abs(pathMove) * m0 + abs(floorStep) * m3
  const nextWalked = mod(walked + moved, 1000)
  const nextRub = clamp(rub * exp(-dt * 0.9) + stroke * dt * 2.2, 0, 1.5)
  const nextDizzy = max(knock * m2 * 2.5, max(dizzy - dt, 0))

  const t0 = vec4(nextD, nextRub, nextWalked, nextDir)
  const t1 = vec4(nextMode, nextPos.x, nextPos.y, nextDizzy)
  const t2 = vec4(nextVel.x, nextVel.y, nextUmbrella, 0)
  return p.cell.x < 0.5 ? t0 : p.cell.x < 1.5 ? t1 : t2
})

// iq's heart, scaled to r across.
function heart(q: vec2, r: number): number {
  const raw = vec2(q / r + vec2(0, 0.55))
  const p = vec2(abs(raw.x), raw.y)
  const lobe = length(p - vec2(0.25, 0.75)) - sqrt(2) / 4
  const toTop = vec2(p - vec2(0, 1))
  const toEdge = vec2(p - 0.5 * max(p.x + p.y, 0))
  const tip = sqrt(min(dot(toTop, toTop), dot(toEdge, toEdge))) * (p.x - p.y < 0 ? -1 : 1)
  return (p.y + p.x > 1 ? lobe : tip) * r
}

// 1 inside the grid box [x0,x1) x [y0,y1); rows count down from the top of the critter.
function cells(g: vec2, x0: number, x1: number, y0: number, y1: number): number {
  return step(x0, g.x) * step(g.x, x1 - 0.0001) * step(y0, g.y) * step(g.y, y1 - 0.0001)
}

// A disc of radius r grid pixels.
function disc(g: vec2, cx: number, cy: number, r: number): number {
  return 1 - smoothstep(r - 0.12, r + 0.12, length(g - vec2(cx, cy)))
}

// Distance from g to the segment a-b, in grid pixels.
function segment(g: vec2, a: vec2, b: vec2): number {
  const ab = vec2(b - a)
  const t = clamp(dot(g - a, ab) / dot(ab, ab), 0, 1)
  return length(g - a - ab * t)
}

// The art is painted once a frame into a small texture on the critter's own grid, a quarter of a
// grid pixel to a texel (fine enough for smooth shading), then the full-window picture just looks
// the right texel up. That keeps the per-pixel work tiny, so the critter stays sharp on any GPU.
const TEX = 4 // texels per grid pixel
const COL0 = -6 // the art's grid spans columns -6..24 and rows -16..19
const ROW0 = -16
const ART_W = 120
const ART_H = 140

// Light and depth, in screen directions (x right, y up), turned onto the critter's grid each frame
// so the light stays put when it turns around or climbs a side.
const LIGHT = vec3(-0.5, 0.65, 0.75) // from the top left, toward the viewer
const DEPTH = vec2(0.85, -0.65) // the block's side face shows to the lower right
const SHADOW = vec2(1.7, -1.5) // where its drop shadow falls, in grid pixels

// Signed distance from g to a box with centre c and half-size h, in grid pixels.
function boxDist(g: vec2, c: vec2, h: vec2): number {
  const q = vec2(abs(g - c) - h)
  return length(max(q, vec2(0, 0))) + min(max(q.x, q.y), 0)
}

// 1 while it is off the path: held, flying or walking the floor.
function isFree(): number {
  return step(0.5, state.at(vec2(1, 0)).x)
}

// 1 while it is held or flying.
function isAirborne(): number {
  const mode = state.at(vec2(1, 0)).x
  return step(0.5, mode) * step(mode, 2.5)
}

// Which way is up for the critter this frame: the path's, or leaning into its flight.
function upNow(): vec2 {
  const at = placeAt(box(), state.at(vec2(0, 0)).x)
  const vx = state.at(vec2(2, 0)).x
  const lean = vec2(normalize(vec2(clamp(-vx * 0.0011, -0.6, 0.6), 1)))
  const freeUp = vec2(mix(vec2(0, 1), lean, isAirborne()))
  return vec2(mix(vec2(at.z, at.w), freeUp, isFree()))
}

// Which way it faces this frame.
function fwdNow(): vec2 {
  const up = upNow()
  return vec2(vec2(up.y, -up.x) * state.at(vec2(0, 0)).w)
}

// The critter's feet this frame, in points: on the path (lifted by a hop or its cloud), or free.
function feetNow(): vec2 {
  const s0 = state.at(vec2(0, 0))
  const s1 = state.at(vec2(1, 0))
  const at = placeAt(box(), s0.x)
  const happy = max(smoothstep(0.55, 1.1, s0.y), max(v.feel, 0))
  const lift = pWeb() * (4 + abs(sin(time * 2)) * 0.6)
  const fuss = max(v.ask, reminder()) // something for you: a small bob to catch your eye
  const hop =
    abs(sin(time * 9)) * 6 * happy +
    abs(sin(time * 5)) * 3 * fuss +
    abs(sin(time * 4)) * 15 * is(9) + // jump
    abs(sin(time * 7)) * 3 * is(7) // dance
  const onPath = vec2(vec2(at.x, at.y) + vec2(at.z, at.w) * (hop + lift * U))
  return vec2(mix(onPath, vec2(s1.y, s1.z), isFree()))
}

// The pose, worked out once a frame: texel 0 feet and up, texel 1 facing.
const pose: Buffer = buffer({ size: [2, 1], float: 32, filter: 'nearest' }, p => {
  const f = feetNow()
  const u = upNow()
  const w = fwdNow()
  return p.cell.x < 0.5 ? vec4(f.x, f.y, u.x, u.y) : vec4(w.x, w.y, 0, 1)
})

const art: Buffer = buffer({ size: [ART_W, ART_H], filter: 'nearest' }, p => {
  const cell = vec2(vec2(p.cell.x + 0.5, p.cell.y + 0.5) / TEX + vec2(COL0, ROW0))
  const dance = is(7)
  const nap = is(11)
  const g = vec2(cell.x - sin(time * 5) * 1.2 * dance, cell.y) // dancing sways side to side
  const s0 = state.at(vec2(0, 0))
  const s1 = state.at(vec2(1, 0))
  const s2 = state.at(vec2(2, 0))
  const rub = s0.y
  const walked = s0.z
  const dizzy = smoothstep(0, 0.3, s1.w)
  const air = isAirborne()
  const umbrella = s2.z * air
  const onPath = 1 - isFree()
  const up = upNow()
  const fwd = fwdNow()
  const head = vec2(feetNow() + up * (U * 7))
  const happy = max(smoothstep(0.55, 1.1, rub), max(v.feel, 0)) * (1 - air)
  const sad = max(-v.feel, 0) * onPath
  const web = pWeb() * onPath
  const lift = web * (4 + abs(sin(time * 2)) * 0.6)
  const g0 = vec2(g.x, g.y - lift) // the grid of the ground under it, for the cloud
  const props = onPath * (1 - dizzy) // desk props only while it is on the path and steady

  // Body, side nubs, and legs that step with the distance walked; they dangle in the air.
  const stride = mod(floor(walked / (U * 2.5)), 2)
  const dancing = step(0.5, fract(time * 2.5)) * step(0.5, dance)
  const legA = mix(mix(mix(3 - stride, 3 - dancing, dance), 3, air), 1, nap)
  const legB = mix(mix(mix(2 + stride, 2 + dancing, dance), 3, air), 1, nap)
  const holding = max(max(is(10), reminder()), max(pType(), pShell())) * props // arm out in front
  const typing = max(pType(), pShell()) * props
  const asking = max(v.ask, is(8)) * props // waiting on you, or the wave trick
  const tap = step(0.5, fract(time * 6)) * step(0.5, typing)
  const wave = step(0.5, fract(time * 2.5)) * step(0.5, asking)
  const frontArm = mix(
    cells(g, 12, 13, 3, 5),
    max(cells(g, 12, 15, 4 + tap, 5 + tap), cells(g, 12, 13, 3, 5)),
    step(0.5, holding),
  )
  const raised = max(cells(g, 12 + wave, 13 + wave, -2, 1), cells(g, 12, 13, 0, 5))
  const arm = mix(frontArm, raised, step(0.5, max(asking, umbrella)))
  const body = max(cells(g, 1, 12, 0, 7), max(cells(g, 0, 1, 3, 5), arm))
  const legs = max(
    max(cells(g, 2, 3, 7, 7 + legA), cells(g, 8, 9, 7, 7 + legA)),
    max(cells(g, 4, 5, 7, 7 + legB), cells(g, 10, 11, 7, 7 + legB)),
  )
  const critter = max(body, legs)

  // Eyes look toward the nearest pointer and blink; ^ ^ when happy, low when sad,
  // wide when held or flying, x x when dizzy.
  let look = vec2(fwd * 0.4)
  let nearest = 100000
  for (const ptr of pointers) {
    const dd = length(ptr.at - head) + ptr.gone * 100000
    const toward = vec2((ptr.at - head) / max(length(ptr.at - head), 1))
    look = dd < nearest ? toward : look
    nearest = min(nearest, dd)
  }
  const ex = dot(look, fwd) * 0.5
  const ey = -dot(look, up) * 0.45 + sad * 0.7
  const blink = step(0.965, fract(time / 4.3 + 0.2)) * (1 - air)
  const eyeTop = 2 + ey + blink * 0.8 + sad * 0.4
  const eyeBottom = 4 + ey - blink * 0.8
  const eyes = max(cells(g, 3 + ex, 4 + ex, eyeTop, eyeBottom), cells(g, 9 + ex, 10 + ex, eyeTop, eyeBottom))
  const caret = max(
    max(cells(g, 3, 4, 2, 3), max(cells(g, 2, 3, 3, 4), cells(g, 4, 5, 3, 4))),
    max(cells(g, 9, 10, 2, 3), max(cells(g, 8, 9, 3, 4), cells(g, 10, 11, 3, 4))),
  )
  const wide = max(cells(g, 2.5, 4.5, 1.5, 4.5), cells(g, 8.5, 10.5, 1.5, 4.5))
  const crossed = max(
    max(max(cells(g, 2, 3, 2, 3), cells(g, 4, 5, 2, 3)), max(cells(g, 3, 4, 3, 4), max(cells(g, 2, 3, 4, 5), cells(g, 4, 5, 4, 5)))),
    max(max(cells(g, 8, 9, 2, 3), cells(g, 10, 11, 2, 3)), max(cells(g, 9, 10, 3, 4), max(cells(g, 8, 9, 4, 5), cells(g, 10, 11, 4, 5)))),
  )
  // Sleepy at night: heavy lids. Napping: closed, a line each.
  const lidded = max(cells(g, 3 + ex, 4 + ex, 3, eyeBottom), cells(g, 9 + ex, 10 + ex, 3, eyeBottom))
  const shut = max(cells(g, 2.5, 4.5, 3.2, 3.8), cells(g, 8.5, 10.5, 3.2, 3.8))
  const openEyes = mix(eyes, lidded, step(0.5, v.sleepy))
  const calmEyes = mix(mix(openEyes, caret, step(0.5, max(happy, dance))), shut, step(0.5, nap))
  const eyeMask = mix(mix(calmEyes, wide, step(0.5, air)), crossed, step(0.5, dizzy))

  let color = vec4(0, 0, 0, 0) // straight colour; alpha says how much of it covers the ground

  // Screen directions turned onto the grid: columns run along fwd, rows run down (against up).
  const toGrid = (s: vec2) => vec2(dot(s, fwd), -dot(s, up))
  const shadowAt = vec2(g - toGrid(SHADOW))
  const sideAt = vec2(g - toGrid(DEPTH))

  // A soft drop shadow of its whole shape on the wall behind it, and a contact shadow under its feet.
  const shapeDist = min(boxDist(shadowAt, vec2(6.5, 3.5), vec2(5.5, 3.5)), boxDist(shadowAt, vec2(6.5, 8.5), vec2(4.5, 1.5)))
  const drop = (1 - smoothstep(-0.8, 1.8, shapeDist)) * 0.2
  const feetRoom = vec2((g.x - 6.5) / 6.2, (g.y - 10.1) / 0.9)
  const contact = (1 - smoothstep(0.55, 1, length(feetRoom))) * 0.32 * onPath * (1 - air)
  color = mix(color, vec4(0, 0, 0, 1), max(drop, contact))

  // An umbrella over it while it floats down: a striped canopy on a handle in its raised hand.
  const canopyAt = vec2(g - vec2(10, -3.5))
  const canopy = step(length(canopyAt), 7) * step(canopyAt.y, 0) * step(-6.2, canopyAt.y)
  const panel = mod(floor((atan(-canopyAt.y, canopyAt.x) / PI) * 6), 2)
  const stick = cells(g, 12.2, 12.8, -3.5, 0)
  color = mix(color, vec4(mix(ROSE, PAPER, panel), 1), canopy * umbrella)
  color = mix(color, vec4(INK, 1), stick * umbrella)

  // Behind the critter: its cloud (web), its rain cloud (sad), its spark (thinking).
  const puff = max(max(disc(g0, 2.5, 11, 2.2), disc(g0, 6.5, 10.4, 2.9)), max(disc(g0, 10.5, 11, 2.2), cells(g0, 2, 11, 11, 13)))
  const puffRim = max(max(disc(g0, 2.5, 11, 2.6), disc(g0, 6.5, 10.4, 3.3)), max(disc(g0, 10.5, 11, 2.6), cells(g0, 1.6, 11.4, 11, 13.4)))
  color = mix(color, vec4(STONE, 1), puffRim * web)
  color = mix(color, vec4(PAPER, 1), puff * web)

  const gloom = max(max(disc(g, 4.5, -5, 1.8), disc(g, 7, -5.8, 2.3)), disc(g, 9.5, -5, 1.8))
  color = mix(color, vec4(STONE, 1), gloom * sad)
  for (const i of [0, 1, 2]) {
    const fall = fract(time * 1.4 + i * 0.33)
    const drop = cells(g, 4.8 + i * 2.2, 5.3 + i * 2.2, -3 + fall * 5, -2 + fall * 5)
    color = mix(color, vec4(BLUE, 1), drop * sad * (1 - fall * 0.6))
  }

  const sparkAt = vec2(g - vec2(6.5, -4.2))
  const sparkR = length(sparkAt)
  const spoke = abs(fract(atan(sparkAt.y, sparkAt.x) / (PI / 4) + time * 0.5) - 0.5)
  const spark = step(sparkR, 2.6) * step(0.35, sparkR) * step(spoke, 0.16 * (1 - sparkR / 2.6) + 0.06)
  color = mix(color, vec4(EMBER, 1), spark * pThink() * props * (1 - max(asking, max(happy, sad))))

  // The critter itself, as a block with depth.
  // Its side face: the same shape pushed back, in shadow, showing past the front face's edge.
  const sideBody = max(cells(sideAt, 1, 12, 0, 7), max(cells(sideAt, 0, 1, 3, 5), cells(sideAt, 12, 13, 3, 5)))
  color = mix(color, vec4(CLAY * 0.52, 1), sideBody * (1 - critter))

  // The back legs stand behind: darker, and nudged back along the depth.
  const backAt = vec2(g - toGrid(DEPTH) * 0.6)
  const backLegs = max(cells(backAt, 4, 5, 7, 7 + legB), cells(backAt, 10, 11, 7, 7 + legB))
  color = mix(color, vec4(CLAY * 0.6, 1), backLegs * (1 - body))

  // The front face is a rounded block: its edges bevel away, lit from the top left.
  const BEVEL = 1.5
  const nearLeft = 1 - smoothstep(0, BEVEL, g.x - 1)
  const nearRight = 1 - smoothstep(0, BEVEL, 12 - g.x)
  const nearTop = 1 - smoothstep(0, BEVEL, g.y)
  const nearBottom = 1 - smoothstep(0, BEVEL, 7 - g.y)
  const normal = vec3(normalize(vec3(nearRight - nearLeft, nearBottom - nearTop, 1.15)))
  const lightOnGrid = vec3(normalize(vec3(dot(vec2(LIGHT.x, LIGHT.y), fwd), -dot(vec2(LIGHT.x, LIGHT.y), up), LIGHT.z)))
  const diffuse = max(dot(normal, lightOnGrid), 0)
  const halfway = vec3(normalize(lightOnGrid + vec3(0, 0, 1)))
  const gloss = pow(max(dot(normal, halfway), 0), 28) * 0.32
  const lit = vec3(CLAY * (0.48 + 0.66 * diffuse) + vec3(gloss, gloss, gloss))
  // Front legs: lit like the body's lower edge, a touch darker toward the feet.
  const frontLegs = max(cells(g, 2, 3, 7, 7 + legA), cells(g, 8, 9, 7, 7 + legA))
  const legShade = vec3(CLAY * (0.78 - (g.y - 7) * 0.05))
  color = mix(color, vec4(legShade, 1), frontLegs * (1 - body))
  color = mix(color, vec4(lit, 1), body)

  // Eyes: dark, with a glint toward the light while they're open and round.
  color = mix(color, vec4(INK, 1), eyeMask * body)
  const roundEyes = (1 - step(0.5, max(happy, dance))) * (1 - nap) * (1 - dizzy)
  const glint = max(cells(g, 3.1 + ex, 3.55 + ex, eyeTop + 0.15, eyeTop + 0.6), cells(g, 9.1 + ex, 9.55 + ex, eyeTop + 0.15, eyeTop + 0.6))
  color = mix(color, vec4(PAPER, 1), glint * eyes * roundEyes * body * 0.9)

  // Dizzy: three little stars circling its head.
  for (const i of [0, 1, 2]) {
    const turn = time * 4 + i * 2.094
    const starAt = vec2(g - vec2(6.5 + cos(turn) * 5, -1.8 + sin(turn) * 1.3))
    const star = step(abs(starAt.x) + abs(starAt.y), 0.9)
    color = mix(color, vec4(GOLD, 1), star * dizzy * (1 - critter * step(0, sin(turn))))
  }

  // Typing: a laptop on the desk in front of it.
  const laptopBase = cells(g, 13, 20, 9, 10)
  const laptopLid = cells(g, 18.5, 20, 3.5, 9)
  const laptopGlow = cells(g, 18.5, 19.5, 4, 8.5)
  color = mix(color, vec4(STONE, 1), max(laptopBase, laptopLid) * pType() * props)
  color = mix(color, vec4(SKY, 1), laptopGlow * pType() * props)

  // Running commands: a little terminal with a prompt and a blinking cursor.
  const term = cells(g, 13.5, 21, 3, 10)
  const chevron = max(cells(g, 14.5, 15.5, 4.5, 5.5), max(cells(g, 15.5, 16.5, 5.5, 6.5), cells(g, 14.5, 15.5, 6.5, 7.5)))
  const cursor = cells(g, 17, 19, 6.5, 7.5) * step(0.5, fract(time * 1.2))
  color = mix(color, vec4(NIGHT, 1), term * pShell() * props)
  color = mix(color, vec4(LEAF, 1), max(chevron, cursor) * pShell() * props)

  // Reading: round glasses and an open book.
  const lens = max(disc(g, 3.5, 3, 1.75) - disc(g, 3.5, 3, 1.25), disc(g, 9.5, 3, 1.75) - disc(g, 9.5, 3, 1.25))
  const bridge = cells(g, 5.2, 7.8, 2.5, 3)
  const book = cells(g, 3, 10, 5, 8.5)
  const spine = cells(g, 6, 7, 5, 8.5)
  color = mix(color, vec4(PAPER, 1), book * pRead() * props)
  color = mix(color, vec4(STONE, 1), spine * pRead() * props)
  color = mix(color, vec4(INK, 1), max(lens, bridge) * pRead() * props)

  // Searching: a magnifying glass swept back and forth.
  const sweep = sin(time * 2.2) * 1.4
  const glassC = vec2(15.5 + sweep, 2.5)
  const glassRing = disc(g, glassC.x, glassC.y, 2.3) - disc(g, glassC.x, glassC.y, 1.7)
  const glassLens = disc(g, glassC.x, glassC.y, 1.7)
  const handle = 1 - step(0.5, segment(g, vec2(glassC.x - 1.4, glassC.y + 1.6), vec2(12.8, 6.5)))
  color = mix(color, vec4(SKY, 1), glassLens * 0.55 * pSearch() * props)
  color = mix(color, vec4(INK, 1), max(glassRing, handle) * pSearch() * props)

  // Waiting on you: a speech bubble with a "!" over its waving arm.
  const bubble = disc(g, 6.5, -5.2, 3.1)
  const bubbleRim = disc(g, 6.5, -5.2, 3.6)
  const bang = max(cells(g, 6, 7, -7.5, -4.5), cells(g, 6, 7, -4, -3))
  color = mix(color, vec4(CLAY, 1), bubbleRim * asking)
  color = mix(color, vec4(PAPER, 1), bubble * asking)
  color = mix(color, vec4(INK, 1), bang * asking)

  // Hats: worn on top of its head, set aside for the party hat, the umbrella and the speech bubble.
  const worn = (1 - max(v.feel, 0)) * (1 - umbrella) * (1 - asking)
  const above = -g.y // 0 at the top of its head, growing upward
  // 1 beanie: a knitted dome with a rim and a bobble.
  const beanie = max(disc(g, 6.5, 0.6, 4.4) * step(above, 4) * step(-0.4, above), cells(g, 1.6, 11.4, -0.6, 0.4))
  const bobble = disc(g, 6.5, -4.6, 1)
  color = mix(color, vec4(BLUE, 1), beanie * hatIs(1) * worn)
  color = mix(color, vec4(PAPER, 1), bobble * hatIs(1) * worn)
  // 2 flower crown: a leafy band with four blooms.
  const vine = cells(g, 1.5, 11.5, -0.7, 0.1)
  color = mix(color, vec4(LEAF, 1), vine * hatIs(2) * worn)
  for (const i of [0, 1, 2, 3]) {
    const bloom = disc(g, 2.5 + i * 2.7, -0.8, 0.95)
    const tint = i % 3 === 0 ? ROSE : i % 3 === 1 ? GOLD : PAPER
    color = mix(color, vec4(tint, 1), bloom * hatIs(2) * worn)
  }
  // 3 wizard: a tall purple cone with a gold star.
  const PURPLE = vec3(0.42, 0.33, 0.72)
  const wizard = max(step(0, above) * step(above, 9) * step(abs(g.x - 6.5), (9 - above) / 9 * 4.2), cells(g, 1, 12, -0.6, 0.3))
  const wizStar = step(abs(g.x - 6.5) + abs(g.y + 4), 1.1)
  color = mix(color, vec4(PURPLE, 1), wizard * hatIs(3) * worn)
  color = mix(color, vec4(GOLD, 1), wizStar * hatIs(3) * worn)
  // 4 crown: gold with three points and a red gem.
  const crown = max(cells(g, 3, 10, -2, 0.2), max(cells(g, 3, 4, -3.5, -2), max(cells(g, 6, 7, -3.5, -2), cells(g, 9, 10, -3.5, -2))))
  const gem = disc(g, 6.5, -1, 0.55)
  color = mix(color, vec4(GOLD, 1), crown * hatIs(4) * worn)
  color = mix(color, vec4(ROSE, 1), gem * hatIs(4) * worn)
  // 5 nightcap and 6 santa: a soft cone drooping back over its shoulder, with a bobble.
  const back = vec2(0.5, -4.6) // the tip, drooping behind its head
  const capT = clamp(dot(g - vec2(6.5, -0.4), back - vec2(6.5, -0.4)) / dot(back - vec2(6.5, -0.4), back - vec2(6.5, -0.4)), 0, 1)
  const capD = length(g - mix(vec2(6.5, -0.4), back, capT))
  const cap = step(capD, mix(3.4, 0.6, capT)) * step(-0.4, above)
  const capRim = cells(g, 2.2, 10.8, -0.9, 0.3)
  const capBobble = disc(g, back.x, back.y, 1)
  const NIGHTCAP = vec3(0.46, 0.53, 0.78)
  color = mix(color, vec4(NIGHTCAP, 1), cap * hatIs(5) * worn)
  color = mix(color, vec4(PAPER, 1), capBobble * hatIs(5) * worn)
  color = mix(color, vec4(ROSE, 1), cap * hatIs(6) * worn)
  color = mix(color, vec4(PAPER, 1), max(capRim, capBobble) * hatIs(6) * worn)
  // 7 witch: a wide black brim, a crooked cone, an orange band.
  const brim = cells(g, -0.5, 13.5, -0.8, 0.1)
  const witchCone = step(0, above) * step(above, 8) * step(abs(g.x - 6.5 - above * 0.25), (8 - above) / 8 * 3.2)
  const band = cells(g, 3.4, 9.8, -1.9, -0.9)
  color = mix(color, vec4(NIGHT, 1), max(brim, witchCone) * hatIs(7) * worn)
  color = mix(color, vec4(CLAY, 1), band * hatIs(7) * worn)

  // Tricks.
  // Dance: two music notes bobbing beside it.
  for (const i of [0, 1]) {
    const nx = i < 0.5 ? -2.5 : 15.5
    const ny = -3 + sin(time * 3 + i * 2) * 1.2
    const note = max(disc(g, nx, ny + 2, 0.9), max(cells(g, nx + 0.5, nx + 1, ny - 1.5, ny + 2), cells(g, nx + 0.5, nx + 2, ny - 1.5, ny - 1)))
    color = mix(color, vec4(INK, 1), note * dance * (1 - critter))
  }
  // Sparkler: a stick in its raised-out hand, sparks fanning slowly from the tip.
  const sparkler = is(10) * props
  const stickD = segment(g, vec2(14.5, 4.5), vec2(17.5, -0.5))
  color = mix(color, vec4(STONE, 1), step(stickD, 0.35) * sparkler)
  for (const i of [0, 1, 2, 3, 4, 5]) {
    const life = fract(time * 0.9 + i / 6)
    const angle = i * 1.05 + 0.4
    const sx = 17.5 + cos(angle) * life * 3.5
    const sy = -0.5 - sin(angle) * life * 3.5
    const glint = step(abs(g.x - sx) + abs(g.y - sy), 0.55)
    color = mix(color, vec4(GOLD, 1), glint * sparkler * (1 - life))
  }
  // Nap: a stack of z's drifting up.
  for (const i of [0, 1, 2]) {
    const rise2 = fract(time * 0.35 + i / 3)
    const zx = 11 + i * 1.5 + rise2 * 2
    const zy = -1 - rise2 * 8
    const zz = max(max(cells(g, zx, zx + 2, zy, zy + 0.5), cells(g, zx, zx + 2, zy + 1.5, zy + 2)), step(abs((g.x - zx) - (2 - (g.y - zy))), 0.35) * cells(g, zx, zx + 2, zy, zy + 2))
    color = mix(color, vec4(INK, 0.85), zz * nap * (1 - rise2 * 0.7) * (1 - critter))
  }
  // Zoomies: speed lines behind it.
  const zoomLines = max(cells(g, -5, -1.5, 1.5, 2), max(cells(g, -6, -1.5, 3.5, 4), cells(g, -4.5, -1.5, 5.5, 6)))
  color = mix(color, vec4(STONE, 1), zoomLines * is(12) * props)

  // Reminders: a water bottle held out, or a steaming coffee mug.
  const bottle = cells(g, 13.6, 16.2, 2.2, 9)
  const water = cells(g, 13.9, 15.9, 4.2, 8.7)
  const capTop = cells(g, 14.2, 15.6, 1.2, 2.2)
  color = mix(color, vec4(PAPER, 1), bottle * is(13) * props)
  color = mix(color, vec4(SKY, 1), water * is(13) * props)
  color = mix(color, vec4(BLUE, 1), capTop * is(13) * props)
  const mug = cells(g, 13.5, 17, 5, 9)
  const mugHandle = disc(g, 17.3, 6.8, 1.2) - disc(g, 17.3, 6.8, 0.6)
  const coffee = cells(g, 13.8, 16.7, 5, 5.7)
  color = mix(color, vec4(PAPER, 1), max(mug, mugHandle) * is(14) * props)
  color = mix(color, vec4(EMBER, 1), coffee * is(14) * props)
  for (const i of [0, 1]) {
    const steamX = 14.6 + i * 1.3 + sin(g.y * 1.6 + time * 2 + i) * 0.4
    const steam = cells(g, steamX, steamX + 0.5, 0.5, 4.2)
    color = mix(color, vec4(STONE, 0.7), steam * is(14) * props)
  }

  // A finished reply: a striped party hat and falling confetti.
  const party = max(v.feel, 0) * (1 - umbrella)
  const rise = -g.y // 0 at the top of its head, up to 6 at the hat's tip
  const hat = step(0, rise) * step(rise, 6) * step(abs(g.x - 6.5), (6 - rise) / 6 * 2.6)
  const stripe = step(0.5, fract(rise / 2))
  const pom = disc(g, 6.5, -6.4, 0.85)
  color = mix(color, vec4(mix(GOLD, BLUE, stripe), 1), hat * party)
  color = mix(color, vec4(ROSE, 1), pom * party)
  for (const i of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const fall = fract(time * 0.55 + i * 0.37)
    const across = mod(i * 3.7, 22) - 4 + sin(time * 2 + i) * 0.8
    const bit = cells(g, across, across + 1, -9 + fall * 20, -8 + fall * 20)
    const tint = i % 3 === 0 ? GOLD : i % 3 === 1 ? BLUE : ROSE
    color = mix(color, vec4(tint, 1), bit * party * (1 - critter))
  }

  // Hearts rise from its head while it is being petted.
  const petted = smoothstep(0.15, 0.6, rub)
  for (const i of [0, 1, 2]) {
    const phase = fract(time * 0.8 + i / 3)
    const spotX = 6.5 + (i - 1) * 3 + sin(phase * 6 + i)
    const spotY = -3 - phase * 8.7
    const shape = vec2(g.x - spotX, spotY - g.y) // rows grow downward; the heart wants y up
    const inside = 1 - step(0, heart(shape, 2.4))
    color = mix(color, vec4(ROSE, 1), inside * petted * (1 - phase) * (1 - critter))
  }

  return color
})

const main = picture(p => {
  // The ground of the still picture, painted over all of it so its sitting critter hides while this one plays.
  const ground = scene.sample(vec2(0.01, 0.5))
  const p0 = pose.at(vec2(0, 0))
  const p1 = pose.at(vec2(1, 0))
  const up = vec2(p0.z, p0.w)
  const fwd = vec2(p1.x, p1.y)
  const toPixel = vec2(p.point - vec2(p0.x, p0.y))
  const g = vec2(dot(toPixel, fwd) / U + 6.5, 10 - dot(toPixel, up) / U)
  const local = vec2((g - vec2(COL0, ROW0)) * TEX)
  const inside = step(0, local.x) * step(0, local.y) * step(local.x, ART_W - 0.001) * step(local.y, ART_H - 0.001)
  const ink = art.at(floor(local))
  const cover = ink.w * inside
  return vec4(vec3(ground.x, ground.y, ground.z) * (1 - cover) + vec3(ink.x, ink.y, ink.z) * cover, 1)
})

export default shader({ fps: 30, passes: [state, pose, art, main] })
