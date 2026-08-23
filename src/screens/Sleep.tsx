import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { SleepDial } from '../components/SleepDial'
import { EditLockButton } from '../components/ui'
import { activityWeeks, addDays, dateToKey, MONTHS_SHORT, toLocalISO, todayKey, weeksToShow } from '../lib/date'
import {
  durationOf,
  hoursMinutes,
  minutesOfDay,
  nightKeyOf,
  recentAverage,
  shortDuration,
  timesToRange,
} from '../lib/sleep'
import { hapticLight } from '../lib/haptics'

/**
 * Sleep — one night at a time, and a year of them behind it.
 *
 * Deliberately not an alarm clock. The question this answers is "how much am
 * I actually sleeping", which needs a record and a shape to read it in, and
 * nothing that goes off at six in the morning.
 *
 * A night is filed under the evening it began — Tuesday 23:30 to Wednesday
 * 07:00 is Tuesday night. `nightKeyOf` handles the awkward half of that rule
 * (a bedtime past midnight still belongs to the evening before).
 */

/** Where the dial starts on a night with nothing recorded yet. */
const DEFAULT_BED = 23 * 60
const DEFAULT_WAKE = 7 * 60

/** A scatter across the whole screen, not just the header's sliver —
 *  [x%, y%, size in px, opacity, animation-delay in seconds]. Fixed rather
 *  than randomised so the sky doesn't reshuffle on every re-render. */
const SCREEN_STARS: [number, number, number, number, number][] = [
  [8, 4, 2, 0.8, 0], [22, 9, 1.5, 0.5, 0.6], [37, 3, 2.2, 0.9, 1.2],
  [55, 8, 1.5, 0.55, 0.3], [70, 4, 2, 0.75, 1.8], [88, 10, 1.7, 0.6, 0.9],
  [5, 22, 1.8, 0.65, 1.5], [26, 28, 2.2, 0.85, 0.2], [46, 20, 1.5, 0.5, 2.1],
  [64, 26, 2, 0.7, 0.7], [80, 20, 1.6, 0.55, 1.4], [93, 30, 2, 0.8, 0.4],
  [12, 40, 1.5, 0.5, 1.9], [33, 46, 2.3, 0.9, 0.1], [50, 38, 1.6, 0.6, 1.1],
  [68, 44, 1.9, 0.7, 2.4], [85, 40, 1.5, 0.5, 0.5], [3, 55, 2, 0.75, 1.6],
  [20, 60, 1.6, 0.55, 0.8], [40, 54, 2.1, 0.85, 2.0], [58, 60, 1.5, 0.5, 0.3],
  [76, 56, 2, 0.7, 1.3], [92, 62, 1.7, 0.6, 0.6], [10, 70, 1.9, 0.65, 2.2],
  [30, 76, 1.5, 0.5, 1.0], [48, 70, 2.2, 0.8, 0.2], [66, 76, 1.6, 0.55, 1.7],
]

/** Same shape as the ring's own dawn clouds, scattered along the screen's
 *  margins rather than over the dial or the text it would compete with —
 *  [x%, y%, scale, opacity]. */
const SCREEN_CLOUDS: [number, number, number, number][] = [
  [4, 16, 1.3, 0.16], [93, 12, 1.1, 0.14], [8, 62, 1.5, 0.12],
  [90, 58, 1.2, 0.15], [15, 90, 1.6, 0.13], [80, 88, 1.4, 0.12],
]

function SleepCloud({ x, y, scale, opacity }: { x: number; y: number; scale: number; opacity: number }) {
  return (
    <svg
      className="sleep-field-cloud"
      style={{ left: `${x}%`, top: `${y}%`, transform: `translate(-50%, -50%) scale(${scale})`, opacity }}
      width="34" height="16" viewBox="-10 -6 20 12" aria-hidden
    >
      <g className="sleep-cloud">
        <circle cx="-4" cy="1.2" r="3.4" />
        <circle cx="0" cy="-1.3" r="4.2" />
        <circle cx="4.4" cy="1.2" r="3.1" />
        <ellipse cx="0" cy="3.1" rx="8.2" ry="2.6" />
      </g>
    </svg>
  )
}

function SleepStarField() {
  return (
    <div className="sleep-star-field" aria-hidden>
      {SCREEN_STARS.map(([x, y, size, opacity, delay], i) => (
        <span
          key={i}
          className="sleep-field-star"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: size,
            height: size,
            opacity,
            animationDelay: `${delay}s`,
          }}
        />
      ))}
      {SCREEN_CLOUDS.map(([x, y, scale, opacity], i) => (
        <SleepCloud key={i} x={x} y={y} scale={scale} opacity={opacity} />
      ))}
    </div>
  )
}

export function Sleep() {
  const { db, saveSleep, removeSleep } = useStore()
  // Back to the first night actually recorded, not a fixed year of mostly
  // empty columns — a tracker started this month shouldn't open on eleven
  // months of nothing.
  const grid = useMemo(() => {
    const earliest = db.sleepLogs.reduce<string | undefined>(
      (min, s) => (min === undefined || s.date < min ? s.date : min),
      undefined,
    )
    return activityWeeks(weeksToShow(earliest))
  }, [db.sleepLogs])
  const cal = useRef<HTMLDivElement>(null)

  // Open on the recent end — a year is wider than the screen and last week is
  // the part worth seeing first.
  useEffect(() => {
    const el = cal.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [])

  // Tonight's key: the night now in progress, or the one just finished if it
  // is still before noon. nightKeyOf answers exactly this for "now" — fed
  // local time, never toISOString, which is UTC and would put the whole
  // screen on the wrong night for half of every evening in IST.
  const now = new Date()
  const tonight = nightKeyOf(toLocalISO(now))

  // The night actually worth opening on. Before noon, "tonight" already *is*
  // last night — nightKeyOf pushed it back a day, because the night that
  // ended this morning is still what "now" means before you've had lunch.
  // Past noon, "tonight" flips to meaning the night about to start, which is
  // empty — so opening there put an unrecorded dial in front of him every
  // afternoon instead of the night he actually just slept. Last night is
  // always yesterday's date once we're past that boundary.
  const lastNight = now.getHours() < 12 ? tonight : addDays(dateToKey(now), -1)
  const [editing, setEditing] = useState<string>(lastNight)

  const byNight = useMemo(() => {
    const m = new Map<string, (typeof db.sleepLogs)[number]>()
    for (const s of db.sleepLogs) m.set(s.date, s)
    return m
  }, [db.sleepLogs])

  const current = byNight.get(editing)
  const [draft, setDraft] = useState<{ startMin: number; endMin: number } | null>(null)

  // A night that already has a recorded time opens locked — view only, one
  // extra tap away from changing it — so scrolling past the dial or
  // catching the time cards with a stray thumb can't quietly overwrite a
  // real night's sleep. A night with nothing on it yet opens unlocked,
  // since there is nothing there to protect against a mistake.
  //
  // This only resets when `editing` itself changes — i.e. a different night
  // was picked from the calendar — not on every re-render, which is why
  // `current` is deliberately left out of the dependency array: saving a
  // change while already unlocked recomputes `current` too, and re-locking
  // right after the save it was just asked for would undo the whole point.
  const [unlocked, setUnlocked] = useState(!current)
  useEffect(() => {
    setUnlocked(!byNight.get(editing))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  // The dial shows the draft while it is being dragged, the saved night
  // otherwise, and a sensible default for a night with nothing on it.
  const shown = draft ?? {
    startMin: current ? minutesOfDay(current.start) : DEFAULT_BED,
    endMin: current ? minutesOfDay(current.end) : DEFAULT_WAKE,
  }

  const average = useMemo(() => recentAverage(db.sleepLogs, 7), [db.sleepLogs])
  const today = todayKey()

  const commit = (next: { startMin: number; endMin: number }) => {
    setDraft(next)
    const { start, end } = timesToRange(editing, next.startMin, next.endMin)
    saveSleep(editing, start, end)
  }

  return (
    // Its own night, not the app's surface colours. Sleep is the one screen
    // that is *about* the dark: a deep purple ground, a purple moon at the
    // bedtime handle, and the arc warming to sunrise where you wake.
    <div className="relative flex-1 overflow-hidden sleep-screen">
      <div className="sleep-night" aria-hidden />
      {/* The header's moon sits just above this screen's top edge — this is
          its light carrying on down, so the hairline between them reads as
          one continuous night rather than a bar sitting on top of a screen. */}
      <div className="sleep-moonlight" aria-hidden />
      <SleepStarField />
      <div className="relative h-full overflow-y-auto no-scrollbar pb-content px-3 pt-3 space-y-4">
        {/* Floated over the dial's own top-right corner rather than given a
            full-width row of its own — the row used to reserve real height
            (26px button + the space-y gap) purely to hold one small button
            with nothing else in it, which read as a dead strip of empty
            space between the header and the dial. Only a saved night has
            anything to protect — an empty one is already unlocked, so there
            is nothing here to press. */}
        {current && (
          <div className="absolute top-3 right-4 z-10">
            <EditLockButton unlocked={unlocked} onClick={() => setUnlocked((u) => !u)} />
          </div>
        )}

        <SleepDial
          startMin={shown.startMin}
          endMin={shown.endMin}
          locked={!unlocked}
          onChange={(next) => {
            hapticLight()
            commit(next)
          }}
        />

        {/* The dial is quick once you have the hang of it, but dragging a
            handle around a circle to hit an exact minute is fiddly — these
            two cards are the same numbers, tappable, opening the phone's own
            clock-face time picker instead. Either one commits through the
            same `commit`, so the dial and the calendar below stay in sync
            with whichever one was used. Disabled along with the dial while
            the night is locked. */}
        <div className="sleep-times">
          <div className="sleep-time">
            <span className="sleep-time-l">Bedtime</span>
            <span className="sleep-time-v num">{fmt(shown.startMin)}</span>
            <input
              type="time"
              className="sleep-time-input"
              aria-label="Bedtime"
              value={fmt(shown.startMin)}
              disabled={!unlocked}
              onChange={(e) => {
                if (!e.target.value) return
                const [h, m] = e.target.value.split(':').map(Number)
                hapticLight()
                commit({ ...shown, startMin: h * 60 + m })
              }}
            />
          </div>
          <div className="sleep-time">
            <span className="sleep-time-l">Woke up</span>
            <span className="sleep-time-v num">{fmt(shown.endMin)}</span>
            <input
              type="time"
              className="sleep-time-input"
              aria-label="Woke up"
              value={fmt(shown.endMin)}
              disabled={!unlocked}
              onChange={(e) => {
                if (!e.target.value) return
                const [h, m] = e.target.value.split(':').map(Number)
                hapticLight()
                commit({ ...shown, endMin: h * 60 + m })
              }}
            />
          </div>
        </div>

        {/* The only number that judges anything here. There is no goal to be
            short of — he does not keep one — so the average is simply what
            the last seven nights came to. */}
        <div className="sleep-avg">
          <span className="sleep-avg-v num">
            {average === undefined ? '—' : shortDuration(average)}
          </span>
          <span className="sleep-avg-l">average of the last 7 nights</span>
        </div>

        {/* A year of nights, brighter the longer the sleep, with tonight
            outlined rather than filled since it has not happened yet. */}
        <div className="ld-cal sleep-cal cal-glass" ref={cal}>
          <div className="ld-cal-inner">
            <div className="ld-months">
              {(() => {
                let lastLabel = -99
                return grid.map((week, i) => {
                  const m = week[0].slice(5, 7)
                  const isNew = i === 0 || grid[i - 1][0].slice(5, 7) !== m
                  const show = isNew && i - lastLabel >= 3
                  if (show) lastLabel = i
                  return <span key={week[0]}>{show ? MONTHS_SHORT[Number(m) - 1] : ''}</span>
                })
              })()}
            </div>
            <div className="ld-grid">
              {grid.map((week) => (
                <div key={week[0]} className="ld-week">
                  {week.map((d) => {
                    const log = byNight.get(d)
                    const mins = log ? durationOf(log) : 0
                    const strength = mins ? shadeFor(mins) : 0
                    const pending = !log && d >= tonight
                    return (
                      <i
                        key={d}
                        className={pending ? 'sleep-grid-pending' : undefined}
                        data-on={mins > 0 || undefined}
                        data-today={d === today || undefined}
                        data-future={d > today || undefined}
                        style={
                          mins
                            ? {
                                background: `color-mix(in srgb, var(--slp-night) ${Math.round(
                                  strength * 100,
                                )}%, transparent)`,
                              }
                            : undefined
                        }
                        title={log ? `${d} · ${shortDuration(mins)}` : d}
                        onClick={() => {
                          if (d > tonight) return
                          setDraft(null)
                          setEditing(d)
                        }}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Behind the same lock as the dial and time cards — deleting a
            whole night is a bigger mistake than mistyping a time, and it
            makes no sense to guard the small change but leave the
            irreversible one sitting one tap away regardless. */}
        {current && unlocked && (
          <button className="sleep-remove" onClick={() => {
            removeSleep(current.id)
            setDraft(null)
          }}>
            Remove this night
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * How strongly to fill one night's square.
 *
 * Scaled against a fixed nine hours rather than a goal — there is no goal
 * here. A fixed ceiling also means a square's shade means the same thing this
 * year as last; scaling against his own longest night would repaint the whole
 * grid the first time he slept in. Floored at a quarter so a very short night
 * still reads as a night rather than as nothing recorded.
 */
function shadeFor(minutes: number): number {
  return Math.max(0.25, Math.min(1, minutes / 540))
}

/** Minutes past midnight as "23:30". */
function fmt(min: number): string {
  const { h, m } = hoursMinutes(min)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
