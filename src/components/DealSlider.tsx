import { useEffect, useRef, useState } from 'react'
import { DEAL_COLORS, DEAL_LABEL, DEAL_LEVELS, dealLevel, type DealRating } from '../types'
import { hapticLight } from '../lib/haptics'

/** Mouth shape per level — the eyes are the same two dots throughout. */
const MOUTH: Record<DealRating, string> = {
  awful: 'M8 18.2 Q12 13 16 18.2',
  bad: 'M8.4 16.8 Q12 14.4 15.6 16.8',
  okay: 'M8.4 16 H15.6',
  good: 'M8.4 14.8 Q12 17.6 15.6 14.8',
  great: '',
}

/** Exported for the mood check-in, which draws the same five faces on a
 *  different scale — "how you feel" rather than "how the deal went". */
export function Face({ level, size = 26 }: { level: DealRating; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="8.8" cy="10" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15.2" cy="10" r="1.25" fill="currentColor" stroke="none" />
      {level === 'great' ? (
        <path d="M7 14 A5 5 0 0 0 17 14 Z" fill="currentColor" stroke="none" />
      ) : (
        <path d={MOUTH[level]} />
      )}
    </svg>
  )
}

/**
 * How the deal went, on a five-point scale.
 *
 * It looks like a slider and moves like one — a thumb that slides along a
 * filled track, taking the colour of whatever level it lands on — but every
 * level is also its own tap target, so it works as a row of buttons for
 * anyone who would rather just tap. Hence a button disguised as a slider:
 * the drag is the fast path, the tap is the obvious one.
 *
 * The thumb animates between positions; that motion is what makes the five
 * levels read as one continuous scale rather than five unrelated choices.
 */
export function DealSlider({
  value,
  onChange,
}: {
  value?: string
  onChange: (v: DealRating | undefined) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [held, setHeld] = useState(false)
  const current = dealLevel(value)

  // An unrated entry parks the thumb in the middle, greyed, so the control
  // still reads as a scale rather than looking broken.
  const index = current ? DEAL_LEVELS.indexOf(current) : 2
  const tone = current ? DEAL_COLORS[current] : 'var(--line-strong)'
  const step = 100 / DEAL_LEVELS.length

  /* ------------------------------------------------------------------
     Two things move at once, at different speeds, and that difference is
     the whole effect.

     The thumb is pinned to the finger exactly — it is the thing being
     dragged, and anything less than 1:1 on that feels broken. The label
     above it chases at 18% of the remaining distance per frame, so it
     trails behind, leans into the direction of travel and squashes a
     little while it catches up, then settles when the finger stops.

     Both are written straight onto the nodes inside one animation frame.
     React is not involved until the *level* changes, which is at most
     four times across the whole control.
     ------------------------------------------------------------------ */
  const box = useRef<DOMRect | null>(null)
  /** where the finger is, in px from the track's left edge */
  const aim = useRef(0)
  /** where the label has actually got to */
  const at = useRef(0)
  const frame = useRef(0)

  const tick = () => {
    frame.current = 0
    const el = pop.current
    const r = box.current
    if (!el || !r) return

    const gap = aim.current - at.current
    at.current += gap * 0.18
    // lean and squash scale with how far behind it is, so a fast flick
    // deforms it and a slow drag barely does
    const tilt = Math.max(-13, Math.min(13, gap * 0.45))
    const push = Math.min(0.13, Math.abs(gap) * 0.0045)
    el.style.transform =
      `translateX(${at.current}px) translateX(-50%) rotate(${tilt}deg) scale(${1 + push}, ${1 - push})`

    if (dragging.current || Math.abs(gap) > 0.3) {
      frame.current = requestAnimationFrame(tick)
    }
  }

  const run = () => {
    if (!frame.current) frame.current = requestAnimationFrame(tick)
  }

  // A save closes the editor mid-drag often enough to matter; leaving the
  // loop running would keep writing to a node that is no longer mounted.
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current) }, [])

  const pick = (clientX: number) => {
    const el = track.current
    if (!el) return
    const rect = box.current ?? el.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
    const i = Math.min(
      DEAL_LEVELS.length - 1,
      Math.max(0, Math.floor((x / rect.width) * DEAL_LEVELS.length)),
    )

    aim.current = x
    // the thumb itself never lags — it is under the finger
    if (thumb.current) {
      thumb.current.style.setProperty('--drag-x', `${x - (rect.width * step) / 200}px`)
    }
    run()

    const next = DEAL_LEVELS[i]
    if (next !== current) {
      hapticLight()
      onChange(next)
    }
  }

  const end = () => {
    dragging.current = false
    setHeld(false)
    if (thumb.current) thumb.current.style.removeProperty('--drag-x')
    // let the label spring home to the level it landed on rather than
    // stopping dead wherever the finger left it
    const r = box.current
    if (r) aim.current = (r.width * (index + 0.5)) / DEAL_LEVELS.length
    run()
  }

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-2">
        <span className="t-cap">Deal</span>
        <div className="flex items-center gap-3">
          <span
            className="text-[14px] font-semibold"
            style={{ color: current ? DEAL_COLORS[current] : 'var(--muted)' }}
          >
            {current ? DEAL_LABEL[current] : 'Not rated'}
          </span>
          {current && (
            <button
              className="text-[13px] font-medium"
              style={{ color: 'var(--muted)' }}
              onClick={() => onChange(undefined)}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div
        ref={track}
        className="relative w-full select-none"
        style={{ height: 52, touchAction: 'none' }}
        // The editor treats a horizontal drag anywhere on the screen as
        // "switch entry type", so this one has to be kept to itself — without
        // stopPropagation, rating a deal also flips Income to Expense.
        onPointerDown={(e) => {
          e.stopPropagation()
          dragging.current = true
          setHeld(true)
          e.currentTarget.setPointerCapture(e.pointerId)
          box.current = e.currentTarget.getBoundingClientRect()
          // start the label where the finger lands rather than flying in
          // from wherever it was last left
          at.current = e.clientX - box.current.left
          pick(e.clientX)
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return
          e.stopPropagation()
          pick(e.clientX)
        }}
        onPointerUp={(e) => {
          e.stopPropagation()
          end()
        }}
        onPointerCancel={end}
      >
        {/* The holographic surface. The sheen slides and rotates with the
            rating, so the iridescence shifts as you drag rather than looping
            on its own. */}
        <div
          className="holo absolute inset-0 rounded-[var(--r-md)]"
          style={
            {
              border: '1.5px solid rgba(140, 190, 255, 0.32)',
              '--holo-shift': `${(index - 2) * 14}%`,
              '--holo-angle': `${index * 62}deg`,
              // the whole bar swells under the press, like the scrubber
              transform: held ? 'scaleY(1.09)' : 'scaleY(1)',
              transition: 'transform var(--dur) var(--ease-out)',
            } as React.CSSProperties
          }
          aria-hidden
        />

        {/* The face and its name, popped up clear of the finger.

            Your thumb is on top of the thumb — the control cannot show you
            what you are choosing at the place you are choosing it. */}
        <div ref={pop} className="deal-pop" style={{ opacity: held ? 1 : 0 }} aria-hidden>
          <span style={{ color: current ? tone : 'var(--muted)' }}>
            <Face level={DEAL_LEVELS[index]} size={22} />
          </span>
          {DEAL_LABEL[DEAL_LEVELS[index]]}
        </div>

        {/* the thumb, pinned to the finger while dragging and snapping to its
            level's slot on release — `--drag-x` is set imperatively and wins
            over the slot below it, so a re-render never fights the drag */}
        <div
          ref={thumb}
          className="absolute top-[3px] bottom-[3px] rounded-[var(--r-sm)] pointer-events-none flex items-center justify-center"
          style={{
            width: `calc(${step}% - 6px)`,
            left: `var(--drag-x, calc(${index * step}% + 3px))`,
            background: current
              ? `linear-gradient(150deg, #ffffff40, ${tone})`
              : 'rgba(255,255,255,0.72)',
            color: '#0d1730',
            boxShadow: current
              ? `0 0 16px -2px ${tone}, 0 2px 8px rgba(0,0,0,0.35)`
              : '0 2px 8px rgba(0,0,0,0.3)',
            border: '1.5px solid rgba(255,255,255,0.85)',
            // grows into the press rather than shrinking away from it, the
            // way the scrubber in the reference does
            transform: held ? 'scale(1.06)' : 'scale(1)',
            transition: held
              ? 'background var(--dur) var(--ease-out), transform var(--dur-fast) var(--ease-out)'
              : 'left var(--dur-slow) var(--ease-out), background var(--dur) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
          }}
        >
          <Face level={DEAL_LEVELS[index]} />
        </div>

        {/* Tap targets. They sit above the thumb so a straight tap on any
            level selects it, and they carry the faint guide faces. */}
        <div className="absolute inset-0 grid grid-cols-5">
          {DEAL_LEVELS.map((level, i) => (
            <button
              key={level}
              className="flex items-center justify-center"
              style={{ color: i === index ? 'transparent' : 'rgba(10, 22, 44, 0.62)' }}
              aria-label={DEAL_LABEL[level]}
              aria-pressed={level === current}
              onClick={(e) => {
                e.stopPropagation()
                if (level !== current) {
                  hapticLight()
                  onChange(level)
                }
              }}
            >
              <Face level={level} size={20} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
