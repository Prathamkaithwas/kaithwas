import { useEffect, useRef, useState } from 'react'

/**
 * Counts a number up (or down) to `target` when it changes, rather than
 * letting the display jump.
 *
 * Hand-rolled on requestAnimationFrame. This used to run on anime.js, which
 * was the whole reason that library was a dependency — a lot of bytes for one
 * eased interpolation.
 *
 * Motion here is functional: it shows that a figure moved and roughly how far.
 * 200ms is the cap the design allows, and the eased-out curve spends most of
 * it near the final value.
 */
export function useCountUp(target: number, duration = 200): number {
  const [display, setDisplay] = useState(target)
  const prev = useRef(target)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      prev.current = target
      return
    }

    const from = prev.current
    prev.current = target

    if (from === target) return

    // Respect the system setting rather than animating over it.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target)
      return
    }

    const start = performance.now()
    let frame = 0

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // ease-out quad
      const eased = 1 - (1 - t) * (1 - t)
      setDisplay(Math.round(from + (target - from) * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    // A guaranteed landing, independent of rAF.
    //
    // This is not belt-and-braces: requestAnimationFrame stops being delivered
    // whenever the WebView is not compositing — backgrounded, occluded, or
    // mid-transition — and when that happens the animation freezes wherever it
    // got to. For a counter that would be cosmetic. This hook renders amounts
    // of money, including the calculator's running total, so a frozen frame
    // means a *wrong number* sitting on screen next to a Save button.
    // The timer fires even when frames do not.
    const land = setTimeout(() => {
      cancelAnimationFrame(frame)
      setDisplay(target)
    }, duration + 50)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(land)
      // Interrupted part-way (a new target, or unmount) — show the real value.
      setDisplay(target)
    }
  }, [target, duration])

  return display
}
