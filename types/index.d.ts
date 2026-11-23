export type CritterIsAway = boolean
/** What Claude is doing, as the critter acts it out. */
export type CritterAct = 'idle' | 'think' | 'type' | 'read' | 'search' | 'web' | 'shell'
/** -1 sad (a turn ended badly), 0 calm, 1 party (a reply finished). */
export type CritterFeel = number
/** A trick or a preview the critter is doing now, by its shader prop number; 0 for none. */
export type CritterTrick = number
/** A reminder waiting for you to press Done. */
export type CritterReminder = 'none' | 'water' | 'rest'
/** Kept across sessions in the store too. */
export type CritterStats = {
  xp: number
  turns: number
  tools: number
  sessions: number
  streak: number
  lastDay: string
}
/** Kept across sessions in the store too. `hat` is 'auto' (seasons and night) or a hat number, 0 for none. */
export type CritterSettings = { hat: 'auto' | number; water: number; rest: number }
/** What the shader is shown now, stepped so a prop or hat only changes while faded out. */
export type CritterShown = { prop: number; propOn: number; hat: number; hatOn: number }
/** The local hour and month, for night and the seasons. */
export type CritterSky = { hour: number; month: number }

declare module 'claude-code' {
  interface PluginState {
    'desk-critter': {
      isAway: CritterIsAway
      act: CritterAct
      isAsking: boolean
      feel: CritterFeel
      trick: CritterTrick
      reminder: CritterReminder
      stats: Shaped<CritterStats>
      settings: Shaped<CritterSettings>
      shown: Shaped<CritterShown>
      sky: Shaped<CritterSky>
    }
  }
}
