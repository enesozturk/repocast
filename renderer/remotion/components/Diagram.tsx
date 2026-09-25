import React from 'react'
import { interpolate, useCurrentFrame } from 'remotion'
import type { Layout, SystemMap } from '../../src/schema.ts'
import { edgeStyle, kindColor, theme } from '../theme.ts'

export type Emphasis = {
  /** Ids the current scene is about. Everything else recedes. */
  focused: Set<string>
  /** Id -> seconds since its highlight beat fired (negative = not yet). */
  pulses: Map<string, number>
  /** Edge id -> progress 0..1 of a packet travelling along it. */
  flows: Map<string, number>
  badges: Map<string, { text: string; age: number }>
}

const box = (layout: Layout, id: string) => layout.nodes.find((n) => n.id === id)

/**
 * In PR mode the diff has to be legible at a glance, before the narration gets
 * to it: green for what the PR introduced, amber for what it altered, and the
 * ordinary border for the context around it.
 */
function changeStroke(map: SystemMap, id: string) {
  if (!map.change) return undefined
  if (map.change.added.includes(id)) return theme.success
  if (map.change.nodes.includes(id) || map.change.edges.includes(id)) return theme.warning
  return undefined
}

export const Diagram: React.FC<{ map: SystemMap; layout: Layout; emphasis: Emphasis }> = ({ map, layout, emphasis }) => {
  const frame = useCurrentFrame()

  return (
    <svg width={layout.bounds.width} height={layout.bounds.height} style={{ overflow: 'visible' }}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.borderStrong} />
        </marker>
      </defs>

      {layout.groups.map((group) => {
        const meta = map.groups.find((g) => g.id === group.id)
        return (
          <g key={group.id} opacity={0.9}>
            <rect
              x={group.x}
              y={group.y}
              width={group.width}
              height={group.height}
              rx={theme.radius.group}
              fill={theme.surface}
              stroke={theme.border}
              strokeWidth={1.5}
            />
            <text x={group.x + 28} y={group.y + 40} fill={theme.textSecondary} fontSize={20} fontFamily={theme.font.family} letterSpacing={1.2}>
              {meta?.label.toUpperCase()}
            </text>
          </g>
        )
      })}

      {layout.edges.map((edge) => {
        const meta = map.edges.find((e) => e.id === edge.id)
        if (!meta || edge.points.length < 2) return null
        const style = edgeStyle[meta.kind] ?? edgeStyle.http
        const active = emphasis.focused.has(edge.id)
        const changed = changeStroke(map, edge.id)
        const d = toPath(edge.points)

        return (
          <g key={edge.id} opacity={dim(emphasis, edge.id)}>
            <path
              d={d}
              fill="none"
              stroke={active ? theme.accent : (changed ?? style.color)}
              strokeWidth={active || changed ? 3 : 2}
              strokeDasharray={style.dash}
              /* A slow crawl on dashed edges reads as "this is a live path"
                 without pulling attention from whatever the scene is about. */
              strokeDashoffset={style.dash ? -frame * 0.6 : undefined}
              markerEnd="url(#arrow)"
              strokeLinejoin="round"
            />
            {meta.label && edge.labelAt ? (
              <text
                x={edge.labelAt.x}
                y={edge.labelAt.y - 12}
                fill={active ? theme.text : theme.textSecondary}
                fontSize={17}
                fontFamily={theme.font.mono}
                textAnchor="middle"
              >
                {meta.label}
              </text>
            ) : null}
            <Packet edge={edge} progress={emphasis.flows.get(edge.id)} />
          </g>
        )
      })}

      {map.nodes.map((node) => {
        const geometry = box(layout, node.id)
        if (!geometry) return null
        const pulse = emphasis.pulses.get(node.id)
        const badge = emphasis.badges.get(node.id)
        const changed = changeStroke(map, node.id)

        return (
          <g key={node.id} opacity={dim(emphasis, node.id)}>
            {pulse !== undefined && pulse >= 0 ? (
              <rect
                x={geometry.x - 8}
                y={geometry.y - 8}
                width={geometry.width + 16}
                height={geometry.height + 16}
                rx={theme.radius.node + 8}
                fill="none"
                stroke={theme.accent}
                strokeWidth={2}
                opacity={interpolate(pulse, [0, 0.35, 1.4], [0, 0.9, 0], { extrapolateRight: 'clamp' })}
              />
            ) : null}

            <rect
              x={geometry.x}
              y={geometry.y}
              width={geometry.width}
              height={geometry.height}
              rx={theme.radius.node}
              fill={theme.surfaceRaised}
              stroke={changed ?? (emphasis.focused.has(node.id) ? theme.accent : theme.border)}
              strokeWidth={emphasis.focused.has(node.id) || changed ? 2 : 1.5}
            />
            <circle cx={geometry.x + 26} cy={geometry.y + geometry.height / 2} r={7} fill={kindColor[node.kind] ?? theme.accent} />
            <text x={geometry.x + 50} y={geometry.y + 40} fill={theme.text} fontSize={23} fontFamily={theme.font.family}>
              {node.label}
            </text>
            {node.tech ? (
              <text x={geometry.x + 50} y={geometry.y + 68} fill={theme.textSecondary} fontSize={17} fontFamily={theme.font.mono}>
                {node.tech}
              </text>
            ) : null}

            {badge ? (
              <g opacity={interpolate(badge.age, [0, 0.25, 2.5, 3], [0, 1, 1, 0], { extrapolateRight: 'clamp' })}>
                <rect
                  x={geometry.x + geometry.width - 40}
                  y={geometry.y - 34}
                  width={badge.text.length * 11 + 28}
                  height={34}
                  rx={theme.radius.pill}
                  fill={theme.accentSoft}
                  stroke={theme.accent}
                />
                <text x={geometry.x + geometry.width - 26} y={geometry.y - 11} fill={theme.accent} fontSize={17} fontFamily={theme.font.mono}>
                  {badge.text}
                </text>
              </g>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

/** A dot travelling the edge — the only thing that shows direction over time. */
const Packet: React.FC<{ edge: Layout['edges'][number]; progress?: number }> = ({ edge, progress }) => {
  if (progress === undefined || progress <= 0 || progress >= 1) return null
  const { x, y } = pointAt(edge.points, progress)
  return (
    <g>
      <circle cx={x} cy={y} r={16} fill={theme.accentGlow} />
      <circle cx={x} cy={y} r={6} fill={theme.accent} />
    </g>
  )
}

const dim = (emphasis: Emphasis, id: string) => (emphasis.focused.size === 0 || emphasis.focused.has(id) ? 1 : 0.28)

const toPath = (points: { x: number; y: number }[]) =>
  points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

/** Walk the polyline by arc length so the packet moves at a constant speed. */
function pointAt(points: { x: number; y: number }[], t: number) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let travelled = t * total

  for (let i = 0; i < lengths.length; i++) {
    if (travelled <= lengths[i]) {
      const ratio = lengths[i] === 0 ? 0 : travelled / lengths[i]
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
        y: points[i].y + (points[i + 1].y - points[i].y) * ratio
      }
    }
    travelled -= lengths[i]
  }
  return points.at(-1)!
}
