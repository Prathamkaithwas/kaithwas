import { useRef, useState } from 'react'
import { hapticHeavy, hapticLight } from '../lib/haptics'

const R = 14
const C = 2 * Math.PI * R

/**
 * Hold to confirm, with the wait drawn as a ring closing around the icon.
 *
 * For destructive actions where a yes/no dialog is the wrong shape: a dialog
 * asks you to read something and then tap again, which after the tenth time
 * is just two taps. Holding is one gesture that cannot happen by accident,
 * and the ring says exactly how much longer — an 800ms hold with no feedback
 * would only feel broken.
 *
 * Early release snaps the ring back and nothing happens. `pointercancel` is
 * treated as a release, because Android fires it the moment it decides your
 * press was the start of a scroll.
 */
export function HoldConfirm({
  label,
  onConfirm,
  color = 'var(--expense)',
}: {
  label: string
  onConfirm: () => void
  color?: string
}) {
  const [holding, setHolding] = useState(false)
  const [done, setDone] = useState(false)
  const fired = useRef(false)

  const start = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    fired.current = false
    setHolding(true)
    // Only acknowledges that the hold has begun — nothing has been deleted
    // yet, and this fires on every stray press that gets released early, so
    // it stays as light as any other touch. The escalation to heavy happens
    // when the ring actually closes.
    hapticLight()
  }

  const stop = () => {
    // Once it has fired, letting go must not undo the success state.
    if (fired.current) return
    setHolding(false)
  }

  return (
    <button
      className="hold-confirm"
      style={{ '--hold': color } as React.CSSProperties}
      data-holding={holding || undefined}
      data-done={done || undefined}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      // A plain click must do nothing at all — the whole point is that a
      // stray tap cannot delete anything.
      onClick={(e) => e.stopPropagation()}
      aria-label={`${label} — press and hold`}
    >
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
        <circle className="hold-track" cx="17" cy="17" r={R} />
        <circle
          className="hold-ring"
          cx="17"
          cy="17"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C}
          onAnimationEnd={() => {
            fired.current = true
            setDone(true)
            // The delete is now committed — the heaviest thing the app does.
            hapticHeavy()
            // let the success flash be seen before the row disappears
            setTimeout(onConfirm, 220)
          }}
        />
      </svg>
      <span className="hold-glyph">{done ? '✓' : '✕'}</span>
    </button>
  )
}
