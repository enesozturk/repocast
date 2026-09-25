import React, { useMemo } from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Layout, Script, SystemMap, Timing } from '../src/schema.ts'
import { Caption } from './components/Caption.tsx'
import { Diagram, type Emphasis } from './components/Diagram.tsx'
import { theme } from './theme.ts'

export type VideoProps = {
  map: SystemMap
  layout: Layout
  script: Script
  timing: Timing
}

/** How long the camera takes to settle on a new scene, in frames. */
const CAMERA_FRAMES = 26
/** How long a packet takes to cross an edge, in seconds. */
const FLOW_SEC = 1.1
/**
 * Zoom ceiling. Without it a two-node scene fills the frame and the neighbours
 * get cropped mid-word, which reads as broken rather than focused. Capping the
 * scale keeps the surrounding system visible as context.
 */
const MAX_SCALE = 1.35

export const ArchitectureVideo: React.FC<VideoProps> = ({ map, layout, script, timing }) => {
  const frame = useCurrentFrame()
  const { fps, width, height, durationInFrames } = useVideoConfig()

  const scenes = useMemo(() => buildTimeline(script, timing, fps, layout), [script, timing, fps, layout])
  const index = Math.max(0, scenes.findLastIndex((scene) => frame >= scene.from))
  const scene = scenes[index]
  const previous = scenes[index - 1] ?? scene
  const elapsed = (frame - scene.from) / fps

  /* Interpolating the target rectangle (not the final scale) keeps the move
     linear on screen; interpolating scale directly makes long zooms lurch. */
  const t = interpolate(frame - scene.from, [0, CAMERA_FRAMES], [0, 1], {
    extrapolateRight: 'clamp',
    easing: (value) => value * value * (3 - 2 * value)
  })
  const view = {
    x: lerp(previous.view.x, scene.view.x, t),
    y: lerp(previous.view.y, scene.view.y, t),
    width: lerp(previous.view.width, scene.view.width, t),
    height: lerp(previous.view.height, scene.view.height, t)
  }
  /* Fit against the height left above the caption, not the full frame; a tall
     diagram otherwise fits the frame and disappears behind the caption band. */
  const scale = Math.min(width / view.width, (height * 0.72) / view.height, MAX_SCALE)

  const emphasis: Emphasis = {
    focused: scene.focused,
    pulses: new Map(),
    flows: new Map(),
    badges: new Map()
  }
  for (const beat of scene.beats) {
    const age = elapsed - beat.at
    if (age < 0) continue
    if (beat.action === 'highlight' || beat.action === 'reveal') emphasis.pulses.set(beat.target, age)
    if (beat.action === 'flow') emphasis.flows.set(beat.target, Math.min(age / FLOW_SEC, 1))
    if (beat.action === 'badge' && beat.text) emphasis.badges.set(beat.target, { text: beat.text, age })
  }

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: theme.font.family }}>
      <AbsoluteFill
        style={{
          /* Centred slightly high: the caption owns the bottom fifth of the
             frame, so a true centre would park content underneath it. */
          transform: `translate(${width / 2}px, ${height * 0.44}px) scale(${scale}) translate(${-(view.x + view.width / 2)}px, ${-(view.y + view.height / 2)}px)`,
          transformOrigin: '0 0'
        }}
      >
        <Diagram map={map} layout={layout} emphasis={emphasis} />
      </AbsoluteFill>

      <Header map={map} />
      <Caption words={scene.words} elapsed={elapsed} />

      {/* Every scene's audio is mounted, each inside its own Sequence. An
          unwrapped <Audio> is treated as starting at frame 0 of the composition,
          so a later scene would seek past the end of its own file and play
          silence — only the first line would ever be heard. */}
      {scenes.map((item, itemIndex) =>
        item.audio ? (
          <Sequence key={item.audio} from={item.from} durationInFrames={durationOf(scenes, itemIndex, durationInFrames)}>
            <Audio src={staticFile(item.audio)} />
          </Sequence>
        ) : null
      )}
    </AbsoluteFill>
  )
}

const Header: React.FC<{ map: SystemMap }> = ({ map }) => (
  <AbsoluteFill style={{ pointerEvents: 'none' }}>
    {/* The camera moves under the title; without a scrim the two collide. */}
    <div
      style={{
        position: 'absolute',
        inset: '0 0 auto 0',
        height: 220,
        background: `linear-gradient(to bottom, ${theme.bg} 45%, transparent)`
      }}
    />
    <div style={{ position: 'absolute', top: 56, left: 56, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: theme.text, fontSize: 30, letterSpacing: -0.4 }}>{map.project.name}</span>
      <span style={{ color: theme.textSecondary, fontSize: 20 }}>
        {map.project.pr ? `#${map.project.pr.number} · ${map.project.pr.title}` : map.project.tagline}
      </span>
    </div>
  </AbsoluteFill>
)

type TimelineScene = {
  from: number
  focused: Set<string>
  beats: Timing['scenes'][number]['beats']
  words: Timing['scenes'][number]['words']
  audio: string
  view: { x: number; y: number; width: number; height: number }
}

function buildTimeline(script: Script, timing: Timing, fps: number, layout: Layout): TimelineScene[] {
  let cursor = 0
  return script.scenes.map((scene) => {
    const timed = timing.scenes.find((candidate) => candidate.id === scene.id)
    const from = cursor
    cursor += Math.round((timed?.durationSec ?? 4) * fps)

    const ids = [...scene.focus.nodes, ...scene.focus.edges]
    return {
      from,
      focused: new Set(ids),
      beats: timed?.beats ?? [],
      words: timed?.words ?? [],
      audio: timed?.audio ?? '',
      view: viewFor(layout, scene.focus.nodes, scene.focus.edges, scene.focus.padding)
    }
  })
}

/** Union bounding box of the focused ids, padded — or the whole diagram. */
function viewFor(layout: Layout, nodes: string[], edges: string[], padding: number) {
  const boxes = layout.nodes.filter((node) => nodes.includes(node.id))
  const points = layout.edges.filter((edge) => edges.includes(edge.id)).flatMap((edge) => edge.points)

  if (boxes.length === 0 && points.length === 0) {
    return { x: -80, y: -80, width: layout.bounds.width + 160, height: layout.bounds.height + 160 }
  }

  const xs = [...boxes.flatMap((b) => [b.x, b.x + b.width]), ...points.map((p) => p.x)]
  const ys = [...boxes.flatMap((b) => [b.y, b.y + b.height]), ...points.map((p) => p.y)]

  return {
    x: Math.min(...xs) - padding,
    y: Math.min(...ys) - padding,
    width: Math.max(...xs) - Math.min(...xs) + padding * 2,
    height: Math.max(...ys) - Math.min(...ys) + padding * 2
  }
}

const lerp = (from: number, to: number, t: number) => from + (to - from) * t

/** A scene runs until the next one starts, or until the composition ends. */
const durationOf = (scenes: TimelineScene[], index: number, total: number) =>
  Math.max(1, (scenes[index + 1]?.from ?? total) - scenes[index].from)
