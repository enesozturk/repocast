/**
 * Graph -> geometry. elkjs gives us layered placement and orthogonal edge
 * routing; everything about how it *looks* stays in the Remotion components.
 */
import ELK from 'elkjs/lib/elk.bundled.js'
import type { Layout, SystemMap } from './schema.ts'

const NODE_WIDTH = 260
const NODE_HEIGHT = 96

/** Nodes with a longer label need room, or the subtitle wraps into the border. */
function nodeSize(label: string, tech?: string) {
  const longest = Math.max(label.length, (tech ?? '').length)
  return { width: Math.max(NODE_WIDTH, longest * 11 + 64), height: NODE_HEIGHT }
}

export async function computeLayout(map: SystemMap): Promise<Layout> {
  const elk = new ELK()

  const byGroup = new Map<string, string[]>()
  for (const node of map.nodes) {
    const key = node.group ?? '__root__'
    byGroup.set(key, [...(byGroup.get(key) ?? []), node.id])
  }

  const sizes = new Map(map.nodes.map((n) => [n.id, nodeSize(n.label, n.tech)]))
  const elkNode = (id: string) => ({ id, ...sizes.get(id)! })

  const children = [
    ...map.groups.map((group) => ({
      id: group.id,
      layoutOptions: { 'elk.padding': '[top=64,left=32,bottom=32,right=32]' },
      children: (byGroup.get(group.id) ?? []).map(elkNode)
    })),
    ...(byGroup.get('__root__') ?? []).map(elkNode)
  ]

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '140',
      'elk.spacing.nodeNode': '72',
      'elk.spacing.edgeNode': '40',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      /* A mostly-linear system lays out as one long thin chain, which no camera
         move can make readable inside a 16:9 frame. Wrapping folds it into rows
         at roughly the frame's aspect ratio instead. */
      'elk.aspectRatio': '1.78',
      'elk.layered.wrapping.strategy': 'MULTI_EDGE'
    },
    children,
    edges: map.edges.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] }))
  }

  const laid = (await elk.layout(graph as never)) as unknown as ElkResult

  /* elk reports child coordinates relative to their parent group, but the
     camera and the renderer only ever work in one absolute space. */
  const nodes: Layout['nodes'] = []
  const groups: Layout['groups'] = []

  for (const child of laid.children ?? []) {
    const isGroup = Boolean(child.children?.length)
    const box = { id: child.id, x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 }
    if (!isGroup) {
      nodes.push(box)
      continue
    }
    groups.push(box)
    for (const grandchild of child.children ?? []) {
      nodes.push({
        id: grandchild.id,
        x: (grandchild.x ?? 0) + box.x,
        y: (grandchild.y ?? 0) + box.y,
        width: grandchild.width ?? 0,
        height: grandchild.height ?? 0
      })
    }
  }

  const edges: Layout['edges'] = collectEdges(laid).map((edge) => {
    const section = edge.sections?.[0]
    const points = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      : []
    const at = midpoint(points)
    return { id: edge.id, points, labelAt: at && labelIsPlaceable(at, edge.id, map, nodes) ? at : undefined }
  })

  return {
    version: 1,
    bounds: { width: laid.width ?? 0, height: laid.height ?? 0 },
    nodes,
    groups,
    edges
  }
}

/**
 * Two ways a label makes the diagram worse than no label at all: sitting on top
 * of a node, and sitting on the far outside leg of an edge that elk routed
 * around the whole diagram — where it reads as text floating in space,
 * belonging to nothing. Only label an anchor that lands in the neighbourhood of
 * the two nodes it actually connects.
 */
function labelIsPlaceable(at: { x: number; y: number }, edgeId: string, map: SystemMap, nodes: Layout['nodes']) {
  const covered = nodes.some(
    (node) => at.x > node.x && at.x < node.x + node.width && at.y > node.y && at.y < node.y + node.height
  )
  if (covered) return false

  const meta = map.edges.find((edge) => edge.id === edgeId)
  const from = nodes.find((node) => node.id === meta?.from)
  const to = nodes.find((node) => node.id === meta?.to)
  if (!from || !to) return false

  const SLACK = 140
  const left = Math.min(from.x, to.x) - SLACK
  const right = Math.max(from.x + from.width, to.x + to.width) + SLACK
  const top = Math.min(from.y, to.y) - SLACK
  const bottom = Math.max(from.y + from.height, to.y + to.height) + SLACK

  return at.x > left && at.x < right && at.y > top && at.y < bottom
}

/** Edges between two groups' children are reported on the common ancestor. */
function collectEdges(node: ElkResult): ElkEdge[] {
  return [...(node.edges ?? []), ...(node.children ?? []).flatMap(collectEdges)]
}

/**
 * Anchor a label to the centre of the edge's longest straight run, not to the
 * midpoint of the whole polyline. On an edge that wraps around the diagram the
 * geometric midpoint lands nowhere near a visible line, which reads as a label
 * floating in empty space.
 */
function midpoint(points: { x: number; y: number }[]) {
  if (points.length < 2) return undefined

  let best = { length: -1, at: points[0] }
  for (let i = 0; i < points.length - 1; i++) {
    const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
    if (length > best.length) {
      best = { length, at: { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 } }
    }
  }

  /* A run too short to sit a word on is better left unlabelled. */
  return best.length < 60 ? undefined : best.at
}

type ElkEdge = {
  id: string
  sections?: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: { x: number; y: number }[] }[]
}

type ElkResult = {
  width?: number
  height?: number
  x?: number
  y?: number
  id: string
  children?: ElkResult[]
  edges?: ElkEdge[]
}
