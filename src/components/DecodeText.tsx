import { useEffect, useState } from 'react'

/** Symbols the scramble draws from. No letters — the noise has to be
 *  obviously noise, or a half-decoded word just looks like a typo. */
const GLYPHS = '▚▞▘▝▗▖░▒▓#%&@*+=-<>/\\|:;·'

/** Milliseconds per frame. */
const STEP = 35
/** Frames each character waits before it locks, counted from the left. */
const DWELL = 3
/** How long the finished word rests before it scrambles again. */
const HOLD = 1800

/**
 * Text that decodes out of random glyphs, left to right, over and over.
 *
 * Every frame each unsettled character is swapped for a random symbol;
 * character *i* locks once the frame count has passed `i * DWELL`, so the
 * word resolves as a wave travelling left to right rather than all at once.
 *
 * It loops, and so does the Habits glitch beside it. A word that is
 * permanently scrambled would be unreadable, so the cycle still spends most
 * of its time settled: about half a second decoding, then a little under two
 * seconds of plain legible text, then again.
 *
 * State is local to this component on purpose. At 35ms it re-renders roughly
 * thirty times a second, and inlining that in the shell would have re-rendered
 * the whole header — every tab, the stepper and the sub-tab rail — at the same
 * rate. Here it repaints one span.
 *
 * Spaces are never scrambled; they hold the word's shape so the layout does
 * not shuffle while it resolves.
 */
export function DecodeText({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text)

  useEffect(() => {
    // Someone who has asked the system for less motion should get the word,
    // not a light show.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(text)
      return
    }

    const chars = [...text]
    const total = (chars.length + 1) * DWELL
    let tick: ReturnType<typeof setInterval> | undefined
    let hold: ReturnType<typeof setTimeout> | undefined

    const run = () => {
      let frame = 0
      tick = setInterval(() => {
        frame++
        setShown(
          chars
            .map((ch, i) =>
              ch === ' ' || frame >= (i + 1) * DWELL
                ? ch
                : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
            )
            .join(''),
        )
        if (frame >= total) {
          clearInterval(tick)
          setShown(text)
          hold = setTimeout(run, HOLD)
        }
      }, STEP)
    }

    run()
    return () => {
      clearInterval(tick)
      clearTimeout(hold)
    }
  }, [text])

  return (
    // aria-label carries the real word, so the settled text is what gets read
    // out rather than whatever glyphs happen to be on screen.
    <span className={className} aria-label={text}>
      <span aria-hidden>{shown}</span>
    </span>
  )
}
