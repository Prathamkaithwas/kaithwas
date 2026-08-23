import { useRef, useState } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'

/**
 * A dial for habits that carry a number instead of a plain tick — minutes
 * meditated, pages read, that sort of thing. Modelled on the arc gauges
 * smart-home apps use for a thermostat: sweep the arc or tap a tick to set
 * today's amount, with the exact-entry field underneath for anything the
 * gauge itself can't reach — going past the target, or typing a number too
 * precise to land a thumb on.
 *
 * The gauge tops out at `max` (the habit's target) even though the value it
 * is showing can go higher: past the target the needle just pins at the end,
 * and the number below keeps counting. A dial that stretched its own range
 * to fit every overshoot would put the everyday amount in a cramped sliver at
 * one end — worse for the common case to make the rare one look right.
 *
 * The needle bounces at either end rather than stopping dead — the same
 * elastic-overshoot feel as react-bits' ElasticSlider, ported in as just
 * that one physical detail (a decayed overshoot that springs back to zero
 * on release), not the slider itself.
 */

const CX = 100
const CY = 96
const R = 78
const START_ANGLE = 200
const END_ANGLE = -20
const SWEEP = START_ANGLE - END_ANGLE
const TICKS = 40

/** How far past either end the needle is allowed to visibly swing. */
const MAX_OVERSHOOT_DEG = 14

function polar(r: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) }
}

function angleForT(t: number): number {
  return START_ANGLE - SWEEP * Math.min(1, Math.max(0, t))
}

/** Same shape as the slider's decay(): squashes an unbounded push into a
 *  bounded one that approaches `max` but never reaches it. */
function decay(pushDeg: number, max: number): number {
  if (max === 0) return 0
  const entry = pushDeg / max
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5)
  return sigmoid * max
}

export function Meter({
  value,
  max,
  unit,
  color,
  onChange,
}: {
  value: number
  max: number
  unit: string
  color: string
  onChange: (next: number) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState(false)
  const [exact, setExact] = useState('')
  const [editingExact, setEditingExact] = useState(false)

  // Signed degrees: positive past the max end, negative past the zero end.
  // .jump() while dragging (no animation fighting the finger), spring back
  // to 0 the moment it lifts — exactly ElasticSlider's overflow/scale pair.
  const overshoot = useMotionValue(0)
  const needleScale = useTransform(overshoot, (o) => {
    const push = Math.min(Math.abs(o), MAX_OVERSHOOT_DEG) / MAX_OVERSHOOT_DEG
    return 1 + push * 0.5
  })

  const shown = Math.max(0, value)
  const t = max > 0 ? Math.min(1, shown / max) : 0

  /** The clamped value a drag lands on, same as before — this is what
   *  actually gets saved. */
  const valueAt = (clientX: number, clientY: number): number => {
    const el = svgRef.current
    if (!el) return shown
    const rect = el.getBoundingClientRect()
    const scale = 200 / rect.width
    const x = (clientX - rect.left) * scale - CX
    const y = (clientY - rect.top) * scale - CY
    let theta = (Math.atan2(-y, x) * 180) / Math.PI // (-180, 180]

    // Fold into the arc's own numbering, i.e. (START_ANGLE-360, START_ANGLE],
    // so a drag near the left end (raw angles close to ±180) reads as just
    // past the arc's start rather than as a huge jump the long way round.
    while (theta > START_ANGLE) theta -= 360
    while (theta <= START_ANGLE - 360) theta += 360

    let clamped: number
    if (theta < END_ANGLE) {
      // Below the dial — neither end, the finger has strayed off the arc
      // entirely. This used to always snap to zero, which meant dragging
      // down past the target end threw the value back to the start instead
      // of holding near the max — the glitch. Snapping to whichever end is
      // geometrically nearer (split at the bottom-dead-centre point) is what
      // the finger actually meant.
      const deadMid = (END_ANGLE + (START_ANGLE - 360)) / 2
      const nearMax = theta > deadMid
      clamped = nearMax ? END_ANGLE : START_ANGLE
      // How far past that end the finger actually is, decayed so a wild
      // drag into the dead zone can't stretch the needle indefinitely.
      const raw = nearMax ? END_ANGLE - theta : theta - (START_ANGLE - 360)
      overshoot.jump(decay(raw, MAX_OVERSHOOT_DEG) * (nearMax ? 1 : -1))
    } else {
      clamped = theta
      overshoot.jump(0)
    }
    const tt = (START_ANGLE - clamped) / SWEEP
    return Math.round(tt * max)
  }

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation()
    setDragging(true)
    onChange(valueAt(e.clientX, e.clientY))
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no capture — a drag off the dial just stops updating */
    }
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation()
    if (!dragging || e.buttons !== 1) return
    onChange(valueAt(e.clientX, e.clientY))
  }
  const onUp = () => {
    setDragging(false)
    animate(overshoot, 0, { type: 'spring', bounce: 0.5 })
  }

  const baseAngle = angleForT(t)
  // The overshoot nudges the needle a few extra degrees past whichever end
  // it's pinned at — positive overshoot (past max) swings it further
  // clockwise (more negative angle), negative overshoot the other way.
  // Derived as motion values, not read with a plain .get(), so the spring
  // played on release actually moves the needle frame by frame — a .get()
  // snapshot only updates on React's own next render, which during the
  // spring (no pointer events firing any more) might not come for a while,
  // so the bounce would have played invisibly and the needle would just
  // jump to its rest position whenever something else happened to re-render.
  const needleX = useTransform(overshoot, (o) => polar(R - 4, baseAngle - o).x)
  const needleY = useTransform(overshoot, (o) => polar(R - 4, baseAngle - o).y)
  const zero = polar(R + 16, START_ANGLE)
  const full = polar(R + 16, END_ANGLE)

  return (
    <div className="habit-meter">
      <svg
        ref={svgRef}
        viewBox="0 0 200 170"
        className="habit-meter-svg"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {/* A field of radiating spokes rather than a filled band — closer to
            the thermostat reference this was modelled on, and it reads the
            fraction lit at a glance without a solid arc competing with the
            needle for attention. */}
        {Array.from({ length: TICKS + 1 }, (_, i) => {
          const tt = i / TICKS
          const on = tt <= t + 0.0001
          const p1 = polar(R * 0.56, angleForT(tt))
          const p2 = polar(R, angleForT(tt))
          return (
            <line
              key={i}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              className="habit-meter-tick"
              style={on ? { stroke: color, opacity: 1 } : undefined}
            />
          )
        })}

        <motion.line
          x1={CX}
          y1={CY}
          x2={needleX}
          y2={needleY}
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <motion.circle cx={needleX} cy={needleY} r="6" fill={color} style={{ scale: needleScale }} />

        <text x={zero.x} y={zero.y} className="habit-meter-end" textAnchor="middle">
          0
        </text>
        <text x={full.x} y={full.y} className="habit-meter-end" textAnchor="middle">
          {max}
        </text>
      </svg>

      <div className="habit-meter-mid" aria-hidden>
        <div className="habit-meter-value num">
          {shown}
          <small>{unit}</small>
        </div>
        {value > max && <div className="habit-meter-over">past the {max} target</div>}
      </div>

      <div className="habit-meter-controls">
        <button
          className="habit-meter-step"
          onClick={() => onChange(Math.max(0, shown - 1))}
          aria-label={`One less ${unit}`}
        >
          −
        </button>
        {editingExact ? (
          <input
            className="habit-meter-exact-input"
            type="number"
            inputMode="decimal"
            autoFocus
            value={exact}
            placeholder={String(shown)}
            onChange={(e) => setExact(e.target.value)}
            onBlur={() => {
              const n = Number(exact)
              if (exact !== '' && isFinite(n) && n >= 0) onChange(n)
              setEditingExact(false)
              setExact('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        ) : (
          <button
            className="habit-meter-exact"
            onClick={() => {
              setExact(String(value))
              setEditingExact(true)
            }}
          >
            type exact amount
          </button>
        )}
        <button
          className="habit-meter-step"
          onClick={() => onChange(shown + 1)}
          aria-label={`One more ${unit}`}
        >
          +
        </button>
      </div>
    </div>
  )
}
