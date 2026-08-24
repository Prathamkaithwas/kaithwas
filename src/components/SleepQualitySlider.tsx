import { useEffect, useRef, useState } from 'react'
import { SLEEP_QUALITY_COLORS, SLEEP_QUALITY_LABEL, SLEEP_QUALITY_LEVELS, type SleepQuality } from '../types'
import { hapticLight } from '../lib/haptics'

/**
 * The moon, drawn at any point in its cycle rather than at five fixed ones.
 *
 * `phase` is continuous: 0 is a new moon buried in cloud, 1 is full with
 * stars out. That continuity is the whole point — the first version snapped
 * between five discrete drawings, so dragging the slider made the moon jump
 * in steps instead of actually waxing under your thumb.
 *
 * The shadow is a second circle of the same radius sliding off to the right,
 * which is how a real crescent is shaped and why the terminator stays curved
 * at every point in between rather than reading as a disc with a bite out.
 */
export function MoonFace({
  phase,
  level,
  size = 26,
}: {
  /** 0–1. Takes precedence over `level` when both are given. */
  phase?: number
  /** Convenience for the fixed positions — the journal list and tap targets. */
  level?: SleepQuality
  size?: number
}) {
  const p = phase ?? (level ? phaseOf(level) : 0)
  // r * 2 carries the shadow fully clear of the disc, so p === 1 is a clean
  // full moon with no seam where the two circles part.
  const shadowCx = 12 + p * 12.8
  // Stars only once the sky is actually clearing — a star next to a clouded
  // new moon reads as dirt on the screen, not weather.
  const starGlow = Math.max(0, (p - 0.35) / 0.65)
  const cloud = Math.max(0, (0.55 - p) / 0.55)

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {STAR_SPOTS.map(([x, y, at], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={0.9}
          fill="#fff"
          // Staggered so they come out one after another as it clears
          // rather than all three blinking on together.
          opacity={Math.max(0, Math.min(1, (starGlow - at) * 3)) * 0.9}
        />
      ))}
      <circle cx="12" cy="12" r="6.4" fill="currentColor" />
      {p < 1 && <circle cx={shadowCx} cy="12" r="6.4" fill="var(--slp-deeper)" />}
      {cloud > 0 && (
        <ellipse cx="12.5" cy="15.5" rx="7.5" ry="2.6" fill="var(--slp-deeper)" opacity={cloud} />
      )}
    </svg>
  )
}

/** [x, y, when it lights up as `starGlow` climbs] */
const STAR_SPOTS: [number, number, number][] = [
  [3.2, 5.5, 0],
  [20, 4, 0.25],
  [21, 16, 0.55],
]

/** Where each named level sits on the 0–1 phase, evenly spaced so the moon
 *  advances by the same amount per step whichever two you drag between. */
function phaseOf(level: SleepQuality): number {
  return SLEEP_QUALITY_LEVELS.indexOf(level) / (SLEEP_QUALITY_LEVELS.length - 1)
}

/**
 * How the night felt, on a five-point scale you drag or tap.
 *
 * Same control surface as the Deal slider, but the motion is its own: three
 * values are animated per frame off one spring each — the label chasing the
 * finger, the moon's phase, and the thumb's own position — rather than the
 * single linear lerp plus CSS transitions the first version used. Springs
 * are what make a release settle with a little weight behind it instead of
 * gliding to a stop on a fixed curve.
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
  const track = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [held, setHeld] = useState(false)
  const current = value

  const index = current ? SLEEP_QUALITY_LEVELS.indexOf(current) : 2
  const tone = current ? SLEEP_QUALITY_COLORS[current] : 'var(--slp-1)'
  const step = 100 / SLEEP_QUALITY_LEVELS.length

  /* ------------------------------------------------------------------
     Three springs, one rAF loop.

     `pos` is the thumb: stiff and barely damped, because it is the thing
     under the finger and any visible lag there feels like the control is
     ignoring you. `pop` is the label above it: looser, so it trails, leans
     into the direction of travel and squashes while it catches up. `phase`
     is the moon: loosest of the three, so the sky keeps changing for a beat
     after you have stopped moving — that little bit of follow-through is
     most of what reads as "alive" rather than "wired to a slider".

     All three are written straight onto nodes inside the frame. React only
     hears about it when the *level* changes, which is at most four times
     across the whole control.
     ------------------------------------------------------------------ */
  const box = useRef<DOMRect | null>(null)
  const spring = (stiff: number, damp: number) => ({ at: 0, to: 0, vel: 0, stiff, damp })
  const pos = useRef(spring(0.42, 0.62))
  const popS = useRef(spring(0.2, 0.7))
  const phase = useRef(spring(0.14, 0.74))
  const frame = useRef(0)

  /** One spring step. Returns true while it is still meaningfully moving. */
  const advance = (s: { at: number; to: number; vel: number; stiff: number; damp: number }) => {
    s.vel = (s.vel + (s.to - s.at) * s.stiff) * s.damp
    s.at += s.vel
    return Math.abs(s.to - s.at) > 0.0005 || Math.abs(s.vel) > 0.0005
  }

  const tick = () => {
    frame.current = 0
    const r = box.current
    if (!r) return

    const a = advance(pos.current)
    const b = advance(popS.current)
    const c = advance(phase.current)

    if (thumb.current) {
      thumb.current.style.setProperty('--drag-x', `${pos.current.at - (r.width * step) / 200}px`)
    }
    if (pop.current) {
      // Lean and squash scale with how far behind the label is, so a fast
      // flick visibly deforms it and a slow drag barely does.
      const gap = popS.current.to - popS.current.at
      const tilt = Math.max(-13, Math.min(13, gap * 0.45))
      const push = Math.min(0.13, Math.abs(gap) * 0.0045)
      pop.current.style.transform =
        `translateX(${popS.current.at}px) translateX(-50%) rotate(${tilt}deg) scale(${1 + push}, ${1 - push})`
    }
    // The moon and the sky behind it both read off the same spring, so the
    // glow blooms in step with the phase rather than on its own schedule.
    if (track.current) {
      track.current.style.setProperty('--phase', String(phase.current.at))
    }

    if (dragging.current || a || b || c) frame.current = requestAnimationFrame(tick)
  }

  const run = () => {
    if (!frame.current) frame.current = requestAnimationFrame(tick)
  }

  // A save can close the editor mid-drag; leaving the loop running would
  // keep writing to nodes that are no longer mounted.
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current) }, [])

  /**
   * Settles the springs onto whatever level is current whenever it changes
   * from outside a drag — opening a night that already has a rating, or the
   * Clear button putting it back to the middle.
   *
   * The very first run snaps rather than animates, and writes the phase
   * straight onto the node instead of waiting for a frame. A night opened at
   * "Great" should already *be* a full moon when the screen appears; playing
   * the whole lunar cycle at it on every open is an animation nobody asked
   * for, and it would show a wrong phase for the frame before the loop
   * started either way.
   */
  const settled = useRef(false)
  useEffect(() => {
    const el = track.current
    if (!el || dragging.current) return
    // Re-measured rather than cached: the sheet this lives in animates open,
    // so a width read on mount can be from mid-transition.
    box.current = el.getBoundingClientRect()
    const centre = (box.current.width * (index + 0.5)) / SLEEP_QUALITY_LEVELS.length
    const target = current ? phaseOf(current) : 0.5

    pos.current.to = centre
    popS.current.to = centre
    phase.current.to = target

    if (!settled.current) {
      settled.current = true
      pos.current.at = centre
      popS.current.at = centre
      phase.current.at = target
      el.style.setProperty('--phase', String(target))
      if (thumb.current) {
        thumb.current.style.setProperty(
          '--drag-x',
          `${centre - (box.current.width * step) / 200}px`,
        )
      }
      return
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, index])

  const pick = (clientX: number) => {
    const el = track.current
    if (!el) return
    const rect = box.current ?? el.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
    const i = Math.min(
      SLEEP_QUALITY_LEVELS.length - 1,
      Math.max(0, Math.floor((x / rect.width) * SLEEP_QUALITY_LEVELS.length)),
    )

    // The thumb tracks the finger exactly; the label and the moon chase it.
    // Snapping the thumb to `i` instead would make the control feel like it
    // was correcting you mid-gesture.
    pos.current.at = x
    pos.current.vel = 0
    pos.current.to = x
    popS.current.to = x
    // The moon reads the raw finger position, not the landed step — that is
    // what makes it wax continuously through a drag rather than in five jumps.
    phase.current.to = x / rect.width
    run()

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
    const r = box.current
    if (r) {
      // Springs home to the level it landed on, rather than stopping dead
      // wherever the finger happened to leave off.
      const centre = (r.width * (index + 0.5)) / SLEEP_QUALITY_LEVELS.length
      pos.current.to = centre
      popS.current.to = centre
      phase.current.to = current ? phaseOf(current) : 0.5
    }
    run()
  }

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-2">
        <span className="sleep-time-l">How was it?</span>
        <div className="flex items-center gap-3">
          <span
            className="text-[14px] font-semibold"
            style={{ color: tone, transition: 'color 260ms var(--ease-out)' }}
          >
            {current ? SLEEP_QUALITY_LABEL[current] : 'Not rated'}
          </span>
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
      </div>

      <div
        ref={track}
        className="sleep-qslider relative w-full select-none"
        data-held={held || undefined}
        style={{ height: 56, touchAction: 'none', opacity: locked ? 0.75 : 1 }}
        onPointerDown={(e) => {
          if (locked) return
          e.stopPropagation()
          dragging.current = true
          setHeld(true)
          e.currentTarget.setPointerCapture(e.pointerId)
          box.current = e.currentTarget.getBoundingClientRect()
          // Start the label where the finger landed rather than flying it in
          // from wherever it was last left.
          popS.current.at = e.clientX - box.current.left
          popS.current.vel = 0
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
        {/* The night sky. `--phase` is written per frame by the loop above,
            so the dawn wash and the stars brighten continuously with the
            drag instead of stepping between five fixed states. */}
        <div className="sleep-qslider-sky absolute inset-0 rounded-[var(--r-md)]" aria-hidden>
          <span className="sleep-qslider-dawn" />
          {[10, 26, 44, 62, 80, 92].map((x, i) => (
            <span
              key={i}
              className="sleep-qslider-star"
              style={
                {
                  left: `${x}%`,
                  top: `${[30, 60, 20, 70, 45, 25][i]}%`,
                  '--twinkle': `${(i * 0.37) % 1.6}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>

        <div ref={pop} className="sleep-qslider-pop" style={{ opacity: held ? 1 : 0 }} aria-hidden>
          <span style={{ color: tone }}>
            <MoonFace level={SLEEP_QUALITY_LEVELS[index]} size={20} />
          </span>
          {SLEEP_QUALITY_LABEL[SLEEP_QUALITY_LEVELS[index]]}
        </div>

        {/* The thumb. `--drag-x` is written imperatively every frame and wins
            over the slot below it, so a re-render never fights the spring. */}
        <div
          ref={thumb}
          className="sleep-qslider-thumb"
          data-rated={current ? true : undefined}
          style={{
            width: `calc(${step}% - 6px)`,
            left: `var(--drag-x, calc(${index * step}% + 3px))`,
            '--tone': tone,
            transform: held ? 'scale(1.08)' : 'scale(1)',
          } as React.CSSProperties}
        >
          <span className="sleep-qslider-thumb-moon">
            <LiveMoon track={track} />
          </span>
        </div>

        {/* Tap targets over the top, so a straight tap on any level picks it
            and each carries its own faint guide moon. */}
        <div className="absolute inset-0 grid grid-cols-5">
          {SLEEP_QUALITY_LEVELS.map((level, i) => (
            <button
              key={level}
              className="flex items-center justify-center sleep-qslider-step"
              style={{ opacity: i === index ? 0 : 1 }}
              aria-label={SLEEP_QUALITY_LABEL[level]}
              aria-pressed={level === current}
              disabled={locked}
              onClick={(e) => {
                e.stopPropagation()
                if (level !== current) {
                  hapticLight()
                  onChange(level)
                }
              }}
            >
              <MoonFace level={level} size={18} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The moon riding on the thumb, redrawn every frame from the `--phase` the
 * animation loop writes onto the track.
 *
 * Reads the variable off the DOM rather than taking a prop, so the whole
 * per-frame path stays outside React — a `useState` here would re-render the
 * entire slider sixty times a second for one number that only this one
 * element needs.
 */
function LiveMoon({ track }: { track: React.RefObject<HTMLDivElement | null> }) {
  const host = useRef<SVGCircleElement>(null)
  const cloud = useRef<SVGEllipseElement>(null)
  const stars = useRef<SVGGElement>(null)
  const raf = useRef(0)

  useEffect(() => {
    const loop = () => {
      raf.current = requestAnimationFrame(loop)
      const el = track.current
      if (!el) return
      const p = Number(getComputedStyle(el).getPropertyValue('--phase')) || 0
      if (host.current) host.current.setAttribute('cx', String(12 + p * 12.8))
      if (host.current) host.current.style.opacity = p >= 1 ? '0' : '1'
      if (cloud.current) cloud.current.style.opacity = String(Math.max(0, (0.55 - p) / 0.55))
      if (stars.current) {
        stars.current.style.opacity = String(Math.max(0, Math.min(1, (p - 0.35) / 0.5)) * 0.9)
      }
    }
    raf.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf.current)
  }, [track])

  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" aria-hidden>
      <g ref={stars}>
        {STAR_SPOTS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={0.9} fill="#fff" />
        ))}
      </g>
      <circle cx="12" cy="12" r="6.4" fill="currentColor" />
      <circle ref={host} cx="12" cy="12" r="6.4" fill="var(--slp-deeper)" />
      <ellipse ref={cloud} cx="12.5" cy="15.5" rx="7.5" ry="2.6" fill="var(--slp-deeper)" />
    </svg>
  )
}
