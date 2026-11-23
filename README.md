# desk-critter

A little orange pixel critter that lives in the Claude desktop app's backdrop and walks around your prompt box, and in a terminal walks a strip just above your prompt. It follows what Claude is doing, loves being petted, can be picked up and thrown, levels up as you work together, wears hats, and reminds you to drink water.

It's a Claude Code mod: a hooks module, a GPU shader for the desktop and a character-cell painter for the terminal, with no server and nothing sent anywhere.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install desk-critter --marketplace ric-v/claude-desk-critter
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it everywhere, including the desktop app's Code tab).

From a shell:

```
claude plugin install desk-critter --marketplace ric-v/claude-desk-critter
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `ric-v/claude-desk-critter`, then **Add plugin**.

This repository is private: installing it needs read access on GitHub and a git credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

Needs Claude Code 2.1.330 or newer.

## Where it shows

| Surface | What you get |
|---|---|
| Desktop app | The full critter in the backdrop, plus the pane and reminders |
| Mobile app | A still picture of the critter (the app plays no shaders) |
| Terminal | The critter in a strip above the prompt, drawn in half-block characters, plus the `/critter` pane and reminders |

The critter sets the app's backdrop, which is part of the theme, so while it's on it replaces any other theme's backdrop. `/critter away` gives the backdrop back.

## What it does

**On its own** it strolls up the left side of the prompt box, along the top and down the right side, resting now and then. Its eyes follow your pointer. At night (10pm to 6am) it moves at half speed with heavy eyelids.

**With you**

- Rest the pointer on it and it stops to look at you.
- Rub the pointer back and forth over it to pet it: hearts, then happy eyes and a hop.
- In a terminal, click it to pet it.
- Press and drag to pick it up; it dangles from the pointer. Let go to throw it: it bounces off the window's edges, lands on the prompt box or walks back to it from the bottom, opens an umbrella when it falls from high up, and sees stars after a hard landing.

**With Claude**, it goes to the top of the prompt box and acts out the work:

| Claude is... | The critter... |
|---|---|
| Thinking, or running a subagent | A spinning spark over its head |
| Editing or writing files | Types on a laptop |
| Reading files | Glasses and an open book |
| Searching | Sweeps a magnifying glass |
| On the web | Floats on a cloud |
| Running commands | A little terminal with a blinking cursor |
| Waiting on your permission | Waves, with a "!" bubble |
| Done with a reply | Party hat and confetti |
| Stopped by a refusal or error | A small rain cloud |

It reads tool names from the same events settings hooks get, so it never changes how a tool runs.

**Growing up.** It earns xp from tools, finished replies, completed reminders and sessions, and levels up. Levels unlock hats: beanie (1), flower crown (2), crown (4), wizard hat (6), Santa and witch hats (8); the nightcap is always there. On **Auto** it wears a Santa hat in December, a witch hat in October and a nightcap at night. Stats and settings are kept in the mod's own store under your Claude configuration directory.

**Reminders.** Water every 45 minutes by default, and an optional break reminder. When one is due the critter comes to the middle of the prompt box with a bottle or a mug, and a line above the prompt waits for **Done** (or **In 10 minutes**), even across a restart.

## Commands

| Command | Does |
|---|---|
| `/critter` | Opens its pane: level, stats, Play, wardrobe, reminders |
| `/critter away` | Sends it off and gives the backdrop back; again to bring it back |
| `/critter size 1`–`4` | Its size in a terminal: 1 is a hand-drawn mini critter, 2 to 4 the full one at 0.7, 1.1 and 1.5 times; the pane has the same buttons |
| `/critter dance` (`wave`, `jump`, `sparkler`, `nap`, `zoomies`) | A trick |
| `/critter type` (`read`, `search`, `web`, `shell`, `think`, `ask`, `party`, `sad`, `water`, `coffee`) | Shows that prop for a few seconds |

## How it works

- `hooks/register.tsx` is the hooks module: it follows the session, keeps stats and settings, draws the pane and the reminder line, and sets the backdrop.
- `hooks/critter-shader.ts` is the scene, in Claude Code's shader language. A state pass runs the walk and the physics (gravity, bounces, the umbrella) from the pointers the app feeds it. A pose pass works out where the critter is once a frame. An art pass paints the critter and its props on its own small grid. The picture pass looks that grid up for each pixel, which keeps it sharp and cheap.
- `hooks/critter-art.ts` paints the same critter on the CPU, on the shader's own grid and in its colours, for surfaces with no shader.
- `hooks/terminal.ts` turns that painting into half-block cells (two pixels a cell) and walks the critter along the strip; asleep after a few quiet minutes, it stops redrawing.
- `hooks/touch.tsx` makes the strip clickable, so a click on the critter pets it.
- The mod tells the shader what to show through a handful of eased values. A prop or hat only changes while it is faded out, so you never see the in-between ones.
- Where no shader plays (Reduce Motion, mobile, a slow GPU), a still picture of the critter in the corner shows instead.

## Development

```
claude plugin validate .
claude plugin test .
```

## Credits

Original pixel art and code. The idea of a Claude Code companion that follows your session, climbs, gets thrown and wears seasonal hats was inspired by the community project [clawd-pet](https://github.com/ItzSkyeYT/clawd-pet); none of its code or art is used here. Not affiliated with or endorsed by Anthropic.
