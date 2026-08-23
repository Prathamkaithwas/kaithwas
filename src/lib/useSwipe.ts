import { useRef, type CSSProperties } from 'react'

export interface SwipeHandlers {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
  /** Must be spread onto the same element — see the note on touch-action. */
  style: CSSProperties
}

/** Movement before we commit to calling the gesture horizontal or vertical. */
const SLOP = 10

/**
 * Horizontal swipe detection that survives Android.
 *
 * The obvious implementation — remember where pointerdown landed, compare at
 * pointerup — does not work in a WebView. As soon as Android decides a drag
 * belongs to a scroller it fires `pointercancel` and never delivers
 * `pointerup`, so the gesture silently never resolves. That is why swiping
 * between tabs did not work in the previous build.
 *
 * Three things fix it:
 *
 *  - `touch-action: pan-y` on the element. This tells the browser up front
 *    that vertical panning is its job and horizontal is ours, which stops it
 *    stealing the gesture in the first place. It is the single most important
 *    part, so the style ships with the handlers rather than being left for the
 *    caller to remember.
 *  - Locking the axis once the movement passes a slop threshold. After we
 *    have claimed a horizontal drag, later vertical wobble cannot cancel it,
 *    and a drag we judged vertical is abandoned immediately.
 *  - Resolving on `pointermove` the moment the threshold is crossed, and
 *    handling `pointercancel` as a plain reset. Nothing depends on
 *    `pointerup` arriving, because sometimes it does not.
 *
 * Capturing the pointer keeps the remaining events coming to this element
 * even if the finger wanders off it mid-swipe.
 */
export function useSwipe(
  onSwipeLeft: (() => void) | undefined,
  onSwipeRight: (() => void) | undefined,
  enabled = true,
  // Deliberately short. This is the gesture that replaces reaching for the
  // bottom bar, so it has to fire from a small thumb flick rather than a
  // deliberate drag across the screen.
  threshold = 40,
): SwipeHandlers {
  const state = useRef<{
    x: number
    y: number
    axis: 'undecided' | 'x' | 'y'
    fired: boolean
    id: number
  } | null>(null)

  const reset = (e: React.PointerEvent) => {
    const s = state.current
    state.current = null
    if (s && e.currentTarget.hasPointerCapture?.(s.id)) {
      e.currentTarget.releasePointerCapture(s.id)
    }
  }

  return {
    style: { touchAction: 'pan-y' },

    onPointerDown: (e) => {
      if (!enabled || !e.isPrimary) return
      state.current = {
        x: e.clientX,
        y: e.clientY,
        axis: 'undecided',
        fired: false,
        id: e.pointerId,
      }
    },

    onPointerMove: (e) => {
      const s = state.current
      if (!s || !enabled || s.fired) return

      const dx = e.clientX - s.x
      const dy = e.clientY - s.y

      if (s.axis === 'undecided') {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
        if (Math.abs(dx) > Math.abs(dy)) {
          s.axis = 'x'
          // Keep receiving events even if the finger leaves this element.
          e.currentTarget.setPointerCapture?.(e.pointerId)
        } else {
          // Vertical: hand it back to the scroller and stop watching.
          state.current = null
          return
        }
      }

      if (s.axis !== 'x' || Math.abs(dx) < threshold) return

      // Fire as soon as the threshold is crossed rather than waiting for a
      // pointerup that Android may replace with a pointercancel.
      s.fired = true
      if (dx < 0) onSwipeLeft?.()
      else onSwipeRight?.()
    },

    onPointerUp: reset,
    onPointerCancel: reset,
  }
}
