import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CritterAct, CritterReminder, CritterSettings, CritterShown, CritterSky, CritterStats } from '../types'

// ---- State: the session's, mirrored to the store for what lasts across sessions.
const isAway = atom({ plugin: 'desk-critter', key: 'isAway' } as const, false)
const act = atom({ plugin: 'desk-critter', key: 'act' } as const, 'idle' as CritterAct)
const isAsking = atom({ plugin: 'desk-critter', key: 'isAsking' } as const, false)
const feel = atom({ plugin: 'desk-critter', key: 'feel' } as const, 0)
const trick = atom({ plugin: 'desk-critter', key: 'trick' } as const, 0)
const reminder = atom({ plugin: 'desk-critter', key: 'reminder' } as const, 'none' as CritterReminder)
const FRESH_STATS: CritterStats = { xp: 0, turns: 0, tools: 0, sessions: 0, streak: 0, lastDay: '' }
const stats = atom({ plugin: 'desk-critter', key: 'stats' } as const, FRESH_STATS, { shape: 'stats-1' })
const DEFAULT_SETTINGS: CritterSettings = { hat: 'auto', water: 45, rest: 0 }
const settings = atom({ plugin: 'desk-critter', key: 'settings' } as const, DEFAULT_SETTINGS, { shape: 'settings-1' })
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
  await $.theme.set({ backdrop: { scene: SCENE, glass: GLASS } })
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
  if (word === 'away') {
    return { text: (await toggleAway($)) ? 'Your critter went off to nap. /critter away brings it back.' : 'Your critter is back around your prompt.' }
  }
  const t = TRICKS.find(one => one.name === word)
  const isPreview = (PREVIEWS as readonly string[]).includes(word)
  if (t === undefined && !isPreview) {
    const names = [...TRICKS.map(one => one.name), ...PREVIEWS].join(', ')
    return { text: `Try /critter (the pane), /critter away, or /critter followed by one of: ${names}.` }
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const done = await next(e)
    await $.command.register({
      name: 'critter',
      description: 'Your desk critter: /critter opens its pane; /critter away sends it off; /critter <trick or prop> plays one',
      argumentHint: '[away|dance|wave|jump|sparkler|nap|zoomies|type|read|search|web|shell|think|ask|party|sad|water|coffee]',
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
    if (!(await read($, isAway))) await arrive($)
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

  // A reminder waits above the prompt until you press Done.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isCollapsed) return next(e)
    const r = await read($, reminder)
    if (r === 'none') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e) as any
    const words = r === 'water' ? 'Your critter brought you some water. Take a sip?' : 'Your critter made coffee. Time for a short break?'
    return (
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
