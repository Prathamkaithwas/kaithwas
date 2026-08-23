import { useRef } from 'react'
import { hapticLight } from '../lib/haptics'

/**
 * The letter a name files under. Anything that does not start with A–Z — a
 * digit, a symbol, a Devanagari name — lands under '#', which sorts first.
 */
export function indexLetter(name: string): string {
  const c = (name.trim()[0] ?? '').toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}

/** How far either side of the finger a letter still grows, in pixels. */
const RANGE = 70
/** Extra scale at the very centre. 1 + this = the biggest a letter gets. */
const LIFT = 1.2
/** How far the centre letter is pulled left, out from under the thumb. */
const SLIDE = 22

/**
 * A–Z scrubber down the right edge of a long list.
 *
 * The magnification is a *continuous* falloff on the distance in pixels from
 * the finger, smoothstepped so it eases in and out at both ends instead of
 * cornering. The first version scaled by whole letters away — 2x, 1.5x, 1.2x,
 * 1x — and that is what made it feel hard: nothing moved at all, then a letter
 * snapped a whole size. Now every letter within 70px is at its own size and
 * they all slide together as the thumb travels.
 *
 * Nothing here goes through React while a finger is down. The letters, the
 * bubble and its position are written straight onto the nodes inside one
 * requestAnimationFrame, so a scrub costs one style pass per frame rather than
 * a re-render of the whole strip — the same lesson the calculator's running
 * total taught, where animating something being touched ate the input.
 *
 * Pointer notes, the same trap as `useSwipe`: Android fires `pointercancel`
 * the moment it decides a drag belongs to a scroller, so the end of a scrub is
 * handled on cancel as well as on up. `setPointerCapture` keeps events coming
 * after the finger slides off the 28px rail, and `touch-action: none` stops
 * the sheet underneath scrolling at the same time.
 */
export function AlphaIndex({
  letters,
  onPick,
}: {
  letters: string[]
  /** fired once per letter crossed, never repeatedly for the same one */
  onPick: (letter: string) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const spans = useRef<(HTMLSpanElement | null)[]>([])
  /** the letter column's box, measured once per gesture */
  const box = useRef<DOMRect | null>(null)
  /** the rail's box, which the bubble is positioned against */
  const rail = useRef<DOMRect | null>(null)
  const pointerY = useRef(0)
  const frame = useRef(0)
  const last = useRef(-1)

  const paint = () => {
    frame.current = 0
    const r = box.current
    const rr = rail.current
    if (!r || !rr || r.height === 0) return

    const y = pointerY.current
    const n = letters.length
    const step = r.height / n

    for (let i = 0; i < n; i++) {
      const el = spans.current[i]
      if (!el) continue
      const d = Math.abs(r.top + (i + 0.5) * step - y)
      const t = d >= RANGE ? 0 : 1 - d / RANGE
      // smoothstep: flat where it meets 0 and 1, so a letter eases into size
      // rather than starting and stopping abruptly
      const e = t * t * (3 - 2 * t)
      el.style.transform = `translateX(${-SLIDE * e}px) scale(${1 + LIFT * e})`
      el.style.color = e > 0.45 ? 'var(--accent)' : e > 0.08 ? 'var(--text)' : ''
      el.style.fontWeight = e > 0.45 ? '700' : ''
    }

    const i = Math.max(0, Math.min(n - 1, Math.floor(((y - r.top) / r.height) * n)))
    if (i !== last.current) {
      last.current = i
      hapticLight()
      onPick(letters[i])
      if (bubble.current) bubble.current.textContent = letters[i]
    }
    if (bubble.current) {
      // follows the finger itself, not the letter's slot, so it never steps
      bubble.current.style.transform = `translateY(${y - rr.top}px) translateY(-50%) scale(1)`
    }
  }

  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(paint)
  }

  const down = (e: React.PointerEvent) => {
    if (!list.current) return
    box.current = list.current.getBoundingClientRect()
    rail.current = e.currentTarget.getBoundingClientRect()
    e.currentTarget.setPointerCapture(e.pointerId)
    last.current = -1
    pointerY.current = e.clientY
    // 1:1 with the finger while it is down; the ease-back is added on release
    for (const el of spans.current) if (el) el.style.transition = 'none'
    if (bubble.current) {
      bubble.current.style.transition = 'opacity 120ms linear'
      bubble.current.style.opacity = '1'
    }
    schedule()
  }

  const move = (e: React.PointerEvent) => {
    if (!box.current) return
    pointerY.current = e.clientY
    schedule()
  }

  const end = () => {
    if (!box.current) return
    box.current = null
    last.current = -1
    if (frame.current) {
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
    for (const el of spans.current) {
      if (!el) continue
      el.style.transition = 'transform 220ms var(--ease-out), color 180ms linear'
      el.style.transform = ''
      el.style.color = ''
      el.style.fontWeight = ''
    }
    if (bubble.current) {
      bubble.current.style.transition = 'opacity 160ms linear, transform 160ms var(--ease-out)'
      bubble.current.style.opacity = '0'
    }
  }

  if (letters.length < 2) return null

  return (
    <div
      className="alpha-strip"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div ref={list} className="alpha-list">
        {letters.map((l, i) => (
          <span
            key={l}
            ref={(n) => {
              spans.current[i] = n
            }}
          >
            {l}
          </span>
        ))}
      </div>

      {/* Always mounted and simply faded — mounting it on touch would cost a
          React render at the exact moment the finger starts moving. */}
      <div ref={bubble} className="alpha-bubble" aria-hidden="true" />
    </div>
  )
}
