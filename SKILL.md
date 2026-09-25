---
name: repocast
description: Turn a repository or a pull request into a narrated architecture video. Use when the user asks to "make a video of this repo/PR", wants an animated system walkthrough, an architecture tour, a PR explainer video, or a demo reel of how a service fits together.
---

# repocast

Produce a narrated, animated architecture video from a codebase.

The pipeline is four stages joined by JSON files. You own stage 1 — reading the
system and deciding what matters. The rest are deterministic CLI commands in
`renderer/`; do not reimplement them in prose.

Write your JSON into `renderer/out/`, which is where the CLI reads and writes.

```
1. extract  you            -> out/<name>.system-map.json + out/<name>.script.json
2. layout   repocast CLI   -> out/layout.json          (elkjs)
3. voice    repocast CLI   -> out/audio/*.mp3, out/timing.json  (ElevenLabs)
4. render   repocast CLI   -> out/video.mp4            (Remotion)
```

Schemas live in `renderer/src/schema.ts`. Read it before writing any JSON — it is
the contract, and it carries the reasoning for each field.

## The voice stage costs real money — earn it

ElevenLabs bills **one credit per character of narration**. A ten-scene tour is
around 2,600 credits; a PR video around 1,200. That is cents, but it is charged
again in full every time you re-run the voice stage, so a sloppy loop costs more
than the video.

The order below is not a suggestion. Everything before step 4 is free.

```bash
cd renderer   # all commands run from here

# 1. pre-flight: layout geometry + cue resolution + what the voice will cost
node --experimental-strip-types src/cli.ts check out/x.system-map.json out/x.script.json

# 2. fake the timing at ~2.8 words/sec — no API call
node --experimental-strip-types src/cli.ts voice out/x.script.json --silent

# 3. render silent and LOOK AT IT (see Review below)
node --experimental-strip-types src/cli.ts render out/x.system-map.json out/x.script.json

# 4. only now, the paid pass
node --env-file=.env --experimental-strip-types src/cli.ts voice out/x.script.json
node --experimental-strip-types src/cli.ts render out/x.system-map.json out/x.script.json

# fixed a cue afterwards? re-resolve beats against audio you already paid for
node --experimental-strip-types src/cli.ts voice out/x.script.json --reuse
```

`check` exits non-zero and lists what is wrong. Do not proceed past a failing
check by rendering anyway.

On a machine that has never rendered, run `pnpm setup` in `renderer/` first. If
`ELEVENLABS_API_KEY` is missing from `renderer/.env`, say so and deliver the
silent render rather than failing the job — the animation and captions still
carry the content.

**Voice ids.** A free ElevenLabs plan rejects *library* voices with a 402; only
premade ones work (`JBFqnCBsd6RMkjVDRZzb` George, `onwK4e9ZLuTAKqWW03F9` Daniel).
If a voice id 402s, that is the plan, not the id — say so instead of silently
substituting a different voice.

## Stage 1 — extract the system map

This is the only step that needs judgement. Everything the video says comes from
here, so be accurate and be brief.

**Look for an existing architecture doc before deriving your own.** Search
`docs/`, `README.md` and any `*.md` for an ASCII diagram or a "Problem Statement"
section. A team that has written its own architecture down has also told you the
story spine and the vocabulary; deriving a worse version from the source tree
next to it is wasted work and usually wrong.

**Then read in this order.** Infrastructure first: it states what exists, where
application code only implies it.

1. IaC — `terraform/**/*.tf`, `wrangler.jsonc`, `serverless.yml`, `docker-compose.yml`, k8s manifests. Nodes and groups come from here.
2. CI/CD — `.github/workflows/**`. Tells you what is independently deployable, and to which environments.
3. Manifests — root and per-package `package.json`, `Cargo.toml`, `go.mod`. The service inventory, and the client SDKs each service talks through.
4. Entry points — route files, handlers, queue consumers, cron definitions, durable objects. This is where edges come from.
5. `CLAUDE.md`, `AGENTS.md`, `docs/specs/**`. The names the team actually uses.

**Rules that decide whether the video is good.**

- **12 to 18 nodes.** Past that no camera move can keep it readable. Collapse a
  cluster into one node and say so in its summary.
- **Every node needs a `source`.** A repo path that proves it exists. If you
  cannot cite one, you inferred it — verify or drop it.
- **Only map what runs in production.** A `docker-compose.yml` service, a
  `supabase/config.toml` with a `*-local` project id, a mock provider — these are
  development scaffolding. Putting them on the diagram tells the viewer something
  false about the system.
- **Name things the way the team names them.** Getting a house term wrong reads
  as sloppiness in a way nothing else does.
- **Write `summary` as one spoken sentence**, not a doc line. It is the raw
  material for narration.
- **Flows are mandatory.** Two or three named paths through the graph. Without
  them you get a video that pans around describing boxes.
- **Prefer the interesting constraint over the component list.** "A Worker has
  no VPC, so the path to a private database is three hops" is the scene worth
  building. "There is a database" is not.

## PR mode

A PR video is 30–60 seconds and answers one question: **what does this change,
and where does it land in the system?** It is not a tour with a diff bolted on.

```bash
gh pr view <n> --json title,body,url,files
gh pr diff <n>
```

1. **Build the full map first**, exactly as above. A diff is only legible against
   the system it lands in — you cannot skip this and describe files instead.
2. **Fill `project.pr`** with the number, title and url. It renders in the header.
3. **Fill `change`**:
   - `nodes` / `edges` — ids the diff touched, however lightly.
   - `added` / `removed` — ids this PR introduced or deleted.
   - `summary` — one sentence on what the PR does, in the system's terms, not the
     diff's. "Rewards above 100% now pass validation" beats "raises MAX_RATE to 200".
   The renderer draws `added` in green and touched ids in amber, so a viewer sees
   the blast radius before the narration reaches it.
4. **Keep the map whole.** Do not prune untouched nodes — the unchanged
   surroundings are what make the change mean something.

**A good PR author has already written your script.** If the description has a
"worth your attention" or "the part that needed care" section, that is the middle
of the video. Follow the author's own ordering of what matters.

**Scripting a PR.** Three to five scenes:

- **Open on the system, not the diff.** One wide scene naming the part of the
  system this PR lives in.
- **Then the change**, on the amber/green region. What it was, what it is now.
- **Then what the reviewer should carry into the review** — the risk the author
  flagged, the thing not covered, the ordering that matters.
- **End on consequence.** What can happen that could not before. If a PR has no
  observable consequence, say that plainly; a refactor video pretending to be a
  feature video is worse than no video.
- **Only name a file path if the reviewer needs it to find something.**

A PR whose diff touches nothing in the map — test-only, docs-only — does not need
a video. Say so instead of making one.

## Stage 2 — script

Write `<name>.script.json` next to the map. This is a screenplay, not
documentation.

- **One idea per scene**, 6–10 scenes for a repo, 3–5 for a PR.
- **Speak, don't write.** Contractions, short sentences. Read it out loud; if you
  run out of breath, it is too long.
- **Open with the point of the system,** not its topology. "This is the service
  that turns a payment into a reward" beats "This system has six Lambdas".
- **Pin every beat to a word you actually say.** `cue` must appear verbatim in
  that scene's `narration`. The voice stage matches it against ElevenLabs' word
  alignment, so motion lands on the syllable.
- **Count before you set `nth`.** `nth` is 1-based over occurrences of the cue in
  *that scene's* narration. If you think a word appears twice, count it. A cue
  that resolves to nothing pins its beat to the scene start, which looks like a
  bug in the animation rather than a typo in the script.
- **Pick distinctive cue words.** "Aurora" is a good cue; "the" and "service" are
  not. Short, rare, and unambiguous within the sentence.
- **`focus` drives the camera.** Empty `focus.nodes` and `focus.edges` = wide
  shot. Keep consecutive scenes adjacent on the diagram; a camera that teleports
  across the canvas every scene is exhausting.
- **Three or four beats per scene, maximum.** Silence and stillness are what make
  the motion mean anything.
- **End on consequence,** not on a component.

Beat vocabulary: `highlight` (pulse a node), `flow` (send a packet down an edge),
`reveal`, `badge` (pop a short label), `dim`.

## Review — look at the frames, do not assume

You cannot scrub a video, so extract stills and actually look at them. Do this on
the **silent** render, before spending anything.

```bash
for t in 5 20 40 60; do
  ffmpeg -v error -ss $t -i out/video.mp4 -frames:v 1 -vf scale=1100:-1 -y out/frames/t$t.png
done
```

Then check:

- Is the diagram a thin strip? `check` reports the aspect ratio; over ~2.6 the
  wide shots will be unreadable. Collapse nodes rather than accepting it.
- Do two consecutive scenes focus on opposite corners? Reorder.
- Does a beat fire before its node is on screen? Move the cue later in the sentence.
- Is anything on screen the narration never mentions? Either say something about
  it or cut it from the map.
- Are edge labels overlapping each other in a dense region? Shorten them; `check`
  also lists labels dropped as unplaceable.

After the paid pass, verify the audio actually landed — every scene, not just the
first:

```bash
ffmpeg -i out/video.mp4 -af silencedetect=noise=-45dB:d=2 -f null - 2>&1 | grep silence_start
```

Long gaps mean scenes with no audio. Expect at most a short tail and the
`holdSec` pauses between scenes.

## What not to do

- Do not hand-write `layout.json` or `timing.json`. They are generated.
- Do not skip `check` because the map "looks fine". It costs nothing and it is
  the only thing standing between a typo and a paid re-run.
- Do not invent colours or spacing. `renderer/remotion/theme.ts` holds the
  WalletConnect tokens; if a value is missing, add it there from the registry,
  not inline.
- Do not use a second TTS provider. Beat timing depends on ElevenLabs' alignment
  payload.
- Do not put a component in the map because it is in the repo. Put it there
  because the story needs it.
- Do not claim the video is finished without having looked at a frame of it.
