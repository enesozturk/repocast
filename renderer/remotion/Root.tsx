import React from 'react'
import { Composition } from 'remotion'
import { ArchitectureVideo, type VideoProps } from './Video.tsx'
import example from '../examples/example.system-map.json'
import exampleScript from '../examples/example.script.json'

const FPS = 30

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Architecture"
    component={ArchitectureVideo}
    fps={FPS}
    width={1920}
    height={1080}
    /* Real values arrive as inputProps from the CLI; these keep Studio usable. */
    defaultProps={{ map: example, script: exampleScript, layout: emptyLayout, timing: emptyTiming } as unknown as VideoProps}
    durationInFrames={FPS * 10}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(
        FPS,
        Math.round(props.timing.scenes.reduce((total, scene) => total + scene.durationSec, 0) * FPS)
      )
    })}
  />
)

const emptyLayout = { version: 1, bounds: { width: 1920, height: 1080 }, nodes: [], groups: [], edges: [] }
const emptyTiming = { version: 1, fps: FPS, scenes: [] }
