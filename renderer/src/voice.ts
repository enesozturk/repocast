/**
 * Narration -> audio + word-level timing.
 *
 * We use ElevenLabs' `with-timestamps` endpoint rather than plain TTS because it
 * returns per-character start/end times. That is what lets a beat say "flash
 * Aurora when I say the word Aurora" instead of guessing a timestamp that breaks
 * the moment anyone edits a sentence.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Script, Timing } from './schema.ts'

const API = 'https://api.elevenlabs.io/v1/text-to-speech'

type Alignment = {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

export type Word = { word: string; start: number; end: number }

export async function synthesize(script: Script, outDir: string, fps: number): Promise<Timing> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set. Put it in .env at the project root.')

  const audioDir = join(outDir, 'audio')
  await mkdir(audioDir, { recursive: true })

  const scenes: Timing['scenes'] = []

  for (const scene of script.scenes) {
    const payload = await speak(scene.narration, script, apiKey, scene.id)
    const file = `audio/${scene.id}.mp3`
    await writeFile(join(outDir, file), Buffer.from(payload.audio_base64, 'base64'))

    const words = toWords(payload.alignment)
    const spoken = words.at(-1)?.end ?? 0

    scenes.push({
      id: scene.id,
      audio: file,
      durationSec: spoken + scene.holdSec,
      words,
      beats: scene.beats.map((beat) => ({
        at: resolveCue(words, beat.cue, beat.nth, scene.id),
        action: beat.action,
        target: beat.target,
        text: beat.text
      }))
    })
  }

  return { version: 1, fps, scenes }
}

/**
 * One scene's audio. Retried, because a whole build dying on a transient DNS
 * blip after paying for six other scenes is not an acceptable failure mode.
 * A 4xx is not retried — that is a bad voice id or a plan limit, and repeating
 * it just burns quota.
 */
async function speak(text: string, script: Script, apiKey: string, sceneId: string) {
  const ATTEMPTS = 3
  let last: unknown

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${API}/${script.voice.voiceId}/with-timestamps`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: script.voice.modelId,
          voice_settings: {
            stability: script.voice.stability,
            similarity_boost: script.voice.similarityBoost,
            speed: script.voice.speed
          }
        })
      })

      if (response.ok) return (await response.json()) as { audio_base64: string; alignment: Alignment }

      const body = await response.text()
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`ElevenLabs rejected scene ${sceneId}: ${response.status} ${body}`)
      }
      last = new Error(`ElevenLabs ${response.status} on scene ${sceneId}: ${body}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('ElevenLabs rejected')) throw error
      last = error
    }

    if (attempt < ATTEMPTS) {
      const waitMs = 1000 * 2 ** (attempt - 1)
      console.warn(`[repocast] scene ${sceneId}: attempt ${attempt} failed, retrying in ${waitMs}ms`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }

  throw last
}

/**
 * Re-resolve every beat against the words already in a timing file, without
 * calling the API. Editing a cue is the most common reason to re-run the voice
 * stage, and re-synthesising unchanged narration to fix a typo is pure waste.
 */
export function retime(script: Script, timing: Timing): Timing {
  return {
    ...timing,
    scenes: script.scenes.map((scene) => {
      const previous = timing.scenes.find((candidate) => candidate.id === scene.id)
      if (!previous) throw new Error(`No existing timing for scene ${scene.id}. Run the voice stage without --reuse.`)
      return {
        ...previous,
        durationSec: (previous.words.at(-1)?.end ?? 0) + scene.holdSec,
        beats: scene.beats.map((beat) => ({
          at: resolveCue(previous.words, beat.cue, beat.nth, scene.id),
          action: beat.action,
          target: beat.target,
          ...(beat.text === undefined ? {} : { text: beat.text })
        }))
      }
    })
  }
}

/** Character alignment is unusable as-is; collapse it into words. */
function toWords(alignment: Alignment): Word[] {
  const words: Word[] = []
  let current: Word | null = null

  alignment.characters.forEach((char, index) => {
    const start = alignment.character_start_times_seconds[index]
    const end = alignment.character_end_times_seconds[index]

    if (/\s/.test(char)) {
      if (current) words.push(current)
      current = null
      return
    }
    if (!current) current = { word: char, start, end }
    else current = { word: current.word + char, start: current.start, end }
  })

  if (current) words.push(current)
  return words
}

/**
 * When a cue phrase is spoken, or undefined if the narration never says it.
 * Separate from `resolveCue` so the pre-flight check can report a miss without
 * emitting a warning that looks like a render failure.
 */
export function locateCue(words: Word[], cue: string, nth: number): number | undefined {
  const needle = cue.toLowerCase().split(/\s+/).map(strip)
  const haystack = words.map((w) => strip(w.word.toLowerCase()))

  let seen = 0
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((part, j) => haystack[i + j] === part)) {
      seen++
      if (seen === nth) return words[i]!.start
    }
  }
  return undefined
}

/**
 * Find when a cue phrase is spoken. Falls back to the start of the scene with a
 * loud warning rather than throwing — one mistyped cue should not kill a render.
 */
export function resolveCue(words: Word[], cue: string, nth: number, sceneId: string): number {
  const at = locateCue(words, cue, nth)
  if (at !== undefined) return at

  console.warn(`[repocast] scene ${sceneId}: cue "${cue}" not found in narration — beat pinned to scene start`)
  return 0
}

const strip = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '')
