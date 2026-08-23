import { useRef, useState } from 'react'
import { hapticLight } from '../lib/haptics'

/**
 * Time, as a strip you drag rather than a field you type into.
 *
 * Replaces the native `<input type="time">` in DateTimePicker — correct,
 * but it hands the whole job to whatever number-wheel the OS keyboard
 * feels like showing, and getting there means tapping into a field and
 * typing digits. This is one gesture: drag the ruler, watch the readout,
 * let go. Modelled after SleepDial's pointer handling (capture on down,
 * live updates on move, stopPropagation so a drag here can't also open the
 * sheet's own swipe-to-dismiss) rather than reinvented from scratch.
 */

const MINUTES_IN_DAY = 24 * 60
/** Pixels per minute — set so about three hours of ruler fit across a
 *  typical sheet width, generous enough for a thumb to land within a
 *  five-minute tick without the strip needing to be enormous. */
const PX_PER_MIN = 1.8
/** Drag snaps here; nothing finer would land reliably under a thumb. */
const STEP = 5

function toHHMM(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function fromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function readout(min: number): { time: string; ampm: string } {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return { time: `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')}`, ampm }
}

export function TimeRuler({ value, onChange }: { value: string; onChange: (hhmm: string) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startX: number; startMin: number; lastMin: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const min = fromHHMM(value)
  const { time, ampm } = readout(min)

  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    drag.current = { startX: e.clientX, startMin: min, lastMin: min }
    setDragging(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no capture — a drag that leaves the strip just stops updating */
    }
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    e.stopPropagation()
    const deltaX = e.clientX - d.startX
    const raw = d.startMin - deltaX / PX_PER_MIN
    const snapped = Math.round(raw / STEP) * STEP
    const clamped = Math.max(0, Math.min(MINUTES_IN_DAY - 1, snapped))
    if (clamped !== d.lastMin) {
      d.lastMin = clamped
      hapticLight()
      onChange(toHHMM(clamped))
    }
  }

  const stop = (e: React.PointerEvent) => {
    e.stopPropagation()
    drag.current = null
    setDragging(false)
  }

  // Hour marks the full width of the day, quarter-hour marks between them —
  // drawn once, not regenerated per render, since neither the count nor
  // their position on the track (only the track's own offset) ever changes.
  const ticks = useRef(
    Array.from({ length: MINUTES_IN_DAY / STEP }, (_, i) => i * STEP),
  ).current

  return (
    <div className="time-ruler-wrap">
      <div className="time-ruler-readout num">
        {time}
        <span className="time-ruler-ampm">{ampm}</span>
      </div>
      <div
        className="time-ruler"
        data-dragging={dragging || undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={stop}
        onPointerCancel={stop}
      >
        <div className="time-ruler-center" aria-hidden />
        <div
          ref={trackRef}
          className="time-ruler-track"
          style={{ transform: `translateX(${-min * PX_PER_MIN}px)` }}
        >
          {ticks.map((m) => {
            const isHour = m % 60 === 0
            const isQuarter = m % 15 === 0
            return (
              <span
                key={m}
                className="time-ruler-tick"
                data-hour={isHour || undefined}
                data-quarter={(!isHour && isQuarter) || undefined}
                style={{ left: m * PX_PER_MIN }}
              >
                {isHour && <span className="time-ruler-label">{m / 60}</span>}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
