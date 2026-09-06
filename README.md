# Sundust

Mission control for the projects you run with a coding agent. Local-first, no
account, no cloud.

A single screen that answers "what needs me, what is running, what broke" and
gets you into the session in one click.

```bash
node bin/sundust.js up
```

Serves the dashboard on `http://127.0.0.1:4173` and starts the scheduler.

## The console

One screen, no hero block. Five counters, your plan usage, and the roster — and
the roster is where the work happens.

The roster is a **table, not cards**. Cards stop working somewhere around eight
projects; a dense sortable table still works at forty. Rows group by state, sort
by any column, filter by name or path (`/`), and the whole row is one click into
whatever wants you. When something *is* on you, the row swaps the folder path for
the actual question the agent asked, so you can read the queue without opening
anything.

Amber belongs to the wordmark and nothing else. Emphasis elsewhere is carried by
ink weight — a live count is bright, a zero is dim — and only failure gets a
second hue. Helvetica titles and labels, SF Pro for prose and data, monospace for
numerics so columns line up when you scan.

Light and dark are both real themes from one token set. Toggle in the header,
with `t`, or from the palette; the choice is applied before first paint so there
is no flash.

## The field

The page sits on a live line field rather than inside boxes. Thirty-eight fine
streamlines drift across the viewport and **bend toward the pointer** — an
inverse-square falloff, so it curves like a lens instead of kinking, and eases so
the motion feels weighted. First contact snaps the well under the cursor rather
than dragging it in from off-screen.

Smaller marks answer the same gravity: a dot lattice on the counters that slides
and swells toward the pointer, concentric rings that lean, a hatch that shears.
All procedural, in the [Book of Shapes](https://bookofshapes.com) idiom — many
fine elements, one colour, no fill — and all under about 17% opacity so they stay
texture rather than decoration. One shared pointer listener drives every mark,
marks outside the viewport are skipped, and everything stops under
`prefers-reduced-motion`.

## States

| State | Means |
|---|---|
| **Needs you** | A run stopped on a question, or a live session is waiting at the prompt |
| **Failed** | The last unattended run ended in an error |
| **Running** | A live session or headless run is working right now |
| **Scheduled** | Nothing running, but agenda tasks will fire on their own |
| **Idle** | Nothing running and nothing scheduled |

## The three things it does

**1. Sees everything.** Reads every transcript your harness writes, incrementally
— it remembers the byte offset it stopped at, so a 65MB history costs ~200ms on
first scan and almost nothing after. It cross-references live process records to
know which sessions are actually running right now.

**2. Gets you back in, in one click.** Claude Code's desktop app registers a
`claude://` URL scheme. Sundust uses three routes:

| Link | Effect |
|---|---|
| `claude://code/new?folder=<path>&prompt=<text>` | New session in a folder, pre-seeded with a prompt |
| `claude://code/continue?session=local_<uuid>` | Jump straight into a specific session |
| `claude://code/needs-input` | Jump to whatever is waiting on you |

Session ids on disk are bare uuids; the app wants a `local_` prefix. The prompt
is truncated at 14336 characters.

**3. Keeps projects moving without you.** Each project carries an *agenda* — cron
tasks that run headless in that folder. Because a headless run writes a normal
transcript, an autonomous run **is** a resumable session: when one gets stuck you
click through and keep talking to it with full context.

## The autonomy loop

Every scaffolded project's brief teaches the agent one convention:

> Do everything you can do unattended. If a decision genuinely needs the human,
> end your final message with `NEEDS INPUT: <one self-contained question>`.

Sundust watches for that line, turns it into a card at the top of the dashboard,
and gives you an **Answer** button that opens the exact run that asked. The
project flares until you deal with it.

### Autonomy levels

Set per project. New projects default to `read`.

| Level | What a scheduled run may do |
|---|---|
| `off` | Nothing runs unattended |
| `read` | Look around and report; writes and shell are denied |
| `edit` | Change files in the project |

Two further guards, both on by default: the scheduler **skips any project with a
live interactive session** (two agents in one tree is how you lose work), and
`autonomyEnabled` is a global kill switch.

## Harnesses

Sundust is harness-agnostic in structure, and Claude Code is the default and the
only one fully wired. Others carry enough plumbing to launch and schedule.

| Harness | Support | What works |
|---|---|---|
| **Claude Code** (default) | `full` | Transcript indexing, live-session detection, deep links, headless runs, cost and token accounting |
| Codex CLI | `launch-only` | Headless runs and scheduling. Sandbox modes map to autonomy levels |
| Gemini CLI | `launch-only` | Headless runs and scheduling. `--yolo` maps to `edit` |
| OpenCode | `launch-only` | Headless runs and scheduling |

`launch-only` means Sundust can start and schedule work but does not yet parse
that harness's transcripts, so its sessions will not appear on the star field and
there is no deep link — the card falls back to revealing the folder. Adding one is
a single entry in `src/harnesses.js`: a binary name, an argument builder, a result
parser, and optionally a URL scheme.

## Plan usage

The strip at the top is your fuel gauge: the plan constraints that actually bind,
with a sparkline of the last twelve days and the peak you hit.

These are the same numbers `/usage` shows. The desktop app polls its usage
endpoint every ~15 minutes and appends a sample to
`~/Library/Application Support/Claude/plan-usage-history.json`; Sundust only
reads that file. Nothing here calls an API or touches a credential.

Constraints are rendered from whatever keys the app reports (`fh` = 5-hour,
`sd` = weekly across all models), so a limit that appears later shows up without
a code change. "Reset N ago" is the last time the number was actually observed
to fall — an observation, not a predicted schedule, because the local history is
too sparse to infer a reset cadence reliably.

Token counts and prices are deliberately absent. Cumulative tokens are dominated
by cache reads and tell you nothing about whether you can keep working; the plan
percentages do.

## Two schedulers

Claude Code ships its own scheduled tasks at
`~/.claude/scheduled-tasks/<id>/SKILL.md`, run by the desktop app. Sundust reads
that directory and shows those tasks on the matching project card with a
different glyph, so one screen answers "what runs on its own?" regardless of
which scheduler fires it. Sundust never triggers them — they belong to the app.

Claude's own scheduler survives Sundust not running. Sundust's agenda gives you
run history, cost, the `NEEDS INPUT` inbox, and a resumable session per run.

## Templates

| Template | What it sets up |
|---|---|
| `blank` | Empty project wired into Sundust |
| `finance` | Statement ingest → normalised ledger → rules-based categorisation → weekly report |
| `recipes` | Recipe box, pantry, weekly plan with a consolidated shopping list |
| `fitness` | Freeform session logging, estimated-1RM progression, weekly block review |
| `journal` | Restaurants / travel / films, rolled-up places index, monthly look back |

## CLI

```
sundust up                 dashboard + scheduler
sundust serve              dashboard only
sundust daemon             scheduler only

sundust new <name>         scaffold a project and open your harness in it
                           --template blank|finance|recipes|fitness|journal
                           --autonomy off|read|edit
sundust adopt [dir]        bring an existing folder into Sundust
sundust relocate <m> <dir> point a project at a folder you moved
sundust ls [--v]           list projects and status
sundust next               jump to whatever is waiting on you
sundust go [match]         open a project's most relevant session
sundust run <match> [task] run an agenda task now, headless
```

`sundust next` is the one worth aliasing.

## Keyboard

- `⌘K` — palette: jump to a session, run a task, look up a limit, start something new
- `n` — new project

## Layout

```
src/config.js      paths, settings
src/harnesses.js   harness definitions       ← add a harness here
src/usage.js       plan usage, read from the desktop app's own record
src/states.js      project state mapping
src/scan.js        incremental transcript indexer + live-process detection
src/projects.js    registry, scaffolding, relocation, auto-discovery
src/templates.js   project templates         ← add your own here
src/autonomy.js    cron, headless runner, NEEDS INPUT parsing
src/claude-tasks.js reads Claude Code's own scheduler
src/deeplink.js    harness-aware links
src/server.js      HTTP API + SSE
web/field.js       full-viewport line field with pointer gravity
web/marks.js       small reactive marks (dots, rings, hatch)
web/               vanilla console, no build step
```

When a project folder moves, `sundust relocate` records the old path as an alias.
Transcripts store the working directory they ran in, so without that alias every
session from before the move would detach.

State lives in `~/.sundust/`. Nothing in `~/.claude` is ever written to.

## Prior art

Star counts as of September 2026:

| Project | Stars | What it is |
|---|---|---|
| [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) | 39k | Teams-first multi-agent orchestration |
| [claude-code-router](https://github.com/musistudio/claude-code-router) | 37k | Control plane for routing across models |
| [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control) | 6.2k | Self-hosted control plane: dispatch, review runs, track spend |
| [21st-dev/1code](https://github.com/21st-dev/1code) | 5.6k | Orchestration layer for coding agents |
| [phuryn/claude-usage](https://github.com/phuryn/claude-usage) | 2.2k | Token and cost dashboard over the same local logs |
| [Ark0N/Codeman](https://github.com/Ark0N/Codeman) | 742 | Agents 24/7 from any device |
| [h0x91b/dev-3.0](https://github.com/h0x91b/dev-3.0) | 252 | Kanban where every card is a live agent in its own worktree |
| [lacion/fleet-deck](https://github.com/lacion/fleet-deck) | 28 | Control plane for every session on one machine |

Every one is a **developer-workflow** tool: parallel agents on a codebase, git
worktrees, kanban of coding tasks. Sundust is aimed elsewhere — long-lived
personal projects that happen to be built with an agent, each moving on its own
over weeks, where the question is not "which agent is on which branch" but "which
of my things needs me today".

Borrowed from Fleet Deck: the rule that the tool must never become a dependency
of the loop it observes (Sundust only ever reads harness state), and its conflict
awareness (the scheduler refuses to run where a human already is).

## Requirements

- Node 20+
- For deep links: the Claude Code desktop app
- For headless runs: a signed-in harness CLI. If `claude` is not signed in, the
  dashboard says so and the rest still works.

## Known edges

- Deep links are macOS-tested; the `open` shim falls back to `xdg-open` / `start`.
- `needsInput` is inferred: a session is waiting if its process is alive and its
  transcript ends on an assistant turn with no tool call. Accurate in practice,
  but inference, not a flag the harness sets.
- Token totals include cache reads, which dominate. They measure activity, not
  spend. The `auto spend` figure is real — it comes from the harness's own
  reported cost on headless runs.
