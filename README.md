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

One screen, no hero block. It opens with the answer in a sentence — *"Nothing
needs you · 1 running"*, or *"2 projects need you"* — then the state counts as
what they always were: filters you can click. Plan usage sits beside them as a
sparkline over the window's recent history, not a single bare percentage.

The roster is a **table, not cards**. Cards stop working somewhere around eight
projects; a dense sortable table still works at forty. Rows group by state, sort
by any column, filter by name or path (`/`), and the whole row is one click into
whatever wants you — the row says which destination that is before you click.

The widest column is **Activity**: the question an agent is waiting on, the live
session's subject, the next scheduled task, or the last run's summary, in that
order of urgency. Nothing in the row is dead space.

Amber belongs to the wordmark and nothing else. Emphasis elsewhere is carried by
ink weight — a live count is bright, a zero is dim — and only failure gets a
second hue. Helvetica titles and labels, SF Pro for prose and data, monospace for
numerics so columns line up when you scan. **Every ink step used for type clears
4.5:1 in both themes**; there is a separate token for rules and tracks, and type
is never set in it.

Every project's session count is a disclosure. Open it and the roster lists
every transcript in that project — live first, then whatever is waiting on you,
then by recency — each with one click back into where it left off.

Click a project and the **drawer** opens: everything you can read about it and
everything you can do to it, without leaving the console.

- **Needs you** — the question an agent stopped on, with the context it had,
  and a box to answer it. Send, and the run continues headless in the same
  session; the result lands under Runs.
- **Sessions** — every transcript, each with *Open* (in the app) and
  *Continue…* (send it a message; it carries on headless).
- **Agenda** — each task with a switch, its schedule in words, its priority
  and its next fire; *Run* it now, remove it, or add one with a cron and a
  prompt.
- **Runs** — every recent run with its full result or error, cost, turns, and
  whether its edits are waiting in Review.
- **Notes** — the `NOTE:` lines the project has accumulated, which every later
  run reads first.
- **Settings** — autonomy, pin, archive, and stop tracking.

*Jump*, in the row, skips the drawer and opens the session in the app.

Type is fluid: one root size that grows with the window from 15px to 20px,
and every size on the page is a multiple of it. The cheat sheet has a
compact / comfortable / spacious switch on top of that. The footer's autonomy
switch pauses every scheduled run in every project, and resumes them.

Nothing is left to be guessed at: column headers, section labels and controls
carry hover text, and `?` opens a sheet that says what every word on the page
means, built from the same state and harness definitions the app runs on.

Keyboard: `⌘K`/`Ctrl K` for the palette, `n` for a new project, `/` to filter,
`t` for the theme, `?` for the cheat sheet. In the roster, Tab moves between
rows, `↑↓` moves between them, `→` reaches a row's actions and its session
list, and `↵` opens it.

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
texture rather than decoration. One shared pointer listener drives every mark and
marks outside the viewport are skipped. The loops stop when there is nothing to
animate: once the pointer leaves and the easing settles, no frame is scheduled
until something moves again, and nothing runs behind a hidden tab. Under
`prefers-reduced-motion` — or on a page that loads hidden — the texture is still
painted once; only the motion is withheld. If it competes with the text on your
display, the cheat sheet (`?`) has a switch that turns it off for good.

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
click through and keep talking to it with full context — or answer it from the
console and let it carry on headless. `POST /api/run` with `resumeSessionId`
continues any session with a prompt (`claude -p … --resume <id>`), and an
`askId` alongside it settles the open question.

## The autonomy loop

Every scaffolded project's brief teaches the agent three conventions:

> `NEEDS INPUT: <question>` when a decision genuinely needs you.
> `NOTE: <one line>` for anything that should outlive this run.
> `EMIT: <event> <context>` when another project now has something to do.

Sundust routes all three: questions become blocked rows you resume in one click,
notes accumulate into durable project memory, and events fire runs in whichever
projects subscribe to them.

### Safe edits

`edit` autonomy is only reasonable because nothing an agent writes is final.

Before any run that may write, Sundust checkpoints the tree — HEAD plus the
content of anything already dirty. Afterwards it records exactly which files
changed and what they hash to. Those land in a **review queue**: the edits made
while you were away, with per-file line counts and Keep / Revert / Open.

Revert restores each file to its pre-run content and **refuses any file you have
touched since**, reporting those back rather than overwriting your work. It never
rewrites history and never touches the index.

Projects with `edit` autonomy but no git repository are flagged *unprotected* in
the roster, because there is nothing to checkpoint against.

### Spending the plan deliberately

The scheduler reads your live usage before it fires anything. Tasks carry a
priority (`low`, `normal`, `critical`) and yield in that order as the weekly
window fills — and they yield to you first: while your own 5-hour window is
busy, unattended runs wait rather than competing with the session you are
actually sitting in. Anything held back says so under the schedule.

This is the clearest thing a harness cannot do for you, because it needs the
whole fleet and the live usage curve at once.

### Did the work survive?

Every reviewed run keeps the before and after hash of each file it touched, so
Sundust can answer later whether its output was **kept**, **reverted**, or
**superseded**. Over enough runs that tells you which agenda tasks earn their
tokens.

### Looking outside the project folder

Read-only work often needs data that does not live in the repo. A project can
list `extraDirs`, and a single task can add its own `dirs`; both become
`--add-dir` on the run. Without this a `read` run is denied the file and has to
come back and ask you for access, which wastes the run.

### Autonomy levels

Set per project. New projects default to `read`.

| Level | What a scheduled run may do |
|---|---|
| `off` | Nothing runs unattended |
| `read` | Look around and report; writes and shell are denied |
| `edit` | Change files in the project, checkpointed and reviewable |

Two further guards, both on by default: the scheduler **skips any project with a
live interactive session**, and `autonomyEnabled` is a global kill switch.

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

- `⌘K` / `Ctrl K` — palette: jump to a session, run a task, start something new
- `n` — new project
- `/` — focus the roster filter
- `t` — toggle the theme

In the roster: Tab between rows, `↑↓` to move, `→` to reach a row's session
list and actions, `←` to come back, `↵` to open the drawer. In a reply box,
`⌘↵` sends.

## Layout

```
src/config.js      paths, settings
src/harnesses.js   harness definitions       ← add a harness here
src/usage.js       plan usage, read from the desktop app's own record
src/states.js      project state mapping
src/checkpoint.js  git checkpoint, diff, verdict and revert
src/scan.js        incremental transcript indexer + live-process detection
src/projects.js    registry, scaffolding, relocation, auto-discovery
src/templates.js   project templates         ← add your own here
src/autonomy.js    cron, headless runner, NEEDS INPUT parsing
src/claude-tasks.js reads Claude Code's own scheduler
src/deeplink.js    harness-aware links
src/server.js      HTTP API + SSE
web/field.js       full-viewport line field with pointer gravity
web/marks.js       small reactive marks (dots, rings, hatch)
web/app.js         wiring: boot, update loop, global keys
web/css/           tokens → base → components → views
web/lib/           dom, format, api, store, derive
web/ui/            theme, toast, links, dialogs, palette, help, drawer
web/views/         warn, lede, roster, schedule, review, panels
```

The console is vanilla ES modules with no build step. State lives in one store;
a payload that has not changed notifies no view, so the server's heartbeat costs
a JSON parse rather than a full teardown, and a row you are hovering or have
tabbed to stays where it is.

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

## Keeping unattended runs authenticated

Two different credentials, and the difference matters for a scheduler:

| | `claude auth login` | `claude setup-token` |
|---|---|---|
| Lifetime | 8–12 hours, auto-refreshed | about a year |
| Built for | Sitting at the keyboard | Headless and unattended |
| Delivered as | Keychain entry | `CLAUDE_CODE_OAUTH_TOKEN` |

An interactive login is the wrong footing for overnight work: when its refresh
fails, every scheduled run fails with it. Prefer a long-lived token, and export
it in whatever shell you start Sundust from — it reaches runs through the
process environment, so a daemon launched from launchd or another terminal
will not see a token exported only in your interactive shell.

Store the token with Sundust rather than exporting it, and runs stop depending
on which shell started the daemon:

```
claude setup-token          # mint it
sundust auth                # paste it; input is hidden, nothing hits scrollback
```

It lands in `~/.sundust/credentials.json` at mode 600 and is injected into each
run's environment. An explicit shell export still wins, so nothing changes if you
prefer the environment.

Sundust checks this up front: it reports a signed-out harness before anything
runs, and separately warns when a harness works now but holds no long-lived
token — that combination works today and stops working tomorrow.

One limit worth knowing: `claude auth status` validates a token's shape, not the
token, so a revoked or expired one still reads as signed in. Runs are the only
thing that finds out, so their auth failures are surfaced as a second signal.

If a login appears to succeed but nothing changes, inspect the stored record
rather than its timestamp — a hollow entry (`accessToken: ""`) reads as
"present" while being useless. Deleting the Keychain item
(`security delete-generic-password -s "Claude Code-credentials"`) and signing in
again clears that state.

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
