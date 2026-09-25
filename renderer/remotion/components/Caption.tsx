import React from 'react'
import { AbsoluteFill } from 'remotion'
import type { Timing } from '../../src/schema.ts'
import { theme } from '../theme.ts'

type Word = Timing['scenes'][number]['words'][number]

/** How long a word takes to resolve from blurred to sharp, in seconds. */
const FOCUS_SEC = 0.22

/**
 * Lower third. Words arrive out of focus and sharpen as they are spoken, so the
 * caption tracks the voice without a hard highlight colour doing the work. There
 * is no box — a masked blur scrim separates the text from the diagram and fades
 * out before it reaches anything the viewer is meant to be looking at.
 */
export const Caption: React.FC<{ words: Word[]; elapsed: number }> = ({ words, elapsed }) => {
  if (words.length === 0) return null

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          inset: 'auto 0 0 0',
          height: 300,
          backdropFilter: 'blur(18px)',
          /* A flat fill, faded by the mask rather than by a gradient: this
             Chrome build paints background-color but silently drops
             background-image gradients. The mask fades the blur too, so the
             scrim never ends on a visible seam across the diagram. */
          backgroundColor: theme.scrim(0.94),
          maskImage: 'linear-gradient(to top, black 62%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top, black 62%, transparent 100%)'
        }}
      />

      <div
        style={{
          position: 'absolute',
          bottom: 74,
          maxWidth: 980,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '2px 8px'
        }}
      >
        {words.map((word, index) => {
          const progress = clamp((elapsed - word.start) / FOCUS_SEC)
          return (
            <span
              key={`${word.word}-${index}`}
              style={{
                fontSize: 23,
                lineHeight: 1.55,
                letterSpacing: 0.1,
                color: theme.text,
                opacity: 0.3 + progress * 0.7,
                filter: progress < 1 ? `blur(${(1 - progress) * 3}px)` : undefined,
                transform: `translateY(${(1 - progress) * 2}px)`
              }}
            >
              {word.word}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))
