# Terminal Critter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In terminal Claude Code, show desk-critter in a strip above the prompt, drawn with half-block characters, walking and acting out Claude's work. Then replace clawd-pet with it.

**Architecture:**
- A pure CPU painter (`hooks/critter-art.ts`), ported from the shader's art pass, outputs a palette-indexed pixel grid.
- A pure terminal module (`hooks/terminal.ts`) turns that grid into `Raster` cells and runs the walk/sleep state machine.
- `hooks/register.tsx` renders the strip from one AbovePrompt handler (strip, reminder line, `next(e)`), repaints with `$.ui.blit`, and takes clicks through a `Client` module (`hooks/touch.tsx`).
- The desktop shader path is untouched.

**Tech Stack:** TypeScript and TSX in the Claude Code mod API (Claude Code 2.1.330). Tests use `claude-code/testing` and run with `claude plugin test .`.

**Spec:** `docs/superpowers/specs/2026-11-23-terminal-critter-design.md`

## Global Constraints

- No code or art from clawd-pet. It may be read to learn how the API is used (`~/.claude/plugins/cache/claude-pet-market/clawd-pet/0.29.5/hooks/register.tsx`), never copied.
- The desktop Backdrop shader path keeps behaving exactly as it does now. The 7 existing tests in `hooks/register.test.tsx` keep passing.
- The terminal reads the same atoms as the desktop (`isAway`, `act`, `isAsking`, `feel`, `trick`, `reminder`, `stats`, `settings`, `sky`). Nothing new is persisted.
- The strip always composes with `next(e)`. It never takes rows that `next(e)` and the reminder line need.
- No ticking while asleep, while away, or while no strip is mounted. Skip a blit when the encoded frame equals the last one.
- Art uses the shader's grid coordinates and colours. Colours are converted from the shader's `vec3` constants with `Math.round(c * 255)` into `0xRRGGBB`.
- `Raster` cells are a `Uint32Array` of `[codepoint, fg, bg]` per cell. The terminal default colour is `0x01000000`. Confirm this against `.claude-plugin/types/` once Claude Code has generated it.
- Bump the version to `0.2.0` in `.claude-plugin/plugin.json`.

## Review Focus

1. **Narrow terminal** (`bodyColumns` 30 to 50): the caption truncates and the critter's lane never goes negative. Pinned in Task 4.
2. **Short terminal** (`maxRows` 0 to 7): the strip trims rows from the top first, then drops to the caption only, then to nothing. `next(e)`'s content always survives. Pinned in Task 4.
3. **Another mod's AbovePrompt content:** it still renders under the strip. Pinned in Task 4.
4. **Session sitting idle for hours:** after sleeping, no clock callbacks stay scheduled except the slow `z` frame. Pinned in Task 3 (walker reports `sleeping`) and Task 4 (no blits while asleep).
5. **Resize mid-walk** (`bodyColumns` shrinks below the critter's x): x clamps into the new lane on the next render. Pinned in Task 3.

---

## File structure

| File | Role |
|---|---|
| `hooks/critter-art.ts` (new) | Palette, canvas constants, `Pose`, `paint()`. Pure. |
| `hooks/critter-art.test.ts` (new) | Painter tests. |
| `hooks/terminal.ts` (new) | `encode()`, `Walker`, `poseFor()`. Pure. |
| `hooks/terminal.test.ts` (new) | Encoder and walker tests. |
| `hooks/touch.tsx` (new) | `Client` module: posts the clicked column. |
| `hooks/register.tsx` | Combined AbovePrompt handler, tick and blit, `ui.message` for clicks. |
| `hooks/register.test.tsx` | Terminal strip tests added. |
| `README.md`, `.claude-plugin/plugin.json` | "Where it shows" table, version `0.2.0`. |

---

### Task 1: Painter: body, eyes, legs, arms

**Files:**
- Create: `hooks/critter-art.ts`
- Test: `hooks/critter-art.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const ART = { col0: -6, row0: -8, w: 30, h: 20 } as const // grid cols -6..23, rows -8..11
  export const PALETTE: readonly number[] // index 0 = transparent; then CLAY, EMBER, INK, ROSE, PAPER, STONE, NIGHT, LEAF, SKY, GOLD, BLUE, PURPLE, NIGHTCAP as 0xRRGGBB
  export const C: { CLAY: number; EMBER: number; INK: number; ROSE: number; PAPER: number; STONE: number; NIGHT: number; LEAF: number; SKY: number; GOLD: number; BLUE: number; PURPLE: number; NIGHTCAP: number } // palette indexes
  export type Eyes = 'open' | 'blink' | 'lidded' | 'shut' | 'happy' | 'crossed'
  export type Arm = 'rest' | 'holding' | 'raised' | 'wave'
  export type Prop = 'none' | 'type' | 'read' | 'search' | 'web' | 'shell' | 'think' | 'ask' | 'party' | 'sad'
    | 'dance' | 'sparkler' | 'nap' | 'zoomies' | 'water' | 'coffee' | 'hearts'
  export type Pose = { stride: 0 | 1; dancing: boolean; eyes: Eyes; arm: Arm; hop: 0 | 1; prop: Prop; hat: number; t: number }
  export function paint(pose: Pose): Uint8Array // ART.w * ART.h indexes, row-major, critter facing right
  ```
- Grid pixel `(gx, gy)` lives at `px[(gy - ART.row0) * ART.w + (gx - ART.col0)]`. Sample each shader shape at the pixel centre `(gx + 0.5, gy + 0.5)`. `hop: 1` shifts the whole critter up one pixel. `t` is seconds and drives blink, wave and other animated bits, the way the shader's `time` does.

- [ ] **Step 1: Write the failing tests** in `hooks/critter-art.test.ts` (`import { expect, test } from 'claude-code/testing'`, `import { paint, ART, C } from './critter-art'`). `IDLE` is `{ stride: 0, dancing: false, eyes: 'open', arm: 'rest', hop: 0, prop: 'none', hat: 0, t: 0 }`, and `at(px, gx, gy)` reads one pixel.
  - `body is clay`: `at(paint(IDLE), 6, 1) === C.CLAY` and `at(…, 0, 4) === C.CLAY` (side nub).
  - `eyes are ink at rest`: `at(…, 3, 3) === C.INK && at(…, 9, 3) === C.INK`.
  - `happy eyes make carets`: with `eyes: 'happy'`, `at(…, 3, 2) === C.INK` and `at(…, 3, 3) === C.CLAY`.
  - `legs step`: a pixel on leg A at row 9 differs between `stride: 0` and `stride: 1`.
  - `hop lifts one row`: `at(hop1, 6, 0) === at(idle, 6, 1)`.
  - `nothing outside the critter at rest`: every pixel with `gy < -1` is 0.
- [ ] **Step 2: Run the tests and see them fail.** Run `claude plugin test .`. Expect FAIL: cannot resolve `./critter-art`.
- [ ] **Step 3: Implement** `PALETTE`, `C`, `ART`, the helpers `cells(gx, gy, x0, x1, y0, y1)`, `disc(gx, gy, cx, cy, r)` and `segment(...)`, and `paint()` for the body, nub, legs, arms and all `Eyes` states. Port from `hooks/critter-shader.ts` lines 412–468: same boxes, same rows. Map `holding`, `raised` and `wave` to the shader's `frontArm` and `raised` arm.
- [ ] **Step 4: Run the tests and see them pass.** Run `claude plugin test .`. Expect all pass (the 7 existing ones plus the new ones).
- [ ] **Step 5: Commit.** `git add hooks/critter-art.ts hooks/critter-art.test.ts` then `git commit -m "feat(art): CPU painter for the critter body"`.

### Task 2: Painter: props, hats, tricks, reminders

**Files:**
- Modify: `hooks/critter-art.ts`
- Test: `hooks/critter-art.test.ts`

**Interfaces:**
- Consumes: Task 1's `paint`, `Pose`, `C`, `ART`.
- Produces: `paint()` now draws every `Prop` and hats `1..7` (1 beanie, 2 flower crown, 3 wizard, 4 crown, 5 nightcap, 6 santa, 7 witch, matching the shader's numbers).
- Port from shader lines 478–675 as they are, with two terminal-only changes:
  - `web`: the cloud sits under its feet, with no lift.
  - `hearts`: three hearts above the head for petting.
- The hat is hidden when `prop` is `party` or `ask` (same as the shader's `worn`).
- No umbrella and no dizzy stars (non-goals).

- [ ] **Step 1: Write the failing tests:**
  - `type puts a laptop in front`: `prop: 'type'` → `at(…, 19, 6) === C.SKY` (laptop glow).
  - `shell shows a terminal`: `at(…, 14, 4) === C.NIGHT`.
  - `ask shows the bubble and hides the hat`: `prop: 'ask', hat: 4` → `at(…, 6, -6) === C.INK` (the "!"), and no `C.GOLD` pixels in rows `-4..-2`.
  - `each hat paints above the head`: for each `hat` in 1..7, some pixel with `gy < 0` is non-zero.
  - `wizard hat fits the canvas`: with `hat: 3`, no exception is thrown, and row `ART.row0` has at most the cone tip.
  - `water holds a bottle, coffee a mug`: the two paints differ, and both have pixels at `gx >= 13`.
- [ ] **Step 2: Run the tests and see them fail.** Run `claude plugin test .`. Expect FAIL on the new tests.
- [ ] **Step 3: Implement** the props, hats, tricks, reminders, party (hat and confetti), sad (rain cloud), `nap` (z's) and `hearts` in `paint()`. Clip anything outside `ART`.
- [ ] **Step 4: Run the tests and see them pass.** Run `claude plugin test .`. Expect all pass.
- [ ] **Step 5: Commit** with `feat(art): props, hats and tricks`.

### Task 3: Terminal encoder and walker

**Files:**
- Create: `hooks/terminal.ts`
- Test: `hooks/terminal.test.ts`

**Interfaces:**
- Consumes: `paint`, `Pose`, `Prop`, `ART`, `PALETTE` from Task 1.
- Produces:
  ```ts
  export const DEFAULT_COLOR = 0x01000000
  export const STRIP_ROWS = 10 // ART.h / 2
  export const BODY_ROWS = 6   // the bottom 6 rows hold body and legs; below this the strip shows only the caption
  export const SPRITE_COLS = ART.w
  export function encode(px: Uint8Array, laneCols: number, rows: number, x: number, flip: boolean): Uint32Array
  export type WalkInput = { now: number; laneCols: number; busy: boolean; night: boolean; trick: Prop; reminder: 'none' | 'water' | 'rest'; zoom: boolean }
  export class Walker {
    constructor(seed?: number)
    x: number; facing: 1 | -1; sleeping: boolean
    poke(now: number): void              // any event: wakes it, resets the idle timer
    pet(now: number): void               // hearts for 1500 ms and a hop
    step(input: WalkInput): void         // advance one tick
    pose(input: WalkInput, act: Prop, feel: number, asking: boolean, hat: number): Pose
  }
  ```
- `encode` draws the art's **bottom `rows` rows** (cropping from the top). The sprite's left edge is at lane column `x`.
  - Each cell is `▀` (0x2580): fg = the top pixel, bg = the bottom pixel. A transparent half uses `DEFAULT_COLOR`.
  - A cell with both halves transparent is `[0x20, DEFAULT_COLOR, DEFAULT_COLOR]`.
  - `flip` mirrors the sprite about the body centre (grid x 6.5), so the body stays in the same columns.
- Walker values from the spec:
  - Walk 1 column per 2 ticks; zoomies 3× that; night half speed.
  - Rest 2000–6000 ms at random points.
  - Sleep after 180000 ms idle (45000 ms at night).
  - A reminder walks it to the middle of the lane.
  - Busy, a trick (other than zoomies) or a reminder at the middle: stand still.
  - `x` clamps to `[0, laneCols - SPRITE_COLS]` on every step.
  - Seeded RNG (for example mulberry32) so tests are deterministic.

- [ ] **Step 1: Write the failing tests:**
  - `empty pixels are default spaces`: encode an all-zero grid → every cell is `[0x20, DEFAULT_COLOR, DEFAULT_COLOR]`.
  - `half blocks carry top and bottom colours`: a grid with only `(gx 0, gy 10) = CLAY` and `(0, 11) = INK` → the bottom-left cell is `[0x2580, PALETTE[CLAY], PALETTE[INK]]`.
  - `flip keeps the body in place`: the set of columns holding CLAY is identical for `flip` true and false on `paint(IDLE)`.
  - `crop keeps the feet`: `rows = BODY_ROWS` → the last row still holds leg pixels.
  - `walker stays in lane after a resize`: `x` = 60, then `step` with `laneCols = 40` → `x <= 40 - SPRITE_COLS`.
  - `walker sleeps after 3 idle minutes, sooner at night`: `sleeping` is true after `now + 180000` by day and after `now + 45000` at night. `poke` wakes it.
  - `busy stands still`: `x` is unchanged over 20 steps with `busy: true`.
  - `reminder walks to the middle`: after enough steps, `x === Math.floor((laneCols - SPRITE_COLS) / 2)`.
  - `pet shows hearts then stops`: `pose(...).prop === 'hearts'` at `now + 100` and not at `now + 1600`.
- [ ] **Step 2: Run the tests and see them fail.** Run `claude plugin test .`. Expect FAIL: cannot resolve `./terminal`.
- [ ] **Step 3: Implement** `encode`, `Walker` and `pose()`.
  - Prop priority in `pose()`, highest first: hearts, then ask, then feel (+1 party, −1 sad), then trick, then reminder (`water` or `coffee`), then act, then nap while sleeping.
  - Eyes: `shut` when sleeping or napping; `happy` for party, dance or hearts; `lidded` at night; otherwise `open`, blinking for 150 ms every ~4.3 s.
  - Arm: `wave` for ask or wave, `holding` for type, shell, sparkler or a reminder, otherwise `rest`.
- [ ] **Step 4: Run the tests and see them pass.** Run `claude plugin test .`. Expect all pass.
- [ ] **Step 5: Commit** with `feat(terminal): half-block encoder and walker`.

### Task 4: The strip in `register.tsx`

**Files:**
- Modify: `hooks/register.tsx`: the AbovePrompt handler (currently at lines 392–410), plus new module-level terminal state and tick.
- Test: `hooks/register.test.tsx`

**Interfaces:**
- Consumes: `encode`, `Walker`, `STRIP_ROWS`, `BODY_ROWS`, `SPRITE_COLS`, `paint`.
- Produces:
  - The terminal strip: a `Raster` with key `desk-critter`.
  - A caption `Text` reading `critter Lv {level} · {doing}`, where `doing` is one of `idle | thinking | typing | reading | searching | on the web | running a command | waiting on you | asleep`.
  - Module-level `strip: { requestId: string; laneLeft: number; laneCols: number; rows: number } | null`, used by Task 5.

The handler, in order:
1. If `hasSurvey` or `isCollapsed`, return `next(e)`.
2. `below = await next(e)`.
3. Build the reminder line as today.
4. If `e.surface === 'terminal'` and `!isAway`: `room = maxRows - rows(below) - (reminder line ? 1 : 0)`. Then:
   - `room >= BODY_ROWS`: the strip, `min(STRIP_ROWS, room)` rows tall.
   - `1 <= room < BODY_ROWS`: the caption line only.
   - `room <= 0`: nothing.
   - Count `rows(below)` the way the API reports it. Read how clawd-pet's `hooks/layout.ts` counts, then write your own.
5. Lay out the caption bottom-left. The lane starts at caption width + 2, and the Raster is absolutely positioned in the lane.

Tick:
- While a strip is mounted and the walker is not sleeping, run `$.clock.every(125)`. Each tick: `walker.step()`, `encode()`, then `$.ui.blit({ requestId, key: 'desk-critter', columns, rows, cells })` only when the cells differ from the last blit.
- While sleeping: one frame per 1000 ms, only for the z's.
- Stop the tick when the strip unmounts, on away, or when the surface is not terminal.
- Existing event handlers (`prompt.submit`, tool events, `turn.complete`, permission events, the `trick` and `reminder` setters) call `walker.poke(now)` and restart the tick when stopped.
- `$.ui.invalidate('ui.render')` only on a layout change: lane width, rows or caption width.

- [ ] **Step 1: Write the failing tests** (`TERM` = `BAND` with `surface: 'terminal'`, `maxRows: 30`, `bodyColumns: 100`):
  - `terminal shows the critter strip`: mount `TERM` → a `Raster` exists with `rows === 10`, and a `Text` matches `/critter Lv 0/`.
  - `desktop shows no strip`: mount `BAND` with `surface: 'desktop'` → no `Raster`.
  - `away hides the strip`: after `/critter away` → no `Raster`.
  - `short terminal trims, then captions, then hides`: `maxRows` 8 → `Raster` rows 8; `maxRows` 3 → no `Raster`, and the caption `Text` is present; `maxRows` 0 → neither.
  - `narrow terminal still fits`: `bodyColumns: 30` → no throw, and the `Raster` columns are ≥ 0.
  - `another mod's line survives`: register `on('ui.render', { component: 'AbovePrompt' }, …)` returning `<Text>Other mod</Text>` before the plugin → that `Text` is still found.
  - `reminder line sits under the strip`: a water reminder due on terminal → both the `Raster` and the `Text` "Your critter brought you some water" are present.
  - `a Read shows reading in the caption`: `tool.call Read`, advance 400 ms → the caption matches `/reading/`.
  - `asleep, it stops blitting`: count `ui.blit` calls with `on('ui.blit', …)`. After advancing 200000 ms idle, the count over the next 10000 ms is ≤ 10.
- [ ] **Step 2: Run the tests and see them fail.** Run `claude plugin test .`. Expect the new tests to fail and the existing 7 to pass.
- [ ] **Step 3: Implement** the combined handler, the strip state, the tick, and the poke wiring.
- [ ] **Step 4: Run the tests and see them pass.** Run `claude plugin test .`. Expect all pass.
- [ ] **Step 5: Commit** with `feat(terminal): critter strip above the prompt`.

### Task 5: Click to pet

**Files:**
- Create: `hooks/touch.tsx`
- Modify: `hooks/register.tsx`
- Test: `hooks/register.test.tsx`

**Interfaces:**
- Consumes: Task 4's `strip`, `walker.pet(now)`.
- Produces:
  - `hooks/touch.tsx` default-exports a `ClientModule`. On a pointer `down` it posts `{ x: number, y: number }`, and it renders an empty `Box` the size of the surface.
  - The strip mounts `<Client key="touch" module="./touch.tsx" width={laneCols} height={rows} />` over the lane.
  - `on('ui.message')` with `e.element === 'touch'`: if `x` is within the critter's columns (`walker.x .. walker.x + SPRITE_COLS`, which contain body pixels), call `walker.pet(now)` and restart the tick. Otherwise return `{}`. Other elements go to `next(e)`.

- [ ] **Step 1: Write the failing tests:**
  - `a click on the critter pets it`: mount `TERM`, `ui.pointer({ type: 'down', x: laneLeft + walker.x + 6, y: 9, button: 'left' })`, advance 125 ms → the encoded cells contain `PALETTE[C.ROSE]` (hearts).
  - `a click beside it does nothing`: click at the far right of the lane → no `ROSE`.
  - Use the module-level `strip` and `walker` through a test-only export, or read the `Raster`'s `props.cells`.
- [ ] **Step 2: Run the tests and see them fail.** Run `claude plugin test .`.
- [ ] **Step 3: Implement** `touch.tsx`, the `Client` mount and the `ui.message` handler.
- [ ] **Step 4: Run the tests and see them pass.** Run `claude plugin test .`. Expect all pass.
- [ ] **Step 5: Commit** with `feat(terminal): click the critter to pet it`.

### Task 6: README, version, live check

**Files:**
- Modify: `README.md` (the "Where it shows" table and the "How it works" bullets), `.claude-plugin/plugin.json` (`"version": "0.2.0"`).

- [ ] **Step 1: Update the README.**
  - Set the Terminal row to: "The critter in a strip above the prompt, the `/critter` pane and reminders".
  - Add "How it works" bullets for `critter-art.ts`, `terminal.ts` and `touch.tsx`.
  - Under "With you", add one line: in a terminal, a click pets it.
- [ ] **Step 2: Bump the version** in `.claude-plugin/plugin.json` to `0.2.0`.
- [ ] **Step 3: Validate.** Run `claude plugin validate . && claude plugin test .`. Expect validation OK and all tests pass.
- [ ] **Step 4: Live check.** Load the plugin from the local path in a new terminal session.
  - Use `claude --plugin-dir ~/projects/desk-critter` if `claude --help` lists that flag. Otherwise add `~/projects/desk-critter` as a local marketplace and install `desk-critter` at project scope in a scratch directory.
  - Turn off clawd-pet for that session only if both strips would stack.
  - Ask the owner to look: walk, a Read (glasses and book), a permission prompt (wave), a finished reply (party), a click (hearts), `/critter dance`, and a narrow window.
- [ ] **Step 5: Commit** with `docs: terminal critter in README; v0.2.0`.

### Task 7: Switchover (each step confirmed with the owner before it runs)

- [ ] **Step 1:** Ask the owner to confirm. Then `git checkout main && git merge --ff-only terminal-critter && git push origin main`.
- [ ] **Step 2:** Ask the owner to confirm. Then `claude plugin marketplace update desk-critter` (or add `ric-v/claude-desk-critter` if it is missing), then `claude plugin install desk-critter --marketplace ric-v/claude-desk-critter` at user scope. Expect `desk-critter@…: true` in `~/.claude/settings.json` `enabledPlugins`.
- [ ] **Step 3:** Ask the owner to confirm. Then set `"clawd-pet@claude-pet-market": false` in `~/.claude/settings.json` (an exact edit of that one value). Do not uninstall clawd-pet.
- [ ] **Step 4:** The owner starts a fresh terminal session. Expect only the critter strip above the prompt.
