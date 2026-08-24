import { useEffect, useId, useRef, useState } from 'react'
import { SLEEP_QUALITY_LABEL, SLEEP_QUALITY_LEVELS, type SleepQuality } from '../types'
import { hapticLight } from '../lib/haptics'

/**
 * A moon at any point in its cycle.
 *
 * The shadow is cut with an SVG **mask**, not painted as a second circle in
 * the background colour. The painted version only ever looked right on the
 * one flat colour it was hard-coded to — over the gradient it sat as an
 * opaque blob with a visible seam, which is what made the control read as
 * half-finished. A mask makes the shadowed part genuinely transparent, so
 * the crescent works over anything behind it.
 */
export function MoonFace({
  phase,
  level,
  size = 26,
}: {
  /** 0–1, new moon to full. Takes precedence over `level`. */
  phase?: number
  level?: SleepQuality
  size?: number
}) {
  const uid = useId()
  const p = phase ?? (level ? phaseOf(level) : 0)
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden>
      <defs>
        <mask id={`m${uid}`}>
          <circle cx="50" cy="50" r="30" fill="#fff" />
          {/* Slides right as the moon waxes; at p=1 it is clear of the disc. */}
          <circle cx={50 + p * 62} cy="50" r="30" fill="#000" />
        </mask>
        <radialGradient id={`g${uid}`} cx="38%" cy="34%">
          <stop offset="0%" stopColor="#fffdf6" />
          <stop offset="100%" stopColor="currentColor" />
        </radialGradient>
      </defs>
      {/* Same earthshine disc as the big moon — see the note there. */}
      <circle cx="50" cy="50" r="30" fill="currentColor" opacity="0.14" />
      <circle cx="50" cy="50" r="30" fill={`url(#g${uid})`} mask={`url(#m${uid})`} />
    </svg>
  )
}

/** Evenly spaced, so the moon advances the same amount per step whichever
 *  two levels you drag between. */
function phaseOf(level: SleepQuality): number {
  return SLEEP_QUALITY_LEVELS.indexOf(level) / (SLEEP_QUALITY_LEVELS.length - 1)
}

/** [x%, y%, how far into the phase it lights up] — fixed rather than random
 *  so the sky doesn't reshuffle on every render. */
const STARS: [number, number, number][] = [
  [9, 26, 0.15],
  [21, 62, 0.45],
  [33, 18, 0.3],
  [67, 24, 0.35],
  [79, 66, 0.5],
  [90, 32, 0.2],
  [58, 74, 0.6],
  [15, 44, 0.55],
]

/**
 * How the night felt.
 *
 * Rebuilt from a five-moons-in-a-bar strip, which crammed five 18px glyphs
 * and a thumb into 56px and read as muddy at every size. The moon is the
 * whole point of the control, so it gets to be the size of one — one large
 * moon over a lit scene, with a thin track underneath for position.
 *
 * The scene is lit by a single radial glow centred on the moon rather than
 * a left-to-right dawn gradient. The gradient version was warm on one side
 * and cold on the other at every rating, so the panel always looked like
 * two halves of different designs stitched together.
 *
 * Every frame writes transforms and one custom property straight onto nodes
 * this component owns through refs. Nothing reads `getComputedStyle` in the
 * loop — the previous version did, which forced a synchronous style recalc
 * sixty times a second and is most of why the motion felt rough.
 */
export function SleepQualitySlider({
  value,
  onChange,
  locked,
}: {
  value?: SleepQuality
  onChange: (v: SleepQuality | undefined) => void
  locked?: boolean
}) {
  const scene = useRef<HTMLDivElement>(null)
  const moonWrap = useRef<HTMLDivElement>(null)
  const moonSvg = useRef<SVGCircleElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [held, setHeld] = useState(false)
  const uid = useId()

  const current = value
  const index = current ? SLEEP_QUALITY_LEVELS.indexOf(current) : 2
  const last = SLEEP_QUALITY_LEVELS.length - 1

  /* ------------------------------------------------------------------
     Two springs on one rAF loop.

     `pos` is where the knob sits, 0–1 across the track. It is stiff and
     lightly damped: it is the thing under the finger, and lag there reads
     as the control ignoring you.

     `phase` is the moon. Looser and heavier, so the sky keeps settling for
     a beat after the finger stops — that follow-through is what separates
     "animated" from "wired directly to a slider".
     ------------------------------------------------------------------ */
  const mkSpring = (stiff: number, damp: number) => ({ at: 0.5, to: 0.5, vel: 0, stiff, damp })
  const pos = useRef(mkSpring(0.34, 0.68))
  const phase = useRef(mkSpring(0.13, 0.76))
  const frame = useRef(0)

  const step = (s: { at: number; to: number; vel: number; stiff: number; damp: number }) => {
    s.vel = (s.vel + (s.to - s.at) * s.stiff) * s.damp
    s.at += s.vel
    return Math.abs(s.to - s.at) > 0.0004 || Math.abs(s.vel) > 0.0004
  }

  /** Writes both springs onto the DOM. Called per frame, and once directly
   *  on mount so the first paint is already correct. */
  const paint = () => {
    const p = Math.max(0, Math.min(1, phase.current.at))
    const x = Math.max(0, Math.min(1, pos.current.at))

    if (scene.current) scene.current.style.setProperty('--phase', p.toFixed(4))
    if (moonSvg.current) moonSvg.current.setAttribute('cx', String(50 + p * 62))
    // The moon drifts a little with the rating — rising as the night gets
    // better. Small: it is a lit scene reacting, not a second slider.
    if (moonWrap.current) {
      moonWrap.current.style.transform = `translate(-50%, 0) translateY(${(1 - p) * 7}px)`
    }
    if (knob.current) knob.current.style.left = `${x * 100}%`
    if (fill.current) fill.current.style.transform = `scaleX(${x})`
  }

  const tick = () => {
    frame.current = 0
    const moving = [step(pos.current), step(phase.current)].some(Boolean)
    paint()
    if (dragging.current || moving) frame.current = requestAnimationFrame(tick)
  }

  const run = () => {
    if (!frame.current) frame.current = requestAnimationFrame(tick)
  }

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current) }, [])

  /**
   * Settles onto whatever level is current when it changes from outside a
   * drag. The first run snaps and paints immediately rather than animating:
   * a night already rated "Great" should *be* a full moon when the screen
   * appears, not play the whole lunar cycle at you on every open.
   */
  const settled = useRef(false)
  useEffect(() => {
    if (dragging.current) return
    const target = current ? phaseOf(current) : 0.5
    const at = current ? index / last : 0.5
    pos.current.to = at
    phase.current.to = target
    if (!settled.current) {
      settled.current = true
      pos.current.at = at
      phase.current.at = target
      pos.current.vel = 0
      phase.current.vel = 0
      paint()
      return
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, index])

  const pick = (clientX: number) => {
    const el = scene.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width))

    // The knob follows the finger exactly; the moon chases it. Snapping the
    // knob to the nearest step mid-drag feels like being corrected.
    pos.current.at = t
    pos.current.vel = 0
    pos.current.to = t
    phase.current.to = t
    run()

    const i = Math.round(t * last)
    const next = SLEEP_QUALITY_LEVELS[i]
    if (next !== current) {
      hapticLight()
      onChange(next)
    }
  }

  const end = () => {
    if (!dragging.current) return
    dragging.current = false
    setHeld(false)
    // Springs home to the level it landed on rather than stopping dead
    // wherever the finger left off.
    pos.current.to = index / last
    phase.current.to = current ? phaseOf(current) : 0.5
    run()
  }

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-2">
        <span className="sleep-time-l">How was it?</span>
        {current && !locked && (
          <button
            className="text-[13px] font-medium"
            style={{ color: 'color-mix(in srgb, var(--slp-1) 55%, transparent)' }}
            onClick={() => onChange(undefined)}
          >
            Clear
          </button>
        )}
      </div>

      <div
        ref={scene}
        className="sleep-scene"
        data-held={held || undefined}
        data-locked={locked || undefined}
        onPointerDown={(e) => {
          if (locked) return
          e.stopPropagation()
          dragging.current = true
          setHeld(true)
          e.currentTarget.setPointerCapture(e.pointerId)
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
        {/* The lit sky. Both layers read --phase, so the whole panel warms
            as one thing instead of one half warming and the other not. */}
        <div className="sleep-scene-sky" aria-hidden />
        <div className="sleep-scene-glow" aria-hidden />

        <div className="sleep-scene-stars" aria-hidden>
          {STARS.map(([x, y, at], i) => (
            <span
              key={i}
              className="sleep-scene-star"
              style={
                {
                  left: `${x}%`,
                  top: `${y}%`,
                  '--at': at,
                  '--tw': `${(i * 0.41) % 2.2}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>

        <div ref={moonWrap} className="sleep-scene-moon" aria-hidden>
          <svg width="64" height="64" viewBox="0 0 100 100" fill="none">
            <defs>
              <mask id={`sm${uid}`}>
                <circle cx="50" cy="50" r="30" fill="#fff" />
                <circle ref={moonSvg} cx="50" cy="50" r="30" fill="#000" />
              </mask>
              <radialGradient id={`sg${uid}`} cx="36%" cy="32%">
                <stop offset="0%" stopColor="#fffdf4" />
                <stop offset="70%" stopColor="#f6dfae" />
                <stop offset="100%" stopColor="#e0b978" />
              </radialGradient>
            </defs>
            {/* Earthshine: the unlit part of a real moon is still a disc you
                can see against the sky. Without this the whole moon simply
                vanishes at "Rough" and the panel looks empty rather than
                dark. Drawn under the crescent, so the lit edge stays clean. */}
            <circle
              cx="50"
              cy="50"
              r="30"
              fill="#fff"
              opacity="0.07"
              stroke="#fff"
              strokeOpacity="0.16"
              strokeWidth="1.5"
            />
            <circle cx="50" cy="50" r="30" fill={`url(#sg${uid})`} mask={`url(#sm${uid})`} />
          </svg>
        </div>

        <div className="sleep-scene-label">
          {current ? SLEEP_QUALITY_LABEL[current] : 'Not rated'}
        </div>

        {/* The track. Thin on purpose — the moon above already says what the
            rating is, so this only has to say where you are in the range. */}
        <div className="sleep-scene-track">
          <div ref={fill} className="sleep-scene-fill" />
          {SLEEP_QUALITY_LEVELS.map((lvl, i) => (
            <span
              key={lvl}
              className="sleep-scene-tick"
              data-on={i <= index || undefined}
              style={{ left: `${(i / last) * 100}%` }}
            />
          ))}
          <div ref={knob} className="sleep-scene-knob" />
        </div>

        {/* Real buttons over the track so each level is reachable by tap and
            named for a screen reader — the drag is the fast path, this is
            the obvious one. */}
        <div className="sleep-scene-hits">
          {SLEEP_QUALITY_LEVELS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              aria-label={SLEEP_QUALITY_LABEL[lvl]}
              aria-pressed={lvl === current}
              disabled={locked}
              onClick={(e) => {
                e.stopPropagation()
                if (lvl !== current) {
                  hapticLight()
                  onChange(lvl)
                }
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
