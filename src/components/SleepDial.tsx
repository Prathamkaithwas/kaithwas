import { useRef, useState } from 'react'
import { hoursMinutes } from '../lib/sleep'

/**
 * The night, as a ring.
 *
 * A twenty-four hour face, not the twelve-hour one the reference art used.
 * Sleep crosses midnight, and on a twelve-hour face 23:30 and 11:30 occupy the
 * same point — the two handles become impossible to tell apart the moment
 * either is dragged. Twenty-four hours costs nothing and cannot misreport the
 * time: midnight at the top, noon at the bottom.
 *
 * The filled arc runs clockwise from the moon to the sun, wrapping past
 * midnight when it has to, so the shape on screen is literally the span of
 * time asleep.
 */

const CX = 100
const CY = 100
const R = 74
const MINUTES = 24 * 60

/**
 * Snap for dragging. Five minutes asked for more precision than a thumb on
 * a 24-hour ring can actually deliver — a couple of pixels of wobble kept
 * landing on the wrong five-minute tick. Fifteen is coarse enough that the
 * handle goes where it looks like it's going.
 */
const STEP = 15

/** Minutes past midnight → degrees clockwise from the top. */
function toAngle(min: number): number {
  return (min / MINUTES) * 360
}

function polar(r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
}

/**
 * Night sky and dawn clouds, fixed to the hours they belong to rather than
 * to the handles — a small scatter of stars across 21:00–03:00 and a couple
 * of clouds across 06:00–09:00, sitting right on the ring. Whatever the two
 * handles are doing, the clock face itself still reads as a night passing
 * into a morning, which a bare circle never did.
 */
const STARS: [hour: number, rOffset: number, size: number, opacity: number][] = [
  [21.3, -7, 2.6, 0.85],
  [22.6, 5, 1.7, 0.55],
  [0.3, -4, 2.1, 0.7],
  [1.6, 6, 1.5, 0.5],
  [2.8, -6, 1.9, 0.6],
]
const CLOUDS: [hour: number, rOffset: number, scale: number, opacity: number][] = [
  [5.2, -7, 0.5, 0.3],
  [6.2, 8, 1, 0.55],
  [6.9, -6, 0.65, 0.35],
  [7.5, -6, 0.72, 0.4],
  [8.2, 6, 0.8, 0.45],
  [8.5, 7, 0.58, 0.3],
  [9.3, -5, 0.6, 0.3],
]

function sparklePath(r: number): string {
  return `M0 ${-r} Q${r * 0.16} ${-r * 0.16} ${r} 0 Q${r * 0.16} ${r * 0.16} 0 ${r} Q${-r * 0.16} ${r * 0.16} ${-r} 0 Q${-r * 0.16} ${-r * 0.16} 0 ${-r} Z`
}

/** The asleep arc, drawn clockwise and allowed to wrap past midnight. */
function arcPath(startMin: number, endMin: number): string {
  const span = (endMin - startMin + MINUTES) % MINUTES
  const a = polar(R, toAngle(startMin))
  const b = polar(R, toAngle(endMin))
  return `M${a.x} ${a.y} A${R} ${R} 0 ${span > MINUTES / 2 ? 1 : 0} 1 ${b.x} ${b.y}`
}

export function SleepDial({
  startMin,
  endMin,
  onChange,
  locked,
}: {
  startMin: number
  endMin: number
  onChange: (next: { startMin: number; endMin: number }) => void
  /** A night already has a recorded time — dragging is how a stray thumb
   *  used to overwrite it while just swiping past. Locked, a touch on the
   *  ring does nothing and falls through to whatever gesture sits under it
   *  (the tab swipe), same as a touch that misses the ring entirely. */
  locked?: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<'start' | 'end' | null>(null)

  const minutesAt = (clientX: number, clientY: number): number => {
    const el = svgRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const scale = 200 / rect.width
    const x = (clientX - rect.left) * scale - CX
    const y = (clientY - rect.top) * scale - CY
    let deg = (Math.atan2(y, x) * 180) / Math.PI + 90
    if (deg < 0) deg += 360
    const raw = (deg / 360) * MINUTES
    return (Math.round(raw / STEP) * STEP) % MINUTES
  }

  /** Which handle the touch was nearer to, the short way round the clock. */
  const nearest = (min: number): 'start' | 'end' => {
    const gap = (a: number, b: number) => {
      const d = Math.abs(a - b) % MINUTES
      return Math.min(d, MINUTES - d)
    }
    return gap(min, startMin) <= gap(min, endMin) ? 'start' : 'end'
  }

  const apply = (handle: 'start' | 'end', min: number) => {
    if (handle === 'start') onChange({ startMin: min, endMin })
    else onChange({ startMin, endMin: min })
  }

  /** How far a touch point sits from the ring, in the same 200-unit space
   *  everything else here works in. */
  const ringDistance = (clientX: number, clientY: number): number => {
    const el = svgRef.current
    if (!el) return Infinity
    const rect = el.getBoundingClientRect()
    const scale = 200 / rect.width
    const x = (clientX - rect.left) * scale - CX
    const y = (clientY - rect.top) * scale - CY
    return Math.abs(Math.hypot(x, y) - R)
  }

  /** A thumb's worth of slack around the ring itself, not the whole square
   *  the SVG occupies. The dial used to grab a touch anywhere in that
   *  square — including the open middle and the corners well past either
   *  handle — which is what made a sideways swipe through the empty parts
   *  of the card silently drag a handle instead of switching tabs. */
  const TOUCH_BAND = 26

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (locked) return
    if (ringDistance(e.clientX, e.clientY) > TOUCH_BAND) return
    // The whole screen carries the sub-tab swipe, and dragging a handle round
    // the ring is mostly sideways movement — so without this, setting a
    // bedtime threw you out to the next tab. Same guard the editor and Pinly
    // use to keep their own gestures. Only claimed once the touch is
    // confirmed to be on the ring — see TOUCH_BAND above.
    e.stopPropagation()
    const min = minutesAt(e.clientX, e.clientY)
    const handle = nearest(min)
    setDrag(handle)
    apply(handle, min)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no capture — a drag off the ring just stops updating */
    }
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // Stopping propagation unconditionally here undid the whole point of
    // onDown's ring-distance guard: a swipe that starts outside the band and
    // correctly falls through to the tab swipe still passes *through* the
    // dial's bounding box on its way, and every one of those move events
    // was getting eaten right here before the tab swipe ever saw them. Only
    // an actual drag gets to claim the gesture.
    if (!drag || e.buttons !== 1) return
    e.stopPropagation()
    apply(drag, minutesAt(e.clientX, e.clientY))
  }

  const asleep = (endMin - startMin + MINUTES) % MINUTES
  const { h, m } = hoursMinutes(asleep)
  const moon = polar(R, toAngle(startMin))
  const sun = polar(R, toAngle(endMin))

  return (
    <div className="sleep-dial" data-locked={locked || undefined}>
      <svg
        ref={svgRef}
        viewBox="0 0 200 200"
        className="sleep-dial-svg"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <defs>
          {/* The arc runs from the moon to the sun, so the gradient is pinned
              to those two points rather than to the box — night at the
              bedtime end, dawn at the wake end, whichever way round the
              clock they happen to sit. */}
          <linearGradient
            id="sleepArcGrad"
            gradientUnits="userSpaceOnUse"
            x1={moon.x}
            y1={moon.y}
            x2={sun.x}
            y2={sun.y}
          >
            <stop offset="0%" stopColor="var(--slp-night-deep)" />
            <stop offset="38%" stopColor="var(--slp-night)" />
            <stop offset="82%" stopColor="var(--slp-dawn-warm)" />
            <stop offset="100%" stopColor="var(--slp-dawn)" />
          </linearGradient>
        </defs>

        <circle cx={CX} cy={CY} r={R} className="sleep-track" />

        {/* The ring's own sky — stars where the night sits, clouds where
            the morning does, independent of where the handles are. */}
        <g aria-hidden>
          {STARS.map(([hour, rOffset, size, opacity], i) => {
            const p = polar(R + rOffset, toAngle(hour * 60))
            return (
              <path
                key={i}
                d={sparklePath(size)}
                transform={`translate(${p.x} ${p.y})`}
                className="sleep-star"
                opacity={opacity}
              />
            )
          })}
          {CLOUDS.map(([hour, rOffset, scale, opacity], i) => {
            const p = polar(R + rOffset, toAngle(hour * 60))
            return (
              <g
                key={i}
                transform={`translate(${p.x} ${p.y}) scale(${scale})`}
                className="sleep-cloud"
                opacity={opacity}
              >
                <circle cx="-4" cy="1.2" r="3.4" />
                <circle cx="0" cy="-1.3" r="4.2" />
                <circle cx="4.4" cy="1.2" r="3.1" />
                <ellipse cx="0" cy="3.1" rx="8.2" ry="2.6" />
              </g>
            )
          })}
        </g>

        {/* Hour ticks. The four quarters of the day are longer, so midnight
            and noon are findable without reading any numbers. */}
        {Array.from({ length: 24 }, (_, i) => {
          const quarter = i % 6 === 0
          const a = toAngle(i * 60)
          const p1 = polar(R - (quarter ? 11 : 6), a)
          const p2 = polar(R - 1, a)
          return (
            <line
              key={i}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              className={quarter ? 'sleep-tick is-quarter' : 'sleep-tick'}
            />
          )
        })}

        <path d={arcPath(startMin, endMin)} className="sleep-arc" />

        <g transform={`translate(${moon.x} ${moon.y})`} className="sleep-handle">
          <circle r="13" fill="var(--slp-night)" />
          {/* a crescent: a disc with a second disc bitten out of it */}
          <path
            d="M2.6 -5.4a5.6 5.6 0 1 0 3.2 9.4A6.6 6.6 0 0 1 2.6 -5.4Z"
            fill="var(--slp-deep)"
            transform="translate(-0.6 0.4)"
          />
        </g>

        <g transform={`translate(${sun.x} ${sun.y})`} className="sleep-handle">
          <circle r="13" fill="var(--slp-dawn-warm)" />
          <circle r="4.2" fill="var(--slp-deep)" />
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i * 45 * Math.PI) / 180
            return (
              <line
                key={i}
                x1={Math.cos(a) * 6}
                y1={Math.sin(a) * 6}
                x2={Math.cos(a) * 8.4}
                y2={Math.sin(a) * 8.4}
                stroke="var(--slp-deep)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            )
          })}
        </g>
      </svg>

      <div className="sleep-dial-mid" aria-hidden>
        <div className="sleep-dur">
          <span className="num">{String(h).padStart(2, '0')}</span>
          <small>hr</small>
          {m > 0 && (
            <>
              <span className="num sleep-dur-m">{m}</span>
              <small>min</small>
            </>
          )}
        </div>
        <div className="sleep-dial-cap">asleep</div>
      </div>
    </div>
  )
}
