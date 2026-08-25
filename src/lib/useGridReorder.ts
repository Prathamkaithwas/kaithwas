import { useCallback, useEffect, useRef, useState } from 'react'
import { hapticLight, hapticMedium } from './haptics'

/**
 * Press and hold a tile, then drag it somewhere else in the grid.
 *
 * Built for a wrapping two-column grid rather than a list, so `motion`'s
 * `Reorder` (which the planner uses for its single-column buckets) does not
 * apply — it reasons about one axis, and half the moves here are sideways.
 *
 * The hold is deliberately long. These tiles are tapped constantly to mark a
 * habit done, and the grid is inside a scroller, so a short press-and-hold
 * would turn ordinary use into accidental reordering. Anything that reads as
 * a tap or the start of a scroll cancels the pickup instead.
 */

/** How long the finger has to stay put. Long on purpose — see above. */
export const HOLD_MS = 3000

/** Movement past this before the timer fires means a scroll, not a pickup. */
const SLOP = 10

export interface GridReorder {
  /** The id currently lifted, or null. */
  dragging: string | null
  /** Where it would land if released now — its index in the current order. */
  overIndex: number | null
  /** 0–1 while the hold is being counted, for the pickup indicator. */
  holdingId: string | null
  /** Spread onto every tile. */
  handlers: (id: string) => {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: () => void
  }
}

export function useGridReorder(
  ids: string[],
  onCommit: (ids: string[]) => void,
  /** Measures each tile. Returns null for anything not on screen. */
  rectOf: (id: string) => DOMRect | null,
): GridReorder {
  const [dragging, setDragging] = useState<string | null>(null)
  const [holdingId, setHoldingId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const timer = useRef<number | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const armed = useRef<string | null>(null)

  const clearHold = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    armed.current = null
    start.current = null
    setHoldingId(null)
  }, [])

  // A tile can unmount mid-drag — a habit archived from another screen, or
  // the tab swapped out — and a timer left running would fire against a
  // component that is gone.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  /** Which slot the pointer is currently over. Uses each tile's own rect, so
   *  it works for a wrapping grid without assuming a column count. */
  const indexAt = useCallback(
    (x: number, y: number): number | null => {
      for (let i = 0; i < ids.length; i++) {
        const r = rectOf(ids[i])
        if (!r) continue
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i
      }
      return null
    },
    [ids, rectOf],
  )

  const handlers = useCallback(
    (id: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (dragging) return
        armed.current = id
        start.current = { x: e.clientX, y: e.clientY }
        setHoldingId(id)
        timer.current = window.setTimeout(() => {
          if (armed.current !== id) return
          // Heavier than the tap haptic, because this is a mode change: the
          // next move does something different from what it did a moment ago.
          hapticMedium()
          setDragging(id)
          setOverIndex(ids.indexOf(id))
          setHoldingId(null)
        }, HOLD_MS)
      },

      onPointerMove: (e: React.PointerEvent) => {
        // Still counting: any real movement means a scroll was intended.
        if (!dragging) {
          const s = start.current
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP) clearHold()
          return
        }
        if (dragging !== id) return
        // Capture only once lifted, so the hold phase never steals a scroll.
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.setPointerCapture(e.pointerId)
        }
        const over = indexAt(e.clientX, e.clientY)
        if (over !== null && over !== overIndex) {
          hapticLight()
          setOverIndex(over)
        }
      },

      onPointerUp: () => {
        if (dragging === id && overIndex !== null) {
          const from = ids.indexOf(id)
          if (from !== -1 && from !== overIndex) {
            const next = [...ids]
            next.splice(from, 1)
            next.splice(overIndex, 0, id)
            onCommit(next)
          }
        }
        clearHold()
        setDragging(null)
        setOverIndex(null)
      },

      onPointerCancel: () => {
        clearHold()
        setDragging(null)
        setOverIndex(null)
      },
    }),
    [dragging, overIndex, ids, indexAt, onCommit, clearHold],
  )

  return { dragging, overIndex, holdingId, handlers }
}
