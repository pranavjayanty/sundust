// Templates make "start a new project" a single click: they scaffold the folder,
// write a CLAUDE.md that teaches the agent the project's shape, and pre-load an
// agenda so the project starts doing work on its own from day one.

const common = (name) => `# ${name}

## Working agreement with Sundust

This project is monitored by Sundust, which runs scheduled autonomous sessions here.

- Keep durable state in \`data/\` as plain files (JSON / JSONL / Markdown). No database.
- Keep a running log in \`NOTES.md\`: what changed, what you decided, what is still open.
- Never ask a question in the middle of the work. Do everything you can do
  unattended first, then, if a decision genuinely needs the human, end your final
  message with a line in exactly this form:

  NEEDS INPUT: <the single question, self-contained>

  Sundust watches for that line and surfaces it as a card the human can answer in
  one click. One question per run; pick the most blocking one.
- If nothing needed doing, say so in one line. Do not invent busywork.
`;

export const TEMPLATES = {
  blank: {
    label: 'Blank',
    emoji: '◇',
    accent: '#8b9bb4',
    blurb: 'An empty project wired into Sundust.',
    dirs: ['data'],
    claudeMd: (n) => common(n),
    seed: (n) => `This is a brand new project called "${n}". Read CLAUDE.md, then ask me what I want to build here — keep it to a few sharp questions, then scaffold a first version.`,
    agenda: []
  },

  finance: {
    label: 'Personal finance',
    emoji: '◈',
    accent: '#4ade80',
    blurb: 'Track accounts, categorise spend, flag anomalies.',
    dirs: ['data/statements', 'data/ledger', 'reports'],
    claudeMd: (n) => `${common(n)}
## Domain

A personal finance tool.

- \`data/statements/\` — raw exports the human drops in (CSV/OFX). Treat as read-only.
- \`data/ledger/ledger.jsonl\` — one normalised transaction per line:
  \`{ "date", "amount", "currency", "merchant", "account", "category", "source", "id" }\`
- \`data/rules.json\` — merchant → category rules. Prefer adding a rule over
  hand-categorising the same merchant twice.
- \`reports/\` — generated Markdown summaries. Overwrite freely.

Categorise deterministically from \`rules.json\` first. Only use judgement for
merchants the rules do not cover, and when you do, write a new rule.

Never fabricate a transaction. If a statement is unparseable, say so.

## Privacy

This data is sensitive. Never send it anywhere outside this folder, and never
include account numbers in reports.`,
    seed: (n) => `Set up "${n}", my personal finance tool. Read CLAUDE.md. Build the ingest pipeline: a script that reads any CSV dropped into data/statements/, normalises it into data/ledger/ledger.jsonl, and applies data/rules.json for categorisation. Then write me a report generator for a monthly summary. Ask me for a sample statement format if you need one.`,
    agenda: [
      { title: 'Ingest new statements', schedule: '0 7 * * *',
        prompt: 'Check data/statements/ for files not yet in the ledger. Ingest and categorise them. Add rules for any repeat merchant you had to judge by hand. Append a short entry to NOTES.md.' },
      { title: 'Weekly spend report', schedule: '0 8 * * 1',
        prompt: 'Generate this week’s spending report into reports/. Compare to the trailing 4-week average, and call out anything unusual — new merchants, categories up more than 40%, duplicate charges, subscriptions that changed price.' }
    ]
  },

  recipes: {
    label: 'Cooking & recipes',
    emoji: '◔',
    accent: '#fb923c',
    blurb: 'Recipe box, pantry, and what to cook this week.',
    dirs: ['data/recipes', 'data', 'plans'],
    claudeMd: (n) => `${common(n)}
## Domain

A cooking and recipe tool.

- \`data/recipes/<slug>.md\` — one recipe per file. Front matter:
  \`title, servings, time_min, cuisine, tags, source, last_cooked, rating\`
  then \`## Ingredients\` (one per line, \`amount unit item\`) and \`## Method\`.
- \`data/pantry.json\` — what is currently in the kitchen.
- \`plans/\` — weekly meal plans and the shopping list that falls out of them.

When the human dumps in a recipe from anywhere (a link, a photo, a paste),
normalise it into the format above rather than storing it raw.

Scale ingredients honestly — do not silently round spices into nonsense.`,
    seed: (n) => `Set up "${n}", my cooking and recipe tool. Read CLAUDE.md. Build: (1) a normaliser that turns any pasted or linked recipe into the standard file format, (2) a pantry-aware "what can I cook tonight" query, (3) a weekly meal planner that emits a consolidated shopping list. Start with the file format and one example recipe so I can see the shape.`,
    agenda: [
      { title: 'Plan the week', schedule: '0 17 * * 6',
        prompt: 'Draft next week’s meal plan into plans/. Favour recipes not cooked recently, use up anything in data/pantry.json that is about to turn, and keep weeknights under 40 minutes. Emit the consolidated shopping list grouped by aisle.' }
    ]
  },

  fitness: {
    label: 'Exercise logger',
    emoji: '▲',
    accent: '#60a5fa',
    blurb: 'Log sessions, track progression, plan the next block.',
    dirs: ['data', 'reports'],
    claudeMd: (n) => `${common(n)}
## Domain

An exercise logger.

- \`data/log.jsonl\` — one session per line:
  \`{ "date", "type", "exercises": [{ "name", "sets": [{ "reps", "weight_kg", "rpe" }] }], "duration_min", "notes" }\`
- \`data/program.md\` — the current training block: goal, split, progression rule.
- \`reports/\` — generated progression charts and block reviews.

Accept messy input. "squat 5x5 100kg, felt easy" is a valid log entry; parse it
into the schema rather than making the human fill in fields.

Track progression per exercise as estimated 1RM (Epley) so sets across different
rep ranges stay comparable. Never invent a session that was not logged — a missed
week is data.`,
    seed: (n) => `Set up "${n}", my exercise logger. Read CLAUDE.md. Build: (1) a freeform parser so I can log a session in one natural-language line, (2) per-exercise progression tracking with estimated 1RM, (3) a block review that tells me what is stalling. Ask me what I currently train and how often, then write data/program.md.`,
    agenda: [
      { title: 'Weekly training review', schedule: '0 18 * * 0',
        prompt: 'Review the last week in data/log.jsonl against data/program.md. Report volume per movement pattern, any lift that has stalled for 3+ sessions, and whether I actually hit the programmed frequency. Write it to reports/ and keep it under a page.' }
    ]
  },

  journal: {
    label: 'Experience log',
    emoji: '◉',
    accent: '#c084fc',
    blurb: 'Restaurants, travel, films — things worth remembering.',
    dirs: ['data/entries', 'data', 'reports'],
    claudeMd: (n) => `${common(n)}
## Domain

An experience log — restaurants, travel, films, concerts, anything worth keeping.

- \`data/entries/<yyyy-mm-dd>-<slug>.md\` — one experience per file. Front matter:
  \`date, kind, title, location, companions, cost, rating\` then free-form notes.
- \`data/places.json\` — a rolled-up index of places, so "where did we eat in Lisbon"
  is one lookup and not a grep over everything.
- \`data/wishlist.md\` — things not done yet.

The human will log things in fragments, often late and out of order. Accept that.
Fill in what you can infer (a restaurant's cuisine and neighbourhood), mark what
you inferred, and never invent a rating or a detail they did not give you.`,
    seed: (n) => `Set up "${n}", my experience log for restaurants, travel and everything else worth remembering. Read CLAUDE.md. Build: (1) a capture path where I can log something in one messy line and you file it correctly, (2) the rolled-up places index, (3) recall queries like "best things we ate in Tokyo" or "what did we do last April". Show me one example entry first.`,
    agenda: [
      { title: 'Tidy and roll up entries', schedule: '0 20 * * 0',
        prompt: 'Normalise any entries added this week, rebuild data/places.json, and flag entries missing a rating or location that I should fill in. If something on data/wishlist.md was clearly done, move it across.' },
      { title: 'Monthly look back', schedule: '0 19 1 * *',
        prompt: 'Write a short look back at last month into reports/ — where we went, standouts, anything on the wishlist that is still untouched. Keep it warm and brief, not a spreadsheet.' }
    ]
  }
};

export const templateList = () =>
  Object.entries(TEMPLATES).map(([id, t]) => ({
    id, label: t.label, emoji: t.emoji, accent: t.accent, blurb: t.blurb,
    agendaCount: t.agenda.length
  }));
