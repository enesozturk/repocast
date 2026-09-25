# repocast

Turn a repository or a pull request into a narrated architecture video.

An agent reads the system and writes a map; the rest is deterministic code.
Four stages, joined by JSON files on disk, so any one of them can be inspected,
hand-edited and re-run on its own.

```
extract   agent skill    ->  system-map.json     what exists, what talks to what
layout    elkjs          ->  layout.json         geometry, orthogonal edge routing
voice     ElevenLabs     ->  audio/*.mp3 + timing.json
render    Remotion       ->  video.mp4
```

## Why it is built this way

**Remotion, not Lottie.** The video is React, so it can use WalletConnect's real
design tokens (`remotion/theme.ts`, copied from the UI registry) instead of a
lookalike re-drawn in animation JSON. Lottie still has a place for accent
motion — icons, stings — via `@remotion/lottie`.

**Word-level voice alignment.** ElevenLabs' `with-timestamps` endpoint returns
per-character timings. A scene's beats are pinned to *words* (`cue: "Aurora"`),
not to timestamps, so a node lights up exactly when the narrator says its name
and nothing breaks when a sentence is reworded.

**The agent only does the judgement.** Deciding what a system is and how to tell
its story is the part a model is good at. Layout, timing and rendering are code.

## Install

```bash
npx skills add enesozturk/repocast
```

That puts the skill where your agent looks for it — for Claude Code,
`~/.claude/skills/repocast`. The renderer travels with it, so one more step in
the installed directory:

```bash
cd ~/.claude/skills/repocast/renderer
pnpm setup
```

`pnpm setup` installs dependencies, pulls the headless browser Remotion renders
with, and creates `.env`. Then add your ElevenLabs key:

```
ELEVENLABS_API_KEY=sk_...
```

Rendering needs nothing else installed globally — Remotion manages its own
Chrome and ffmpeg.

### Using it

In any repository, ask your agent:

> make a repocast video of this repo

> repocast PR 1110

The agent reads the system, writes the map and the screenplay, then runs the CLI
in `renderer/`. `SKILL.md` carries the extraction and scripting rules — that file
is most of the product.

## Run it by hand

From `renderer/`. Everything before the last step is free — ElevenLabs bills one
credit per character of narration, and the voice stage recharges in full on every
re-run, so the loop is deliberately front-loaded with the free checks.

```bash
# pre-flight: layout geometry, cue resolution, and what the voice will cost
node --experimental-strip-types src/cli.ts check  examples/example.system-map.json examples/example.script.json

# fake the timing, render, and look at the frames — no API calls, no credits
node --experimental-strip-types src/cli.ts voice  examples/example.script.json --silent
node --experimental-strip-types src/cli.ts render examples/example.system-map.json examples/example.script.json

# the paid pass
node --env-file=.env --experimental-strip-types src/cli.ts voice out/x.script.json
node --experimental-strip-types src/cli.ts render out/x.system-map.json out/x.script.json

# fixed a cue afterwards? re-resolve beats against audio you already paid for
node --experimental-strip-types src/cli.ts voice out/x.script.json --reuse
```

`pnpm studio` opens Remotion Studio for frame-by-frame work.

## Two modes

**Repo tour** — 6–10 scenes over the whole system. Onboarding, or explaining a
service to another team.

**PR explainer** — 3–5 scenes, 30–60 seconds, answering "what does this change
and where does it land?". The map is still built in full; `change` marks what
the diff touched, and the renderer draws additions in green and edits in amber
so the blast radius is visible before the narration reaches it.

## Layout

```
SKILL.md                   the extraction and scripting rules — the actual product
renderer/src/schema.ts     the contracts, with the reasoning for each field
renderer/src/layout.ts     elkjs wrapper
renderer/src/voice.ts      ElevenLabs + cue resolution
renderer/src/cli.ts        layout | voice | render | build
renderer/remotion/theme.ts WalletConnect design tokens
renderer/remotion/         composition, camera, diagram, captions
renderer/examples/         one made-up system, documenting the file format
```

## Voices

`voice.voiceId` in the script must be a voice the API key can actually use.
ElevenLabs' free tier rejects **library** voices with a 402 — only the premade
ones work (e.g. `JBFqnCBsd6RMkjVDRZzb` George, `onwK4e9ZLuTAKqWW03F9` Daniel).
A paid plan lifts this; the id is the only thing that changes.
