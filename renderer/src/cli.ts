#!/usr/bin/env node
/**
 * repocast — repo/PR -> narrated architecture video.
 *
 * Stage 1 (extract) is deliberately absent from this CLI: writing the system map
 * is a judgement call, so the agent skill does it and drops the JSON here.
 * Everything downstream is deterministic and lives in code.
 *
 *   repocast check  <map> <script>        -> pre-flight; costs nothing
 *   repocast layout <map.json>            -> out/layout.json
 *   repocast voice  <script.json>         -> out/audio/*.mp3 + out/timing.json
 *   repocast render <map> <script>        -> out/video.mp4
 *   repocast build  <map> <script>        -> all three, in order
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeLayout } from './layout.ts'
import { Layout, Script, SystemMap, Timing } from './schema.ts'
import { locateCue, resolveCue, retime, synthesize } from './voice.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'out')
const FPS = 30

const readJson = async (path: string) => JSON.parse(await readFile(resolve(path), 'utf8'))
const writeJson = async (name: string, data: unknown) => {
  await mkdir(OUT, { recursive: true })
  await writeFile(join(OUT, name), JSON.stringify(data, null, 2))
  console.log(`[repocast] wrote out/${name}`)
}

async function runLayout(mapPath: string) {
  const map = SystemMap.parse(await readJson(mapPath))
  const layout = await computeLayout(map)
  await writeJson('layout.json', layout)
  return layout
}

async function runVoice(scriptPath: string, opts: { silent: boolean; reuse: boolean }) {
  const script = Script.parse(await readJson(scriptPath))

  if (opts.reuse) {
    const existing = Timing.parse(await readJson(join(OUT, 'timing.json')))
    const timing = retime(script, existing)
    await writeJson('timing.json', timing)
    return timing
  }

  /* Audio has to land in public/ — Remotion's staticFile() resolves there. */
  const timing = opts.silent ? estimateTiming(script) : await synthesize(script, join(ROOT, 'public'), FPS)
  await writeJson('timing.json', timing)
  return timing
}

/**
 * No-key preview mode. Reads at ~2.8 words/second so scene lengths and beat
 * placement are roughly right; never ship a video rendered from this.
 */
function estimateTiming(script: Script): Timing {
  const WPS = 2.8
  return {
    version: 1,
    fps: FPS,
    scenes: script.scenes.map((scene) => {
      const tokens = scene.narration.split(/\s+/).filter(Boolean)
      const words = tokens.map((word, index) => ({
        word,
        start: index / WPS,
        end: (index + 1) / WPS
      }))
      return {
        id: scene.id,
        audio: '',
        durationSec: tokens.length / WPS + scene.holdSec,
        words,
        /* Resolve cues exactly as the real path does. A looser match here would
           make --silent pass on a cue that later fails against real alignment,
           which defeats the point of a dry run that costs nothing. */
        beats: scene.beats.map((beat) => ({
          at: resolveCue(words, beat.cue, beat.nth, scene.id),
          action: beat.action,
          target: beat.target,
          text: beat.text
        }))
      }
    })
  }
}

/**
 * Pre-flight. Everything worth knowing before the paid stage runs: whether the
 * diagram will fit a 16:9 frame, whether any node landed on top of another,
 * whether every cue actually appears in its narration, and what the voice will
 * cost. ElevenLabs bills one credit per character, so the character count *is*
 * the bill.
 */
async function runCheck(mapPath: string, scriptPath: string) {
  const map = SystemMap.parse(await readJson(mapPath))
  const script = Script.parse(await readJson(scriptPath))
  const layout = await computeLayout(map)

  /* The composition is 1920x1080 (remotion/Root.tsx). What actually decides
     readability is how far the wide shot has to scale down to fit the diagram
     in — aspect ratio alone says nothing, since a wide-but-narrow diagram can
     still fit at 1:1. Below ~0.6 the node subtitles go soft. */
  const FRAME = { width: 1920, height: 1080 }
  const wideScale = Math.min(FRAME.width / layout.bounds.width, FRAME.height / layout.bounds.height)
  const aspect = layout.bounds.width / layout.bounds.height
  const overlaps = layout.nodes.flatMap((a, index) =>
    layout.nodes.slice(index + 1).filter(
      (b) =>
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    ).map((b) => `${a.id} / ${b.id}`)
  )

  const problems: string[] = []
  console.log(`nodes      ${map.nodes.length}   edges ${map.edges.length}   flows ${map.flows.length}`)
  console.log(`diagram    ${Math.round(layout.bounds.width)}x${Math.round(layout.bounds.height)}  aspect ${aspect.toFixed(2)}  wide shot at ${wideScale.toFixed(2)}x`)

  if (map.nodes.length > 18) problems.push(`${map.nodes.length} nodes — over 18 no camera move can keep it readable; collapse a cluster`)
  if (wideScale < 0.6) problems.push(`the wide shot scales to ${wideScale.toFixed(2)}x, which leaves node subtitles unreadable; collapse nodes or drop a branch`)
  for (const pair of overlaps) problems.push(`nodes overlap: ${pair}`)

  const unlabelled = layout.edges.filter((edge) => !edge.labelAt && map.edges.find((e) => e.id === edge.id)?.label)
  if (unlabelled.length > 0) {
    console.log(`labels     ${unlabelled.length} edge label(s) dropped as unplaceable: ${unlabelled.map((e) => e.id).join(', ')}`)
  }

  /* Cues are checked against evenly-spaced words, which is enough to tell
     whether the phrase is present — the real timing comes from alignment. */
  let characters = 0
  for (const scene of script.scenes) {
    const tokens = scene.narration.split(/\s+/).filter(Boolean)
    const words = tokens.map((word, index) => ({ word, start: index, end: index + 1 }))
    characters += scene.narration.length
    for (const beat of scene.beats) {
      if (locateCue(words, beat.cue, beat.nth) === undefined) {
        problems.push(`scene ${scene.id}: cue "${beat.cue}"${beat.nth > 1 ? ` (nth ${beat.nth})` : ''} is not in the narration`)
      }
    }
    if (scene.beats.length > 4) problems.push(`scene ${scene.id} has ${scene.beats.length} beats; over four reads as noise`)
  }

  console.log(`scenes     ${script.scenes.length}   narration ${characters} characters = ${characters} voice credits`)

  if (problems.length === 0) {
    console.log('\nno problems found — safe to spend credits')
    return
  }
  console.log('')
  for (const problem of problems) console.error(`✗ ${problem}`)
  console.error(`\n${problems.length} problem(s). Fix these before running the voice stage.`)
  process.exitCode = 1
}

async function runRender(mapPath: string, scriptPath: string) {
  const { bundle } = await import('@remotion/bundler')
  const { renderMedia, selectComposition } = await import('@remotion/renderer')

  const inputProps = {
    map: SystemMap.parse(await readJson(mapPath)),
    layout: Layout.parse(await readJson(join(OUT, 'layout.json'))),
    script: Script.parse(await readJson(scriptPath)),
    timing: Timing.parse(await readJson(join(OUT, 'timing.json')))
  }

  const serveUrl = await bundle({ entryPoint: join(ROOT, 'remotion/index.ts') })
  const composition = await selectComposition({ serveUrl, id: 'Architecture', inputProps })

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: join(OUT, 'video.mp4'),
    inputProps,
    onProgress: ({ progress }) => process.stdout.write(`\r[repocast] rendering ${Math.round(progress * 100)}%`)
  })
  console.log(`\n[repocast] wrote out/video.mp4`)
}

const [command, ...args] = process.argv.slice(2)
const silent = args.includes('--silent')
const reuse = args.includes('--reuse')
const positional = args.filter((a) => !a.startsWith('--'))

switch (command) {
  case 'check':
    await runCheck(positional[0], positional[1])
    break
  case 'layout':
    await runLayout(positional[0])
    break
  case 'voice':
    await runVoice(positional[0], { silent, reuse })
    break
  case 'render':
    await runRender(positional[0], positional[1])
    break
  case 'build':
    await runLayout(positional[0])
    await runVoice(positional[1], { silent, reuse })
    await runRender(positional[0], positional[1])
    break
  default:
    console.log('usage: repocast <check|layout|voice|render|build> <map.json> [script.json] [--silent|--reuse]')
    process.exit(1)
}
