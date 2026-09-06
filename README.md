# Orrery

Mission control for your Claude Code projects. Local-first, no account, no cloud.

Every project you run Claude in becomes a body in orbit. Distance from the centre
is how long since it last moved, size is how much work has gone into it, and the
colour tells you whether it is working, idle, or waiting on you. Click anything to
land in the Claude session behind it.

```bash
node bin/orrery.js up
```

That serves the dashboard on `http://127.0.0.1:4173` and starts the scheduler.

## Why this exists

Claude Code already stores everything worth knowing in `~/.claude`. What it does
not do is answer "what is the state of all my projects right now, and which one
needs me?" Orrery reads that data, joins it to a project registry, and puts a
door back into each session one click away.

## The three things it does

**1. Sees everything.** It reads every transcript under
`~/.claude/projects/*/*.jsonl` incrementally — it remembers the byte offset it
stopped at, so a 65MB history costs ~200ms on first scan and almost nothing after.
It cross-references `~/.claude/sessions/*.json` and checks the pids to know which
sessions are actually alive right now.

**2. Gets you back in, in one click.** The desktop app registers a `claude://`
URL scheme. Orrery uses three routes from it:

| Link | Effect |
|---|---|
| `claude://code/new?folder=<path>&prompt=<text>` | New session in a folder, pre-seeded with a prompt |
| `claude://code/continue?session=local_<uuid>` | Jump straight into a specific session |
| `claude://code/needs-input` | Jump to whatever is waiting on you |

Session ids on disk are bare uuids; the app wants a `local_` prefix. The prompt is
truncated at 14336 characters.

**3. Keeps projects moving without you.** Each project carries an *agenda* — cron
tasks that run `claude -p` headless in that folder. Because a headless run writes a
normal transcript, an autonomous run **is** a resumable session: when one gets
stuck, you click through and keep talking to it with its full context intact.

## The autonomy loop

Every scaffolded project's `CLAUDE.md` teaches the agent one convention:

> Do everything you can do unattended. If a decision genuinely needs the human,
> end your final message with `NEEDS INPUT: <one self-contained question>`.

Orrery watches for that line, turns it into a card at the top of the dashboard,
and gives you an **Answer in Claude** button that opens the exact run that asked.
Autonomous until it depends on you, then one click to unblock it.

### Autonomy levels

Set per project. New projects default to `read`.

| Level | What a scheduled run may do |
|---|---|
| `off` | Nothing runs unattended |
| `read` | Look around and report. `Write`, `Edit`, `NotebookEdit` and `Bash` are denied |
| `edit` | Change files in the project (`--permission-mode acceptEdits`) |

Two further guards, both on by default: the scheduler **skips any project that has
a live interactive session** (two agents in one tree is how you lose work), and
`autonomyEnabled` in settings is a global kill switch.

## Templates

`orrery new` scaffolds the folder, writes a `CLAUDE.md` describing the data shapes,
preloads an agenda, and opens Claude with a starter prompt.

| Template | What it sets up |
|---|---|
| `blank` | Empty project wired into Orrery |
| `finance` | Statement ingest → normalised ledger → rules-based categorisation → weekly report |
| `recipes` | Recipe box, pantry, weekly plan with a consolidated shopping list |
| `fitness` | Freeform session logging, estimated-1RM progression, weekly block review |
| `journal` | Restaurants / travel / films, rolled-up places index, monthly look back |

## CLI

```
orrery up                 dashboard + scheduler
orrery serve              dashboard only
orrery daemon             scheduler only

orrery new <name>         scaffold a project and open Claude in it
                          --template blank|finance|recipes|fitness|journal
                          --autonomy off|read|edit
orrery adopt [dir]        bring an existing folder into Orrery
orrery ls [--v]           list projects and status
orrery next               jump to whatever is waiting on you
orrery go [match]         open a project's most relevant session
orrery run <match> [task] run an agenda task now, headless
```

`orrery next` is the one worth aliasing. It finds the most blocking thing across
every project and opens it.

## Keyboard

- `⌘K` — command palette: jump to any session, run any task, start anything new
- `n` — new project

## Layout

```
src/config.js      paths, settings
src/scan.js        incremental JSONL indexer + live-pid detection
src/projects.js    registry, scaffolding, auto-discovery of untracked folders
src/templates.js   project templates          ← add your own here
src/autonomy.js    cron, headless runner, NEEDS INPUT parsing
src/deeplink.js    claude:// URL builders
src/server.js      HTTP API + SSE
web/               vanilla dashboard, no build step
```

State lives in `~/.orrery/` (`projects.json`, `settings.json`, `asks.json`,
`runs/`, `index.json`). Nothing in `~/.claude` is ever written to.

Adding a template is one entry in `src/templates.js`. Adding a project kind that
needs different permissions is a `permissionArgs` field on the project record.

## Requirements

- Node 20+
- Claude Code desktop app (for the `claude://` links)
- A signed-in `claude` CLI (for headless runs) — run `claude` once in a terminal.
  If it is not signed in, the dashboard says so; the rest still works.

## Known edges

- Deep links are macOS-tested. The `claude://` scheme is registered by the desktop
  app on other platforms too, but the `open` shim in `bin/orrery.js` only falls
  back to `xdg-open` / `start`.
- `needsInput` is inferred: a session is waiting if its process is alive and its
  transcript ends on an assistant turn with no tool call. That is accurate in
  practice but it is inference, not a flag the app sets.
- Token totals include cache reads, which dominate. They measure activity, not spend.
  The `auto spend` figure is real — it comes from `total_cost_usd` on headless runs.
