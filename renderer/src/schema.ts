/**
 * The data contracts every repocast stage reads and writes.
 *
 * The pipeline is four stages joined by JSON files on disk, so any stage can be
 * inspected, hand-edited and re-run without redoing the ones before it:
 *
 *   extract -> system-map.json   (agent writes this; the only judgement-heavy step)
 *   layout  -> layout.json       (elkjs, deterministic)
 *   voice   -> timing.json + mp3 (ElevenLabs, word-level alignment)
 *   render  -> video.mp4         (Remotion)
 */
import { z } from 'zod'

/* ------------------------------------------------------------------ *
 * Stage 1 — system map
 * ------------------------------------------------------------------ */

/**
 * What a box on the diagram *is*. Kind drives its shape and colour, so keep the
 * vocabulary small — a diagram with twelve shapes reads worse than one with six.
 */
export const NodeKind = z.enum([
  'client', // browser, wallet, mobile app
  'edge', // CDN / worker / gateway sitting in front of a service
  'service', // long-running or on-demand compute that answers requests
  'job', // scheduled or triggered compute nobody calls directly
  'queue', // buffer between producers and consumers
  'datastore', // database, cache, bucket
  'external' // third party we do not run
])

/** What a line on the diagram *means*. Drives the edge's stroke and motion. */
export const EdgeKind = z.enum([
  'http', // synchronous request/response
  'rpc', // synchronous, non-HTTP (SigV4, gRPC, chain RPC)
  'event', // fire-and-forget publish
  'queue', // durable hand-off through a queue
  'cron', // time-triggered invocation
  'db' // reads/writes persistent state
])

/** A visual boundary — a cloud account, a region, a VPC, an edge network. */
export const Group = z.object({
  id: z.string(),
  label: z.string(),
  /** Optional parent group id, for a region inside an account. */
  parent: z.string().optional()
})

export const Node = z.object({
  id: z.string(),
  label: z.string(),
  kind: NodeKind,
  /** Concrete technology, shown as the node's subtitle. e.g. "AWS Lambda". */
  tech: z.string().optional(),
  group: z.string().optional(),
  /** One sentence. This is what the narration is written from. */
  summary: z.string(),
  /** Repo paths that prove this node exists. Keeps the map auditable. */
  source: z.array(z.string()).default([])
})

export const Edge = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: EdgeKind,
  /** Short label drawn on the line. e.g. "POST /rewards". */
  label: z.string().optional(),
  /** What causes this to happen. Feeds the narration, never drawn. */
  trigger: z.string().optional(),
  source: z.array(z.string()).default([])
})

/**
 * A named path through the graph — "reward accrual", "checkout". Flows are what
 * the video actually walks through; without them a diagram is just a picture.
 */
export const Flow = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string(),
  /** Edge ids, in the order they fire. */
  path: z.array(z.string())
})

/** Present only in PR mode: what this diff touched. */
export const Change = z.object({
  nodes: z.array(z.string()).default([]),
  edges: z.array(z.string()).default([]),
  /** Nodes/edges this PR introduced, drawn with an "added" treatment. */
  added: z.array(z.string()).default([]),
  removed: z.array(z.string()).default([]),
  summary: z.string()
})

export const SystemMap = z.object({
  version: z.literal(1),
  project: z.object({
    name: z.string(),
    tagline: z.string(),
    repo: z.string().optional(),
    /** PR number/title when the map was built from a diff. */
    pr: z.object({ number: z.number(), title: z.string(), url: z.string() }).optional()
  }),
  groups: z.array(Group).default([]),
  nodes: z.array(Node),
  edges: z.array(Edge),
  flows: z.array(Flow).default([]),
  change: Change.optional()
})

/* ------------------------------------------------------------------ *
 * Stage 2 — layout (produced by src/layout.ts, never hand-written)
 * ------------------------------------------------------------------ */

export const Point = z.object({ x: z.number(), y: z.number() })

export const LayoutBox = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})

export const LayoutEdge = z.object({
  id: z.string(),
  /** Polyline from source to target, already routed around boxes. */
  points: z.array(Point),
  /** Where to place the edge label, if it has one. */
  labelAt: Point.optional()
})

export const Layout = z.object({
  version: z.literal(1),
  /** Full diagram extent, used as the camera's "wide shot". */
  bounds: z.object({ width: z.number(), height: z.number() }),
  nodes: z.array(LayoutBox),
  groups: z.array(LayoutBox),
  edges: z.array(LayoutEdge)
})

/* ------------------------------------------------------------------ *
 * Stage 3 — script + voice
 * ------------------------------------------------------------------ */

/**
 * A beat is an on-screen action pinned to a *word* in the narration, not to a
 * timestamp. The voice stage resolves the word to a frame from ElevenLabs'
 * alignment data, so motion lands on the syllable however fast the voice reads.
 */
export const Beat = z.object({
  /**
   * Word or short phrase from this scene's narration. Matched case-insensitively
   * against the aligned transcript; first occurrence wins unless `nth` is set.
   */
  cue: z.string(),
  nth: z.number().int().min(1).default(1),
  action: z.enum([
    'highlight', // pulse a node and dim everything else
    'flow', // animate a packet travelling along an edge
    'reveal', // fade a node/edge in for the first time
    'badge', // pop a short label above a node
    'dim' // push a node back
  ]),
  /** Node or edge id. */
  target: z.string(),
  /** Text for `badge`. */
  text: z.string().optional()
})

export const Scene = z.object({
  id: z.string(),
  /** Spoken text. Write it as speech, not as documentation. */
  narration: z.string(),
  /** Camera target: the union bbox of these ids, plus padding. */
  focus: z.object({
    nodes: z.array(z.string()).default([]),
    edges: z.array(z.string()).default([]),
    /** Empty focus = wide shot of the whole diagram. */
    padding: z.number().default(140)
  }),
  beats: z.array(Beat).default([]),
  /** Extra silence held after the voice line, in seconds. Lets a motion finish. */
  holdSec: z.number().default(0.6)
})

export const Script = z.object({
  version: z.literal(1),
  voice: z.object({
    provider: z.literal('elevenlabs'),
    voiceId: z.string(),
    modelId: z.string().default('eleven_multilingual_v2'),
    stability: z.number().default(0.4),
    similarityBoost: z.number().default(0.75),
    speed: z.number().default(1)
  }),
  scenes: z.array(Scene)
})

/** Written by the voice stage; read by Remotion to place every beat. */
export const Timing = z.object({
  version: z.literal(1),
  fps: z.number(),
  scenes: z.array(
    z.object({
      id: z.string(),
      audio: z.string(),
      durationSec: z.number(),
      words: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })),
      /** Beats resolved to seconds relative to the scene start. */
      beats: z.array(z.object({ at: z.number(), action: z.string(), target: z.string(), text: z.string().optional() }))
    })
  )
})

export type SystemMap = z.infer<typeof SystemMap>
export type Node = z.infer<typeof Node>
export type Edge = z.infer<typeof Edge>
export type Layout = z.infer<typeof Layout>
export type LayoutBox = z.infer<typeof LayoutBox>
export type LayoutEdge = z.infer<typeof LayoutEdge>
export type Script = z.infer<typeof Script>
export type Scene = z.infer<typeof Scene>
export type Timing = z.infer<typeof Timing>
export type NodeKind = z.infer<typeof NodeKind>
export type EdgeKind = z.infer<typeof EdgeKind>
