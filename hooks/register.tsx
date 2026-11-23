import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CritterAct, CritterReminder, CritterSettings, CritterShown, CritterSky, CritterStats } from '../types'
import type { Prop } from './critter-art'
import { PICTURE_SIZES, SIZES, Walker, bodyRows, picture, render, spriteCols, stripRows } from './terminal'
import type { Look } from './terminal'
import type { WalkInput } from './terminal'

// ---- State: the session's, mirrored to the store for what lasts across sessions.
const isAway = atom({ plugin: 'desk-critter', key: 'isAway' } as const, false)
const act = atom({ plugin: 'desk-critter', key: 'act' } as const, 'idle' as CritterAct)
const isAsking = atom({ plugin: 'desk-critter', key: 'isAsking' } as const, false)
const feel = atom({ plugin: 'desk-critter', key: 'feel' } as const, 0)
const trick = atom({ plugin: 'desk-critter', key: 'trick' } as const, 0)
const reminder = atom({ plugin: 'desk-critter', key: 'reminder' } as const, 'none' as CritterReminder)
const FRESH_STATS: CritterStats = { xp: 0, turns: 0, tools: 0, sessions: 0, streak: 0, lastDay: '' }
const stats = atom({ plugin: 'desk-critter', key: 'stats' } as const, FRESH_STATS, { shape: 'stats-1' })
const DEFAULT_SETTINGS: CritterSettings = { hat: 'auto', water: 45, rest: 0, size: 1 }
const settings = atom({ plugin: 'desk-critter', key: 'settings' } as const, DEFAULT_SETTINGS, { shape: 'settings-2' })
const shown = atom({ plugin: 'desk-critter', key: 'shown' } as const, { prop: 0, propOn: 0, hat: 0, hatOn: 0 } as CritterShown, {
  shape: 'shown-1',
})
const sky = atom({ plugin: 'desk-critter', key: 'sky' } as const, { hour: 12, month: 1 } as CritterSky, { shape: 'sky-1' })

const SCENE = 'critter'
const PANE = 'desk-critter'
// No frosting: the ground is already the app's plain colour, and frosting blurs and fades the critter.
const GLASS = { blur: 0, opacity: 0 }
const LINGER_MS = 1200 // a prop stays this long after its tool ends, so quick runs of tools don't flicker
const FEEL_MS = 4500 // how long the party or the rain cloud lasts after a turn
const SHOW_MS = 6000 // how long a trick or a preview lasts
const FADE_MS = 350 // a prop or hat fades out, changes, then fades in
const SKY_MS = 10 * 60 * 1000 // how often it checks the time of day

// The shader's prop numbers.
const ACT_PROP: Record<CritterAct, number> = { idle: 0, type: 1, read: 2, search: 3, web: 4, shell: 5, think: 6 }
const TRICKS = [
  { name: 'dance', prop: 7, label: 'Dance', ms: SHOW_MS },
  { name: 'wave', prop: 8, label: 'Wave', ms: SHOW_MS },
  { name: 'jump', prop: 9, label: 'Jump', ms: 4000 },
  { name: 'sparkler', prop: 10, label: 'Sparkler', ms: 8000 },
  { name: 'nap', prop: 11, label: 'Nap', ms: 30000 },
  { name: 'zoomies', prop: 12, label: 'Zoomies', ms: 8000 },
] as const
const REMINDER_PROP: Record<CritterReminder, number> = { none: 0, water: 13, rest: 14 }

// The wardrobe, and the level each hat unlocks at.
const HATS = [
  { id: 1, name: 'Beanie', level: 1 },
  { id: 2, name: 'Flower crown', level: 2 },
  { id: 4, name: 'Crown', level: 4 },
  { id: 3, name: 'Wizard hat', level: 6 },
  { id: 5, name: 'Nightcap', level: 0 },
  { id: 6, name: 'Santa hat', level: 8 },
  { id: 7, name: 'Witch hat', level: 8 },
] as const

// ---- Levels: 25 xp for level 1, then each level needs more.
function levelOf(xp: number): number {
  return Math.floor(Math.sqrt(xp / 25))
}
function xpFor(level: number): number {
  return 25 * level * level
}

// ---- Time: a local day string, and whether it is night.
function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function isNight(s: CritterSky): boolean {
  return s.hour >= 22 || s.hour < 6
}

// Which hat it wears: your pick, or on Auto the season's (December, October) or a nightcap at night.
function hatFor(pick: CritterSettings['hat'], s: CritterSky): number {
  if (pick !== 'auto') return pick
  if (s.month === 12) return 6
  if (s.month === 10) return 7
  return isNight(s) ? 5 : 0
}

// Which prop it shows: a reminder first, then a trick, then what Claude is doing.
async function propWanted($: EngineInterface): Promise<number> {
  const r = await read($, reminder)
  if (r !== 'none') return REMINDER_PROP[r]
  const t = await read($, trick)
  if (t > 0) return t
  return ACT_PROP[await read($, act)]
}

// ---- Timers die with the module at a reload; everything they act on is in $.state or the store.
let lingerTimer: Timer | undefined
let feelTimer: Timer | undefined
let trickTimer: Timer | undefined
let stageTimer: Timer | undefined
let waterTimer: Timer | undefined
let restTimer: Timer | undefined
let skyTimer: Timer | undefined

// One step toward what the critter should show: a change of prop or hat only while it is faded out.
async function stage($: EngineInterface): Promise<void> {
  stageTimer?.cancel()
  stageTimer = undefined
  await wake($)
  const wantProp = await propWanted($)
  const wantHat = hatFor((await read($, settings)).hat, await read($, sky))
  const now = await read($, shown)
  let next = now
  if (now.prop !== wantProp) next = now.propOn > 0 ? { ...next, propOn: 0 } : { ...next, prop: wantProp }
  else if (now.propOn !== (wantProp > 0 ? 1 : 0)) next = { ...next, propOn: wantProp > 0 ? 1 : 0 }
  if (now.hat !== wantHat) next = now.hatOn > 0 ? { ...next, hatOn: 0 } : { ...next, hat: wantHat }
  else if (now.hatOn !== (wantHat > 0 ? 1 : 0)) next = { ...next, hatOn: wantHat > 0 ? 1 : 0 }
  if (next === now) return
  await update($, shown, () => next)
  stageTimer = $.clock.after(FADE_MS, () => void stage($))
}

async function setAct($: EngineInterface, next: CritterAct) {
  lingerTimer?.cancel()
  lingerTimer = undefined
  if ((await read($, act)) !== next) {
    await update($, act, () => next)
    await stage($)
  }
}

async function setFeel($: EngineInterface, value: number, ms = FEEL_MS) {
  feelTimer?.cancel()
  await wake($)
  await update($, feel, () => value)
  feelTimer = $.clock.after(ms, () => void update($, feel, () => 0))
}

async function doTrick($: EngineInterface, prop: number, ms: number) {
  trickTimer?.cancel()
  await update($, trick, () => prop)
  await stage($)
  trickTimer = $.clock.after(ms, () => {
    void update($, trick, () => 0).then(() => stage($))
  })
}

// ---- Stats: kept in the store, so the critter grows across sessions.
async function saveStats($: EngineInterface) {
  await $.store.set('stats', await read($, stats))
}

async function gainXp($: EngineInterface, amount: number) {
  const before = levelOf((await read($, stats)).xp)
  const after = await update($, stats, s => ({ ...s, xp: s.xp + amount }))
  const level = levelOf(after.xp)
  if (level > before) {
    await $.ui.toast(`Your critter reached level ${level}!`)
    await doTrick($, 9, 4000)
  }
}

// ---- Reminders: water and rest, each on its own timer; one waits until you press Done.
function minutes(n: number): number {
  return n * 60 * 1000
}

async function remind($: EngineInterface, kind: Exclude<CritterReminder, 'none'>) {
  if ((await read($, reminder)) !== 'none') {
    // One at a time: try again in a minute.
    const retry = $.clock.after(minutes(1), () => void remind($, kind))
    if (kind === 'water') waterTimer = retry
    else restTimer = retry
    return
  }
  await update($, reminder, () => kind)
  await $.store.set('reminder', kind)
  await stage($)
}

async function scheduleReminders($: EngineInterface) {
  waterTimer?.cancel()
  restTimer?.cancel()
  const s = await read($, settings)
  waterTimer = s.water > 0 ? $.clock.after(minutes(s.water), () => void remind($, 'water')) : undefined
  restTimer = s.rest > 0 ? $.clock.after(minutes(s.rest), () => void remind($, 'rest')) : undefined
}

async function finishReminder($: EngineInterface, isSnooze: boolean) {
  const was = await read($, reminder)
  if (was === 'none') return
  await update($, reminder, () => 'none')
  await $.store.delete('reminder')
  await stage($)
  if (isSnooze) {
    const later = $.clock.after(minutes(10), () => void remind($, was))
    if (was === 'water') waterTimer = later
    else restTimer = later
    return
  }
  await gainXp($, 3)
  await saveStats($)
  await scheduleReminders($)
}

async function changeSettings($: EngineInterface, change: (s: CritterSettings) => CritterSettings) {
  const next = await update($, settings, change)
  await $.store.set('settings', next)
  await stage($)
  await scheduleReminders($)
}

// ---- The sky: the local hour and month, checked now and then.
async function checkSky($: EngineInterface) {
  const d = new Date(await $.clock.now())
  await update($, sky, () => ({ hour: d.getHours(), month: d.getMonth() + 1 }))
  await stage($)
}

async function arrive($: EngineInterface) {
  return $.theme.set({ backdrop: { scene: SCENE, glass: GLASS } })
}

async function toggleAway($: EngineInterface): Promise<boolean> {
  const away = await update($, isAway, a => !a)
  if (away) await $.theme.clear()
  else await arrive($)
  return away
}

// ---- The finished picture shown where no shader plays (Reduce Motion, mobile, a refused or slow shader).
const CRITTER_PIXELS =
  '<rect x="1" y="0" width="11" height="7"/><rect x="0" y="3" width="1" height="2"/><rect x="12" y="3" width="1" height="2"/>' +
  '<rect x="2" y="7" width="1" height="3"/><rect x="4" y="7" width="1" height="3"/><rect x="8" y="7" width="1" height="3"/><rect x="10" y="7" width="1" height="3"/>'
const FALLBACK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">' +
  '<style>.ground{fill:#F5F4EE}@media (prefers-color-scheme: dark){.ground{fill:#262624}}</style>' +
  '<rect class="ground" x="0" y="0" width="1600" height="1000"/>' +
  '<svg x="0" y="0" width="1600" height="1000" viewBox="0 0 400 250" preserveAspectRatio="xMaxYMin meet">' +
  '<g transform="translate(372,34) scale(1.5)" shape-rendering="crispEdges">' +
  `<g fill="#D97757">${CRITTER_PIXELS}</g>` +
  '<g fill="#1F1E1D"><rect x="3" y="3" width="1" height="1"/><rect x="9" y="3" width="1" height="1"/></g>' +
  '</g></svg></svg>'

// ---- /critter: open the pane, send it away, or preview a prop or trick.
const PREVIEWS = ['type', 'read', 'search', 'web', 'shell', 'think', 'ask', 'party', 'sad', 'water', 'coffee'] as const

async function critterCommand($: EngineInterface, word: string): Promise<{ text: string }> {
  if (word === '' || word === 'stats') {
    await $.ui.open({ id: PANE, title: 'Critter' })
    return { text: 'Critter pane opened.' }
  }
  if (word === 'size' || word.startsWith('size ')) {
    const n = Number(word.slice(4).trim())
    if (word === 'size') return { text: `Your critter is size ${(await read($, settings)).size} in the terminal (1 to 4).` }
    if (!Number.isInteger(n) || n < SIZE_MIN || n > SIZE_MAX) return { text: 'Pick a size from 1 to 4, like /critter size 2.' }
    await changeSettings($, c => ({ ...c, size: n }))
    return { text: `Your critter is now size ${n} in the terminal. Where that does not fit, it uses the biggest size that does.` }
  }
  if (word === 'away') {
    return { text: (await toggleAway($)) ? 'Your critter went off to nap. /critter away brings it back.' : 'Your critter is back around your prompt.' }
  }
  const t = TRICKS.find(one => one.name === word)
  const isPreview = (PREVIEWS as readonly string[]).includes(word)
  if (t === undefined && !isPreview) {
    const names = [...TRICKS.map(one => one.name), ...PREVIEWS].join(', ')
    return { text: `Try /critter (the pane), /critter away, /critter size 1-4, or /critter followed by one of: ${names}.` }
  }
  if (await read($, isAway)) await toggleAway($)
  if (t !== undefined) await doTrick($, t.prop, t.ms)
  else if (word === 'party' || word === 'sad') await setFeel($, word === 'party' ? 1 : -1, SHOW_MS)
  else if (word === 'ask') {
    await update($, isAsking, () => true)
    lingerTimer?.cancel()
    lingerTimer = $.clock.after(SHOW_MS, () => void update($, isAsking, () => false))
  } else if (word === 'water' || word === 'coffee') await doTrick($, word === 'water' ? 13 : 14, SHOW_MS)
  else await doTrick($, ACT_PROP[word as CritterAct], SHOW_MS)
  return { text: `Showing "${word}" for a few seconds.` }
}

// Which prop a tool gets.
function actFor(tool: string): CritterAct {
  const t = tool.toLowerCase()
  if (['edit', 'write', 'multiedit', 'notebookedit'].includes(t)) return 'type'
  if (t === 'read') return 'read'
  if (['grep', 'glob', 'ls', 'toolsearch'].includes(t)) return 'search'
  if (t === 'webfetch' || t === 'websearch' || t.includes('browser') || t.includes('chrome')) return 'web'
  if (['bash', 'powershell', 'bashoutput', 'monitor', 'killshell'].includes(t)) return 'shell'
  return 'think'
}

// ---- The terminal: no backdrop there, so the critter walks a strip above the prompt, drawn in half blocks.
const STRIP_KEY = 'desk-critter'
const TICK_MS = 125
const SLEEP_TICK_MS = 1000 // asleep, only its z's move
const CAPTION_GAP = 2
const SIZE_MIN = 1
const SIZE_MAX = 4
// The shader's prop numbers, as the painter's props.
const PROP_OF: Record<number, Prop> = {
  1: 'type',
  2: 'read',
  3: 'search',
  4: 'web',
  5: 'shell',
  6: 'think',
  7: 'dance',
  8: 'wave',
  9: 'jump',
  10: 'sparkler',
  11: 'nap',
  12: 'zoomies',
  13: 'water',
  14: 'coffee',
}
const DOING: Record<CritterAct, string> = {
  idle: 'idle',
  think: 'thinking',
  type: 'typing',
  read: 'reading',
  search: 'searching',
  web: 'on the web',
  shell: 'running a command',
}

// Session-only: where it is in its lane. Everything that lasts is in the atoms, shared with the desktop.
const walker = new Walker()
// The strip as last drawn; null while none is on screen, which also stops the tick.
// `look` is how the shown size draws; `shown` that size (1-4), `size` the one picked.
let strip: { requestId: string; laneLeft: number; laneCols: number; rows: number; look: Look; shown: number; size: number; caption: string; pic: boolean } | null = null
// Whether this terminal shows real pictures: unknown until the first strip, false for the session once one is refused.
let pictures: boolean | null = null
let tickTimer: Timer | undefined
let tickEvery = 0
let lastFrame = ''

type Scene = { input: WalkInput; act: Prop; feel: number; asking: boolean; hat: number; level: number; size: number; idle: string }

// The atoms as last read: reading them all on every tick costs more than painting, so a tick reuses
// this for up to a second, and anything that wakes the critter (a change of act, feel, trick,
// reminder, asking) drops it.
let cached: { at: number; scene: Scene } | null = null
const SCENE_FOR_MS = 1000

async function sceneNow($: EngineInterface, laneCols: number): Promise<Scene> {
  const now = await $.clock.now()
  if (cached !== null && now - cached.at < SCENE_FOR_MS) {
    return { ...cached.scene, input: { ...cached.scene.input, now, laneCols } }
  }
  const scene = await readScene($, now, laneCols)
  cached = { at: now, scene }
  return scene
}

async function readScene($: EngineInterface, now: number, laneCols: number): Promise<Scene> {
  const a = await read($, act)
  const s = await read($, sky)
  const r = await read($, reminder)
  const asking = await read($, isAsking)
  const input: WalkInput = {
    now,
    laneCols,
    busy: a !== 'idle',
    night: isNight(s),
    trick: PROP_OF[await read($, trick)] ?? 'none',
    reminder: r,
    zoom: false,
  }
  return {
    input,
    act: a === 'idle' ? 'none' : a,
    feel: await read($, feel),
    asking,
    hat: hatFor((await read($, settings)).hat, s),
    level: levelOf((await read($, stats)).xp),
    size: Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round((await read($, settings)).size || 1))),
    idle: asking ? 'waiting on you' : DOING[a],
  }
}

/** One line: its name, level, what it is up to, and its size when that is not the one picked. */
const captionOf = (sc: Scene, shown = sc.size) =>
  `critter Lv ${sc.level} · ${walker.sleeping ? 'asleep' : sc.idle}${shown !== sc.size ? ` · size ${shown}` : ''}`

/** What the walk needs to know of a look: its speed, its width, and how far its props reach when it faces left. */
const fit = (look: Look) => ({
  scale: look.scale,
  sprite: spriteCols(look),
  reach: Math.ceil((look.art.w - 2 * look.art.mid) * look.scale),
})

const toBase64 = (bytes: Uint8Array) => (bytes as unknown as { toBase64: () => string }).toBase64()

/** The frame: the Raster's cells, or the Image's RGBA, base64; `data` tells one frame from the next. */
function frameOf(sc: Scene, rows: number, look: Look, pic: boolean): { data: string; width: number; height: number } {
  const pose = walker.pose(sc.input, sc.act, sc.feel, sc.asking, sc.hat)
  if (pic) {
    const { rgba, width, height } = picture(look.paint(pose), sc.input.laneCols, rows, walker.x, walker.facing < 0, look.scale, look.art)
    return { data: toBase64(rgba), width, height }
  }
  const cells = render(look, pose, sc.input.laneCols, rows, walker.x, walker.facing < 0)
  return { data: toBase64(new Uint8Array(cells.buffer)), width: 0, height: 0 }
}

/**
 * Terminals that draw a mod's Image: kitty, Ghostty, iTerm2 and WezTerm, by the variables they set.
 * Windows Terminal and the rest get the text critter; so does any terminal that refuses a picture.
 */
async function canShowPictures($: EngineInterface): Promise<boolean> {
  if (pictures !== null) return pictures
  // Each name is spelled out: the engine lists the variables a module reads from its calls.
  const or = (p: Promise<string | undefined>) => Promise.resolve(p).then(v => v ?? '', () => '')
  const term = await or($.env.get('TERM'))
  const program = await or($.env.get('TERM_PROGRAM'))
  const kitty = await or($.env.get('KITTY_WINDOW_ID'))
  pictures = kitty !== '' || term.includes('kitty') || term.includes('ghostty') || ['ghostty', 'iTerm.app', 'WezTerm'].includes(program)
  return pictures
}

function stopTick() {
  tickTimer?.cancel()
  tickTimer = undefined
  tickEvery = 0
}

/** Tick fast while it is awake, slowly while it sleeps, not at all with no strip. */
function pace($: EngineInterface) {
  if (strip === null) return stopTick()
  const want = walker.sleeping ? SLEEP_TICK_MS : TICK_MS
  if (tickTimer !== undefined && tickEvery === want) return
  tickTimer?.cancel()
  tickEvery = want
  tickTimer = $.clock.every(want, () => void tick($))
}

async function tick($: EngineInterface) {
  const now = strip
  if (now === null) return stopTick()
  const base = await sceneNow($, now.laneCols)
  const sc = { ...base, input: { ...base.input, ...fit(now.look) } }
  walker.step(sc.input)
  if (captionOf(sc, now.shown) !== now.caption || sc.size !== now.size) {
    // The caption and the size set the layout, so a change to either is a new render rather than a blit.
    $.ui.invalidate('ui.render')
  } else {
    const frame = frameOf(sc, now.rows, now.look, now.pic)
    if (frame.data !== lastFrame) {
      lastFrame = frame.data
      const what = now.pic ? { source: { rgba: frame.data, width: frame.width, height: frame.height } } : { cells: frame.data }
      const done: { deny?: string } | undefined = await Promise.resolve($.ui.blit({ requestId: now.requestId, key: STRIP_KEY, columns: now.laneCols, rows: now.rows, ...what } as any)).catch(() => {
        strip = null // the strip is gone: stop until it is drawn again
        return undefined
      })
      if (now.pic && done?.deny !== undefined) {
        // The terminal draws the Image's alt: it cannot show pictures, so the text critter it is.
        pictures = false
        $.ui.invalidate('ui.render')
      }
    }
  }
  pace($)
}

/** Something happened: wake it, and get the tick going if a strip is up. */
async function wake($: EngineInterface) {
  cached = null
  walker.poke(await $.clock.now())
  pace($)
}

/** A click in the strip, by strip column: on the critter, it gets petted. */
async function touched($: EngineInterface, x: number): Promise<boolean> {
  if (strip === null) return false
  // The body's columns in its painting, the same either way it faces.
  const { art, scale } = strip.look
  const at = (x - strip.laneLeft - walker.x) / scale
  if (at < art.bodyFrom - 1 || at > art.bodyTo + 1) return false
  cached = null
  walker.pet(await $.clock.now())
  pace($)
  return true
}

/** About how many terminal rows a rendered tree takes. */
function rowsOf(node: unknown): number {
  if (node === null || node === undefined || node === false) return 0
  if (Array.isArray(node)) return node.reduce((sum: number, n) => sum + rowsOf(n), 0)
  if (typeof node === 'string' || typeof node === 'number') return String(node).split('\n').length
  const el = node as { type?: unknown; props?: Record<string, any>; children?: unknown[] }
  const p = el.props ?? {}
  if (p.position === 'absolute') return 0
  if (typeof p.height === 'number') return p.height
  if (el.type === 'Raster' || el.type === 'Image') return typeof p.rows === 'number' ? p.rows : 0
  const kids = el.children ?? (p.children === undefined ? [] : [p.children].flat())
  if (el.type === 'Text') return Math.max(1, kids.map(k => (typeof k === 'string' ? k : '')).join('').split('\n').length)
  const heights = kids.map(rowsOf)
  return p.flexDirection === 'column' ? heights.reduce((a, b) => a + b, 0) : Math.max(0, ...heights)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Put the critter on screen first: the backdrop doesn't wait for the rest of the session
    // (every MCP server connecting, slow ones timing out) nor for the stats and reminders below.
    // A theme set before the app attaches is held for it; one that went nowhere is set again at the end.
    let isUp = false
    if (!(await read($, isAway))) {
      const early = await arrive($).catch(() => undefined)
      isUp = early !== undefined && (early.isDrawn || early.requestId !== undefined)
    }
    const done = await next(e)
    await $.command.register({
      name: 'critter',
      description: 'Your desk critter: /critter opens its pane; /critter away sends it off; /critter <trick or prop> plays one',
      argumentHint: '[away|size 1-4|dance|wave|jump|sparkler|nap|zoomies|type|read|search|web|shell|think|ask|party|sad|water|coffee]',
    })

    // Bring back what lasts across sessions.
    const savedStats = (await $.store.get('stats')) as Partial<CritterStats> | undefined
    const savedSettings = (await $.store.get('settings')) as Partial<CritterSettings> | undefined
    const savedReminder = (await $.store.get('reminder')) as CritterReminder | undefined
    await update($, settings, () => ({ ...DEFAULT_SETTINGS, ...(savedSettings ?? {}) }))
    const today = dayOf(await $.clock.now())
    const yesterday = dayOf((await $.clock.now()) - 24 * 60 * 60 * 1000)
    await update($, stats, () => {
      const s = { ...FRESH_STATS, ...(savedStats ?? {}) }
      const streak = s.lastDay === today ? s.streak : s.lastDay === yesterday ? s.streak + 1 : 1
      return { ...s, sessions: s.sessions + 1, streak, lastDay: today, xp: s.xp + 2 }
    })
    await saveStats($)
    await update($, reminder, () => savedReminder ?? 'none')

    await update($, act, () => 'idle')
    await update($, isAsking, () => false)
    await update($, feel, () => 0)
    await update($, trick, () => 0)
    await checkSky($)
    skyTimer?.cancel()
    skyTimer = $.clock.every(SKY_MS, () => void checkSky($))
    await scheduleReminders($)
    if (!isUp && !(await read($, isAway))) await arrive($)
    return done
  })

  on('command.run', { command: 'critter' }, async ($, e) => critterCommand($, e.args.trim().toLowerCase()))

  // A turn starts: it thinks.
  on('prompt.submit', async ($, e, next) => {
    await setAct($, 'think')
    await update($, isAsking, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Each tool, as the settings hooks see it: these events leave how the tool runs untouched.
  on('classic.PreToolUse', async ($, e, next) => {
    await setAct($, actFor(e.tool))
    await update($, stats, s => ({ ...s, tools: s.tools + 1 }))
    await gainXp($, 1)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUse', async ($, e, next) => {
    await update($, isAsking, () => false)
    lingerTimer?.cancel()
    lingerTimer = $.clock.after(LINGER_MS, () => void setAct($, 'think'))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUseFailure', async ($, e, next) => {
    await update($, isAsking, () => false)
    lingerTimer?.cancel()
    lingerTimer = $.clock.after(LINGER_MS, () => void setAct($, 'think'))
    return next(e)
  }).catch(($, e, next) => next(e))

  // A permission prompt is waiting on you: it waves you over.
  on('classic.PermissionRequest', async ($, e, next) => {
    await update($, isAsking, () => true)
    await wake($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionDenied', async ($, e, next) => {
    await update($, isAsking, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The turn ends: a party for a reply, a rain cloud for a refusal or an error; replies earn xp.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    await setAct($, 'idle')
    await update($, isAsking, () => false)
    if (e.reason === 'answer') {
      await setFeel($, 1)
      await update($, stats, s => ({ ...s, turns: s.turns + 1 }))
      await gainXp($, 5)
    } else if (e.reason === 'refusal' || e.reason === 'error') await setFeel($, -1)
    await saveStats($)
    return done
  })

  // The backdrop: the critter's shader over a finished picture.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== 'desk-critter' || e.props.scene !== SCENE) return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const s = await read($, shown)
    const values = {
      prop: s.prop,
      propOn: s.propOn,
      ask: (await read($, isAsking)) ? 1 : 0,
      feel: await read($, feel),
      hat: s.hat,
      hatOn: s.hatOn,
      sleepy: isNight(await read($, sky)) ? 1 : 0,
    }
    const { Shader, Svg } = $.ui.resolve(e) as any
    return (
      <Shader module="./critter-shader.ts" values={values}>
        <Svg source={FALLBACK} alt="A small orange pixel critter sitting in the corner" isInteractive />
      </Shader>
    )
  })

  // Above the prompt: in a terminal, the critter's strip; everywhere, a reminder waiting for Done.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isCollapsed) {
      strip = null
      return next(e)
    }
    const below = await next(e)
    const { Box, Text, Button, Raster, Image, Client } = $.ui.resolve(e) as any
    const r = await read($, reminder)
    const words = r === 'water' ? 'Your critter brought you some water. Take a sip?' : 'Your critter made coffee. Time for a short break?'
    const line =
      r === 'none' ? null : (
        <Box flexDirection="row" gap={1}>
          <Text>{words}</Text>
          <Button key="done" variant="primary" onPress={() => void finishReminder($, false)}>
            Done
          </Button>
          <Button key="later" onPress={() => void finishReminder($, true)}>
            In 10 minutes
          </Button>
        </Box>
      )

    let top: unknown = null
    strip = null
    if (e.surface === 'terminal' && !(await read($, isAway))) {
      const cols = Math.max(1, Math.min(512, Number((e.props as any).bodyColumns) || 80))
      const room = Number((e.props as any).maxRows ?? stripRows(SIZES[0]!)) - rowsOf(below) - (line === null ? 0 : 1)
      const probe = await sceneNow($, cols)
      const pic = await canShowPictures($)
      const sizes = pic ? PICTURE_SIZES : SIZES
      walker.settle(probe.input) // asleep or not by now, before the caption says which
      // The size picked, or the biggest one that fits: a whole critter, never one cut in half.
      const layout = (shown: number) => {
        const look = sizes[shown - 1]!
        const caption = captionOf(probe, shown)
        const captionCols = Math.min(caption.length, Math.max(0, cols - 1))
        const laneLeft = Math.min(cols, captionCols + CAPTION_GAP)
        const laneCols = Math.max(0, cols - laneLeft)
        const fits = shown === 1 || (room >= bodyRows(look) && laneCols >= spriteCols(look))
        return { shown, look, caption, captionCols, laneLeft, laneCols, fits }
      }
      let pick = layout(probe.size)
      while (!pick.fits) pick = layout(pick.shown - 1)
      const { shown, look, caption, captionCols, laneLeft, laneCols } = pick
      if (room >= bodyRows(look)) {
        const rows = Math.min(stripRows(look), room)
        const sc = { ...probe, input: { ...probe.input, laneCols, ...fit(look) } }
        walker.settle(sc.input) // keeps x inside a lane that may have just shrunk
        strip = { requestId: e.requestId, laneLeft, laneCols, rows, look, shown, size: probe.size, caption, pic }
        const frame = frameOf(sc, rows, look, pic)
        lastFrame = frame.data
        top = (
          <Box width={cols} height={rows}>
            <Box position="absolute" bottom={0} left={0} width={captionCols}>
              <Text wrap="truncate" dimColor>
                {caption}
              </Text>
            </Box>
            <Box position="absolute" bottom={0} left={laneLeft}>
              {pic ? (
                <Image key={STRIP_KEY} columns={laneCols} rows={rows} source={{ rgba: frame.data, width: frame.width, height: frame.height }} alt=" " />
              ) : (
                <Raster key={STRIP_KEY} columns={laneCols} rows={rows} cells={frame.data} />
              )}
            </Box>
            <Box position="absolute" top={0} left={0}>
              <Client key="touch" module="./touch.tsx" width={cols} height={rows} />
            </Box>
          </Box>
        )
      } else if (room >= 1) {
        top = (
          <Text wrap="truncate" dimColor>
            {caption}
          </Text>
        )
      }
    }
    pace($)
    if (top === null && line === null) return below
    return (
      <Box flexDirection="column">
        {top}
        {line}
        {below}
      </Box>
    )
  })

  // A click on the strip, from touch.tsx.
  on('ui.message', async ($, e, next) => {
    if ((e as any).element !== 'touch') return next(e)
    const x = Number(((e as any).data as { x?: unknown } | null)?.x)
    if (Number.isFinite(x)) await touched($, x)
    return {} as any
  })

  // The critter's pane: its level, Play, the wardrobe, reminders.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Progress } = $.ui.resolve(e) as any
    const s = await read($, stats)
    const set = await read($, settings)
    const away = await read($, isAway)
    const level = levelOf(s.xp)
    const from = xpFor(level)
    const to = xpFor(level + 1)
    const meter = (
      <Progress label={`Level ${level}`} value={s.xp - from} max={to - from} valueText={`${s.xp - from} / ${to - from} xp`} />
    )

    if (e.props.placement === 'widget') {
      return <Box flexDirection="column">{meter}</Box>
    }

    const owned = HATS.filter(h => level >= h.level)
    const nextHat = HATS.filter(h => level < h.level).sort((a, b) => a.level - b.level)[0]
    // Buttons rather than pickers, so the pane draws the same everywhere; the current choice is the primary one.
    const hatChoices: { key: string; label: string; hat: CritterSettings['hat'] }[] = [
      { key: 'hat-auto', label: 'Auto', hat: 'auto' },
      { key: 'hat-none', label: 'No hat', hat: 0 },
      ...owned.map(h => ({ key: `hat-${h.id}`, label: h.name, hat: h.id as number })),
    ]
    const WATER_STEPS = [0, 30, 45, 60, 90]
    const REST_STEPS = [0, 60, 90, 120]
    const after = (steps: number[], now: number) => steps[(steps.indexOf(now) + 1) % steps.length] ?? 0
    const every = (n: number) => (n === 0 ? 'off' : `every ${n} min`)

    return (
      <Box flexDirection="column" gap={1}>
        {meter}
        <Text dimColor>
          {s.turns} replies watched · {s.tools} tools · {s.sessions} sessions · {s.streak}-day streak
        </Text>

        <Text bold>Play</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {TRICKS.map(t => (
            <Button key={`play-${t.name}`} onPress={() => void doTrick($, t.prop, t.ms)}>
              {t.label}
            </Button>
          ))}
        </Box>

        <Text bold>Wardrobe</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {hatChoices.map(c => (
            <Button
              key={c.key}
              variant={set.hat === c.hat ? 'primary' : 'secondary'}
              onPress={() => void changeSettings($, s2 => ({ ...s2, hat: c.hat }))}
            >
              {c.label}
            </Button>
          ))}
        </Box>
        <Text dimColor>
          Auto wears a Santa hat in December, a witch hat in October, and a nightcap at night.
          {nextHat !== undefined ? ` Next to unlock: the ${nextHat.name.toLowerCase()} at level ${nextHat.level}.` : ''}
        </Text>

        <Text bold>Size</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {[1, 2, 3, 4].map(n => (
            <Button key={`size-${n}`} variant={set.size === n ? 'primary' : 'secondary'} onPress={() => void changeSettings($, c => ({ ...c, size: n }))}>
              {String(n)}
            </Button>
          ))}
        </Box>
        <Text dimColor>How big it is in a terminal. Where a size does not fit, it uses the biggest one that does.</Text>

        <Text bold>Reminders</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="water" onPress={() => void changeSettings($, c => ({ ...c, water: after(WATER_STEPS, c.water) }))}>
            Water: {every(set.water)}
          </Button>
          <Button key="rest" onPress={() => void changeSettings($, c => ({ ...c, rest: after(REST_STEPS, c.rest) }))}>
            Break: {every(set.rest)}
          </Button>
        </Box>
        <Text dimColor>Press a reminder to step through how often it comes.</Text>

        <Button key="away" onPress={() => void toggleAway($)}>
          {away ? 'Bring it back' : 'Send it away'}
        </Button>
      </Box>
    )
  })
}
