# Sundust

Mission control for the projects you run with a coding agent. Local-first, no
account, no cloud.

A single screen that answers "what needs me, what is running, what broke" and
gets you into the session in one click.

```bash
node bin/sundust.js up
```

Serves the dashboard on `http://127.0.0.1:4173` and starts the scheduler.

That scheduler stops when the terminal closes. To make "runs while you are
away" actually true:

```bash
node bin/sundust.js install     # starts at login, restarts if it dies, logs to ~/.sundust/log
node bin/sundust.js service     # is it installed and running?
node bin/sundust.js logs        # the last 80 lines
```

`sundust uninstall` removes it. macOS (launchd) for now.

## The console

A sidebar, a heading that says the answer, and cards.

The sidebar is the set of views — all projects, needs you, running, scheduled,
idle — each with its count, plus your pinned projects and the fleet-wide
autonomy switch. The heading says it in a sentence: *Nothing needs you ·
1 running*, or *2 projects need you*. Under it, five cards: the three counts
as filters, and the two plan windows drawn as sparklines from their sample
history.

The roster is a **table in a card**. Cards stop working somewhere around eight
projects; a dense sortable table still works at forty. Every project has a
tile on its own colour, a status badge, an **Activity** column that carries the
most urgent true thing about it — the question an agent is waiting on, the
live session's subject, the next scheduled task, or the last run's summary —
and a session count that opens into every transcript with a Resume button.
Rows group by status, sort by any column, and filter by name or path (`/`).

Click a project and the **panel** opens on the right, in tabs:

- **Overview** — the question an agent stopped on, with the context it had and
  a box to answer it; the run continues headless in the same session.
- **Sessions** — every transcript, each with *Open* (in the app) and
  *Continue* (send it a message; it carries on headless).
- **Agenda** — each task with a switch, its schedule in words, priority and
  next fire; run it now, remove it, or add one with a cron and a prompt.
- **Runs** — every recent run with its full result or error, cost and turns.
- **Notes** — the `NOTE:` lines the project has accumulated, and the events it
  has raised or listens for.
- **Settings** — autonomy, what it listens for, pin, archive, stop tracking.

*Jump*, in the row, skips the panel and opens the session in the app.

Inter — vendored, no network needed — on a fluid root that grows with the window from 16px to 20px; every size
on the page is a multiple of it, and the cheat sheet (`?`) has a compact /
comfortable / spacious switch on top. Bright text on layered dark surfaces —
body 18:1, secondary 13:1, the softest label 8:1 — and a light theme that is
its own palette, not an inversion. Status is colour: amber needs you, green
running, blue scheduled, red failed.

Keyboard: `⌘K`/`Ctrl K` for the palette, `n` for a new project, `/` to filter,
`t` for the theme, `?` for the cheat sheet. In the roster, Tab moves between
rows, `↑↓` moves between them, `→` reaches a row's session list and actions,
`↵` opens the panel. In a reply box, `⌘↵` sends.

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
that harness's transcripts, so its sessions will not appear in the roster and
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
src/server.js      HTTP API + SSE, request guard
src/service.js     launchd login service: install, status, logs
web/app.js         wiring: boot, update loop, global keys
web/css/           tokens → base → components → views
web/lib/           dom, format, api, store, derive
web/ui/            theme, toast, links, dialogs, palette, help, drawer (the panel)
web/views/         sidebar, stats, roster, schedule, review, runs, warn
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

## Managing it from your phone

Sundust is local-first on purpose: the transcripts, the harness and the
`claude://` links all live on one Mac. Nothing about that has to change to
run it from a phone or an iPad — the Mac stays the runner, and the other
device is a remote control. Everything that matters remotely already works
headless: answering a question, continuing a session, running or editing the
agenda, reviewing edits, pausing the fleet. Only *Jump* and *Open* (which
launch the app on the Mac) are Mac-only, and the console says so when you
are remote.

The recommended path is [Tailscale](https://tailscale.com): a private network
between your own devices, with identity and TLS handled for you, and nothing
exposed to the internet.

```bash
# on the Mac, once
node bin/sundust.js install                       # runs at login
tailscale serve --bg 4173                         # https://<mac>.<tailnet>.ts.net → localhost:4173
node bin/sundust.js remote add <mac>.<tailnet>.ts.net
```

Then open that URL on the phone (on the same tailnet) and *Add to Home
Screen* — the console ships a manifest, so it installs as an app. Requests
still arrive on loopback: Tailscale terminates the connection on the Mac and
forwards it, so the server never binds to anything but `127.0.0.1`, and the
`Host` allowlist is the only thing that changes.

If you must reach it from outside your tailnet, put it behind a tunnel with a
login in front (Cloudflare Tunnel + Access, ngrok with OAuth) and add that
hostname the same way. Do not port-forward it.

**Do you need remote agents?** Only if you want runs to happen while the Mac
is off. Moving the runner to the cloud (Claude Code on a server, or a managed
agent platform) means the repos, the transcripts and the credentials move
too, and the app-side links stop meaning anything — a different product. For
"the Mac is on, I am not at it", Tailscale plus the login service is the whole
answer. Set the Mac not to sleep, or leave a `caffeinate -s` running.

## The local API is not open to the web

The server binds to `127.0.0.1`, which keeps other machines out and does
nothing about the browser on this one: any page you have open can send a
request to localhost, and a `text/plain` POST needs no preflight. Before this
was closed, a page could `PATCH /api/project` with a `bin` of its choosing and
then `POST /api/run`.

Three checks in `src/server.js` close it. The `Host` header must be a loopback
name (defeats DNS rebinding). Anything that mutates must be JSON and carry an
`x-sundust-client` header — a custom header forces a preflight, and the
preflight is answered with no CORS grant. And `PATCH /api/project` and
`/api/settings` accept only the fields a browser may change: `bin`, `path` and
`bins` are set from the CLI or `settings.json`, never over HTTP.

Calling the API from a script:

```bash
curl -X POST http://127.0.0.1:4173/api/run \
  -H 'content-type: application/json' -H 'x-sundust-client: 1' \
  -d '{"projectId":"…","prompt":"…"}'
```

## Tests

```bash
npm test
```

`node --test`, no dependencies. The suite that matters is
`test/checkpoint.test.js`: a run edits a file and creates another, you then
edit the first one yourself, and revert must restore the second and refuse the
first. The API suite proves the request guard above. Everything runs against a
throwaway `SUNDUST_HOME`.

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
