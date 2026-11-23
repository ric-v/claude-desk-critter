# desk-critter in the terminal: design

Date: 2026-11-23
Status: draft, awaiting owner approval

## Intent

The owner runs Claude Code mostly in the terminal (Ghostty on WSL2). There they use a third-party mod, `clawd-pet@claude-pet-market` (v0.29.5, MIT, by another author). It draws a pet walking in a strip above the prompt. The owner wants **their own critter**, the one from desk-critter, to do that job instead, and then to turn clawd-pet off.

desk-critter today is desktop-first. A GPU backdrop shader draws the critter around the prompt box. In a terminal you get only the `/critter` pane and the reminder line, with no critter. This design adds a terminal surface to the same plugin, so one install gives the same critter (same level, hats, reminders) in both places.

## Goals

1. In terminal Claude Code (`e.surface === 'terminal'`), a strip above the prompt shows the critter, drawn in characters and animated.
2. The critter strolls left and right across the strip, faces the way it walks, and rests now and then. It steps its legs while it walks.
3. It acts out what Claude is doing, using the act and feel state the mod already keeps:
   - `think`: spark over its head
   - `type`: laptop
   - `read`: glasses and book
   - `search`: magnifier
   - `web`: cloud under it
   - `shell`: small terminal with a blinking cursor
   - asking: waves, with a `!` bubble
   - feel +1: party hat and confetti
   - feel -1: rain cloud
   While Claude is busy it stops walking and works in place.
4. Tricks from `/critter dance|wave|jump|sparkler|nap|zoomies` and previews from `/critter type|read|…|water|coffee` play in the strip too.
5. Hats follow the existing wardrobe and `auto` rules (season, night, level unlocks).
6. Night (10pm to 6am): half speed and heavy eyelids. It falls asleep after a few minutes with nothing happening.
7. A due reminder brings the critter to the middle of the strip holding a bottle or mug. The existing Done / In 10 minutes line still shows.
8. Clicking the critter pets it: hearts, happy `^ ^` eyes, a hop.
9. A short caption beside it: name, level, and what it is doing (for example `critter Lv 3 · reading`).
10. `/critter away` hides the strip as well. Running it again brings it back.
11. Once this works, turn off `clawd-pet@claude-pet-market` in `~/.claude/settings.json` (`enabledPlugins`) and install desk-critter at user scope.

## Non-goals

- Picking up, dragging and throwing; the umbrella; walking back from the floor. Terminal pointer input is click-only in practice.
- Eyes following the pointer. A terminal gives no hover position.
- Changing the desktop shader or how the desktop looks.
- Mobile.
- New stats, levels or hats. The terminal shows what already exists.

## Anti-goals (failure even if it works)

- **No clawd-pet code or art.** The README already promises "none of its code or art is used". clawd-pet may be read to learn how the mod API is used (AbovePrompt, Raster, blit, Client), but nothing may be copied from it.
- **Must not break the desktop.** The Backdrop shader path must behave exactly as it does today.
- **Must not crowd the terminal.** The strip never takes more than its fair share of `e.props.maxRows`. It shrinks first, then drops to a caption line, then disappears. Other AbovePrompt mods still render (always compose with `next(e)`).
- **Must not burn CPU.** Repaint only when the frame actually changes. Do not tick at all while it sleeps, while it is away, or while the strip is not mounted.
- **Two critters must not disagree.** Terminal and desktop read the same atoms (`act`, `feel`, `trick`, `reminder`, `stats`, `settings`, `sky`). There is no separate terminal state for anything that lasts.

## Constraints

- Claude Code mod API, Claude Code 2.1.330 or newer (the README's floor). One hooks module, `hooks/register.tsx`, listed in `hooks/hooks.json`. Types come from `.claude-plugin/types/tsconfig.json`.
- These API pieces are used (seen working in clawd-pet's terminal strip):
  - `on('ui.render', { component: 'AbovePrompt' })` with `e.surface`, `e.props.bodyColumns`, `e.props.maxRows`, `e.props.hasSurvey`, `e.props.isCollapsed`, `e.props.isWorking`, `e.requestId`
  - `$.ui.resolve(e)` giving `Box`, `Text`, `Raster`, `Client`
  - `Raster` takes `columns`, `rows` and `cells`. `cells` is a `Uint32Array` of `[codepoint, fg, bg]` triples, one per cell.
  - `$.ui.blit({ requestId, key, columns, rows, cells })` repaints a mounted keyed Raster without a full re-render.
  - `$.ui.invalidate('ui.render')` forces a re-render, for layout changes.
  - A `Client` module (`ClientModule`, `surface.onPointer`, `surface.post`) takes clicks over the strip.
  - `$.clock.every` / `$.clock.after` drive the tick.
- desk-critter already has one AbovePrompt handler, for the reminder line. The terminal strip and the reminder line must come from **one** handler, so they stack predictably: strip on top, reminder line under it, then `next(e)`.
- Tests run with `claude plugin test .`. `hooks/register.test.tsx` exists and must keep passing.

## Approaches considered

1. **Add a terminal surface to desk-critter (chosen by the owner).** One install. State is shared across desktop and terminal. The cost is some surface branching in `register.tsx`.
2. **A separate `cli-critter` plugin in the same repo.** Desktop code stays untouched, but each plugin keeps its own stats, so there would be two critters with two levels unless storage is shared. Rejected: the owner wants one critter.
3. **Fork clawd-pet and swap the art.** Rejected: it is not the owner's own critter, and it breaks the README's "none of its code or art" promise.
4. (Not pursued) A separate repo: no advantage over option 2.

## Design

### Art: one pixel painter, ported from the shader

The shader paints the critter on its own grid with boxes, discs and segments (`cells(g, x0, x1, y0, y1)` and friends, in `hooks/critter-shader.ts`, art pass from about line 390). The body is 13 × 11 grid pixels: body 1..12 × 0..7, a side nub, an arm, and four legs that step.

A new pure module, `hooks/critter-art.ts`, paints the same art on the CPU:

- `paint(pose) → { w, h, px: Uint8Array }`. Each pixel is a palette index; 0 means transparent.
- `pose` holds: facing, leg phase, eye state (open, blink, lidded, shut, happy, wide, crossed), arm state (rest, holding, raised, waving), hop offset, prop id and frame, and hat id.
- It uses the **same grid coordinates and palette as the shader**, so the two critters look like one character. Props and hats get their own small paint functions, positioned the way the shader positions them.
- The grid includes headroom for a hat and an over-head prop (spark, `!` bubble, rain cloud), and side room for held props (laptop, book, terminal, magnifier). The builder sizes the canvas from the largest case.
- It has no dependency on `$`, so it can be unit-tested directly (for example, "the type prop puts laptop pixels in front of the body", "a mirrored frame is the exact mirror").

### Terminal encoding: half blocks

Each terminal cell shows two vertical pixels using `▀`: fg is the top pixel, bg is the bottom. A transparent half uses the terminal's default colour. If both halves are transparent, the cell is a space with default colours.

At 1 grid pixel per half cell, the body is about 13 columns × 6 rows. Half blocks beat quarter blocks here: every pixel keeps its own colour, and the critter's eyes are single pixels.

`hooks/terminal.ts` holds `encode(px, w, h, stripCols, stripRows, x, flip) → Uint32Array` and the walk state machine below. It is pure, like the painter, and unit-tested.

### The strip

- Height: the canvas height in rows (about 8 with hat and over-head prop), capped by `maxRows` minus what `next(e)` and the reminder line need.
  - If fewer rows are available, drop the over-head prop room first, then the hat room.
  - Below the body's own height, show only the caption line.
  - With 0 rows, show nothing.
- Width: `bodyColumns`. The caption sits bottom-left. The critter walks in the lane to the right of the caption.
- One keyed `Raster` (key `desk-critter`) for the lane. Frames are repainted with `$.ui.blit`. A full `invalidate` happens only when the layout changes (width, rows, caption width).
- A `Client` over the critter's cells posts click positions. A click that lands on the critter pets it.

### Behaviour (terminal side)

Session-local, not persisted: x position, facing, walk/rest timer, leg phase, blink timer, hop timer, petted timer.

- **Idle:** walk at about 1 column per 2 ticks. Rest 2 to 6 s at random points. Turn at the lane's ends. Night: half speed and lidded eyes.
- **Sleep (at any hour):** after 3 minutes with no events, it sleeps: shut eyes, a `z` drifting up. The tick then stops, except for a slow `z` frame. At night it nods off sooner, after 45 s. Any event, a click or a turn wakes it. *(Builder's call, settled in review: sleeping all day is what keeps an idle terminal from ticking.)*
- **Busy** (`act !== 'idle'` or `isWorking`): stop and show the prop for the act. The existing `LINGER_MS` behaviour already keeps quick tool runs from flickering.
- **Asking:** wave with a `!` bubble.
- **Feel:** party or rain for `FEEL_MS`, as on the desktop.
- **Trick / preview:** play while `trick` is set; zoomies run fast across the lane.
- **Reminder due:** walk to the lane's middle and hold the bottle or mug.
- **Pet** (click): hearts for 1.5 s, happy eyes, one hop. No xp. Petting gives no xp on the desktop either; this is the builder's call to keep or change.
- **Tick rate:** about 8 fps while something animates. Skip the blit when the encoded frame equals the last one.

### Wiring in `register.tsx`

- The existing Backdrop handler stays and keeps its `desktop`/`mobile` guard.
- The AbovePrompt handler becomes:
  1. If `hasSurvey` or `isCollapsed`, return `next(e)`.
  2. Render `below = await next(e)`.
  3. If `e.surface === 'terminal'` and not `isAway`, build the strip.
  4. Add the reminder line if one is due (all surfaces, as today).
  5. Return a column: strip, reminder line, `below`.
- Event handlers already update the shared atoms. On the terminal they additionally `invalidate` or wake the tick, so a change shows at once.
- `/critter away` already flips `isAway`. The strip honours it.

### Install / switchover

1. Develop in `~/projects/desk-critter` on branch `terminal-critter`.
2. Test locally with `claude plugin validate .` and `claude plugin test .`, then load it from the local path in a terminal session for the owner to see.
3. Update the README's "Where it shows" table: Terminal now shows the critter in a strip above the prompt. Bump `plugin.json` to `0.2.0`.
4. The builder does the switchover, confirming each step with the owner before running it (owner's decision):
   1. Merge `terminal-critter` into `main` and push to `origin` (`ric-v/claude-desk-critter`, private).
   2. Install `desk-critter` from the `ric-v/claude-desk-critter` marketplace at user scope.
   3. Set `"clawd-pet@claude-pet-market": false` in `~/.claude/settings.json` (`enabledPlugins`). Leave clawd-pet installed, so the switch can be reversed.

## Later (not in this build)

Owner's decision: half blocks ship first; picture mode is a follow-up once the owner has lived with the strip.

**Picture mode for picture-capable terminals (Ghostty, kitty, iTerm2).** Render the same pixel grid as a crisp image with the `Image` element, scaled by whole pixels, instead of half blocks. Detection, fallback and the refusal handling follow the API's own signals (an `Image`/`blit` refusal falls back to the Raster). The builder decides how the image source is produced (for example, a small in-module PNG encoder from the `px` grid). Half blocks stay the default until picture mode is proven on the owner's Ghostty under WSL2.

## Left to the builder

- Exact canvas size, prop and hat pixel layouts (match the shader), and the palette constant shared with the shader.
- Tick scheduling details, random rest timing, the walk speed constant.
- Caption wording and colours (keep it short, one line, truncate).
- File split beyond `critter-art.ts` and `terminal.ts`.
- Test cases beyond the ones named above.
