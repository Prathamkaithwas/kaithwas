import { useEffect, useMemo, useRef, useState } from 'react'
import type { Chore } from '../types'
import { useStore } from '../store'
import { CHART_COLORS } from '../lib/seed'
import { activityWeeks, MONTHS_SHORT, parseISO, todayKey, weeksToShow } from '../lib/date'
import { Confirm, Sheet } from '../components/ui'
import { DotNumber } from '../components/DotNumber'
import { hapticMedium } from '../lib/haptics'

/**
 * Last Done — jobs you do every so often rather than every day.
 *
 * Habits answer "did I do it today". This answers "when did I last do it",
 * which is a different question and wants a different screen: no streaks, no
 * grid of days, no sense that a gap is a failure. One number per job — how
 * long it has been — and a button that says you have just done it again.
 */

/* ------------------------------------------------------------------ *
 * The ink painting.
 *
 * Drawn, not shipped: paper grain from an SVG turbulence filter, the branch
 * and eave as paths, blossoms in the accent colour. It renders once and never
 * animates. Costs about a kilobyte and stays sharp on any screen, where the
 * reference JPEG would have been a few hundred.
 * ------------------------------------------------------------------ */

/** Five-petal plum blossom, as a transform-positioned group. */
function Blossom({ x, y, s, o = 1 }: { x: number; y: number; s: number; o?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={o}>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx="0" cy="-3.1" rx="2.3" ry="3.1" transform={`rotate(${a})`} />
      ))}
      <circle cx="0" cy="0" r="1.1" fill="var(--ink-ground)" />
    </g>
  )
}

function InkScene() {
  return (
    <div className="ink-paper" aria-hidden>
      <svg
        className="ink-art"
        viewBox="0 0 400 620"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {/* Real paper grain. fractalNoise at a high base frequency is the
              cheapest honest way to get tooth into a flat fill. */}
          <filter id="grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="4" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>

        <rect width="400" height="620" fill="var(--ink-ground)" />
        <rect width="400" height="620" filter="url(#grain)" opacity="0.09" style={{ mixBlendMode: 'screen' }} />

        {/* The branch, entering top-right and reaching left. Filled paths
            rather than strokes, so it tapers the way a loaded brush does. */}
        <g fill="var(--ink-line)">
          <path d="M400 74 L372 66 358 78 336 74 318 88 292 92 268 106 246 116 222 128 198 142 176 152 158 160 150 168 158 164 180 158 202 148 226 138 250 126 272 116 296 106 320 98 342 96 360 90 378 88 400 92 Z" />
          <path d="M286 96 L272 118 262 140 256 158 262 142 274 120 290 102 Z" />
          <path d="M232 124 L214 140 196 152 178 160 160 164 178 158 200 148 220 136 Z" />
          <path d="M198 142 L184 158 172 176 164 194 172 178 186 160 Z" />
          <path d="M336 76 L344 58 356 44 366 36 354 48 344 64 Z" />
        </g>

        {/* Blossoms along the branch. */}
        <g fill="var(--accent)">
          <Blossom x={318} y={92} s={1.15} />
          <Blossom x={296} y={104} s={0.9} />
          <Blossom x={262} y={116} s={1.2} />
          <Blossom x={238} y={126} s={0.85} />
          <Blossom x={206} y={146} s={1.1} />
          <Blossom x={182} y={156} s={0.95} />
          <Blossom x={166} y={182} s={1.05} />
          <Blossom x={256} y={152} s={0.8} />
          <Blossom x={172} y={172} s={0.7} o={0.85} />
        </g>

        {/* The hanging chime: a thread, a ribbed bell, a red tassel. */}
        <g stroke="var(--ink-line)" strokeWidth="1.2" fill="none">
          <path d="M228 132 V186" />
          <path d="M206 190 q22 -10 44 0 l-7 34 q-15 6 -30 0 Z" />
          <path d="M213 193 V222 M221 195 V225 M229 196 V226 M237 195 V225 M244 193 V222" strokeWidth="0.8" />
          <path d="M228 226 V252" strokeWidth="0.9" />
        </g>
        <path d="M219 252 h20 l-4 30 -6 -6 -6 8 Z" fill="var(--accent)" opacity="0.85" />

        {/* Petals falling away from the branch. */}
        <g fill="var(--accent)" opacity="0.75">
          <ellipse cx="162" cy="248" rx="3.4" ry="2.4" transform="rotate(-20 162 248)" />
          <ellipse cx="150" cy="276" rx="3" ry="2.1" transform="rotate(25 150 276)" />
          <ellipse cx="168" cy="300" rx="2.6" ry="1.9" transform="rotate(-40 168 300)" />
          <ellipse cx="132" cy="322" rx="2.2" ry="1.6" transform="rotate(15 132 322)" />
        </g>

        {/* The temple eave, bottom right. */}
        <g fill="none" stroke="var(--ink-line)" strokeWidth="3.4" strokeLinejoin="round">
          <path d="M232 470 q34 -34 78 -40 h150" />
          <path d="M232 470 q30 -12 78 -16 h150" />
          <path d="M244 492 h216 M244 508 h216" strokeWidth="2.4" />
          <path d="M266 508 V620" strokeWidth="2.8" />
        </g>
        {/* roof tiles: a row of half-round caps between the two ridge lines */}
        <g fill="none" stroke="var(--ink-line)" strokeWidth="1.6">
          {Array.from({ length: 12 }, (_, i) => 268 + i * 16).map((x) => (
            <path key={x} d={`M${x} 470 q6 -2 6 -12 M${x} 470 a6 6 0 0 1 12 0`} />
          ))}
        </g>
      </svg>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/** Whole days between two YYYY-MM-DD keys. */
function daysBetween(from: string, to: string): number {
  const a = parseISO(`${from}T12:00`).getTime()
  const b = parseISO(`${to}T12:00`).getTime()
  return Math.round((b - a) / 86400000)
}

export function LastDone({
  editing,
  onCloseEditor,
}: {
  editing: Chore | 'new' | null
  onCloseEditor: () => void
}) {
  const { db, logChore } = useStore()
  const [detail, setDetail] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const active = useMemo(
    () => db.chores.filter((c) => !c.archived).sort((a, b) => a.order - b.order),
    [db.chores],
  )

  /** Newest log date per chore. */
  const lastByChore = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of db.choreLogs) {
      const cur = m.get(l.choreId)
      if (!cur || l.date > cur) m.set(l.choreId, l.date)
    }
    return m
  }, [db.choreLogs])

  const today = todayKey()

  return (
    <div className="relative flex-1 overflow-hidden">
      <InkScene />
      <div className="relative h-full overflow-y-auto no-scrollbar pb-content px-3 pt-3">
        {active.map((c) => (
          <ChoreTile
            key={c.id}
            chore={c}
            last={lastByChore.get(c.id)}
            today={today}
            onDone={() => {
              hapticMedium()
              logChore(c.id, today)
            }}
            onOpen={() => setDetail(c.id)}
          />
        ))}

        {active.length > 0 && (
          <div className="text-[12px] px-1 pt-1" style={{ color: 'var(--muted)' }}>
            The number is how long it has been. Tap a card for its history.
          </div>
        )}

        {detail && (
          <ChoreDetail
            choreId={detail}
            onClose={() => setDetail(null)}
            onEdit={() => setEditingId(detail)}
          />
        )}

        {(editing || editingId) && (
          <ChoreEditor
            chore={
              editing === 'new'
                ? null
                : (editing ?? db.chores.find((c) => c.id === editingId) ?? null)
            }
            onClose={() => {
              setEditingId(null)
              onCloseEditor()
            }}
          />
        )}
      </div>
    </div>
  )
}

/** How many ticks the interval strip along the bottom is drawn with. */
const TICKS = 32

function ChoreTile({
  chore,
  last,
  today,
  onDone,
  onOpen,
}: {
  chore: Chore
  last?: string
  today: string
  onDone: () => void
  onOpen: () => void
}) {
  const since = last ? daysBetween(last, today) : undefined
  const doneToday = since === 0
  const overdue = since !== undefined && chore.everyDays !== undefined && since > chore.everyDays
  const due = since !== undefined && chore.everyDays !== undefined ? chore.everyDays - since : undefined

  // How far through the interval this job is. Undefined for a job with no
  // schedule — there is no "through" to be, and the strip stays unlit.
  const progress =
    since !== undefined && chore.everyDays
      ? Math.min(1, since / chore.everyDays)
      : undefined
  // Floor, not round: at 178 days of a 180-day job, rounding lit the last
  // tick and the strip claimed the time was up while the card still said
  // "due in 2d". Only a genuine 100% fills it.
  const litTicks = progress === undefined ? 0 : Math.floor(progress * TICKS)

  return (
    <div
      className={`chore-tile${overdue ? ' is-overdue' : ''}`}
      style={{ '--c': chore.color } as React.CSSProperties}
    >
      {/* The glow, in the card's own colour, thrown out behind everything.
          Its own layer so it can bleed past the content without the text
          picking up any of the blur. */}
      <span className="chore-glow" aria-hidden />

      <button className="chore-hit" onClick={onOpen} aria-label={`Open ${chore.name}`} />

      <div className="chore-head">
        <span className="chore-name">{chore.name}</span>
        <span className="chore-meta">
          {chore.everyDays ? `EVERY ${chore.everyDays}D` : 'NO SCHEDULE'}
        </span>
      </div>

      <div className="chore-body">
        <span className="chore-big">
          <DotNumber value={since === undefined ? '—' : since} cell={9} />
          <span className="chore-unit">
            {since === undefined
              ? 'never done'
              : since === 0
                ? 'today'
                : since === 1
                  ? 'day ago'
                  : 'days ago'}
          </span>
        </span>

        <button
          className="chore-do"
          data-done={doneToday || undefined}
          onClick={onDone}
          disabled={doneToday}
        >
          {doneToday ? 'Done' : 'Did it'}
        </button>
      </div>

      {/* The interval, as a strip: how far along you are between one time and
          the next. A job with no schedule has nothing to be along, so its
          strip stays dark rather than pretending to a deadline. */}
      <div className="chore-ticks" aria-hidden>
        {Array.from({ length: TICKS }, (_, i) => (
          <i key={i} data-on={i < litTicks || undefined} />
        ))}
      </div>

      <div className="chore-foot">
        {last ? `Last on ${last}` : 'No record yet'}
        {overdue && <b> · OVERDUE</b>}
        {!overdue && due !== undefined && due >= 0 && <span> · due in {due}d</span>}
      </div>
    </div>
  )
}


/**
 * Everything known about one job.
 *
 * The card answers "how long has it been". This answers the rest: how many
 * times, how often, and every date on record.
 *
 * A year of squares rather than a chart. The first version plotted the gap
 * between each time as bars, which was accurate and told you nothing you
 * could act on — for a job done four times a year it was four bars. A
 * calendar shows the same information as a shape you can read at a glance:
 * where the clusters are, where the empty stretches are, whether this year
 * looks like last year.
 */
function ChoreDetail({
  choreId,
  onClose,
  onEdit,
}: {
  choreId: string
  onClose: () => void
  onEdit: () => void
}) {
  const { db, logChore, removeChoreLog } = useStore()
  const chore = db.chores.find((c) => c.id === choreId)
  // Back to the first time this chore was actually logged, not a fixed
  // year of mostly empty columns — see Sleep.tsx's calendar for the same
  // reasoning.
  const grid = useMemo(() => {
    const earliest = db.choreLogs.reduce<string | undefined>(
      (min, l) => (l.choreId === choreId && (min === undefined || l.date < min) ? l.date : min),
      undefined,
    )
    return activityWeeks(weeksToShow(earliest))
  }, [db.choreLogs, choreId])
  const cal = useRef<HTMLDivElement>(null)

  // A year is wider than the sheet, and the interesting end is the recent
  // one — open on it rather than on last August.
  useEffect(() => {
    const el = cal.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [])

  const logs = useMemo(
    () =>
      db.choreLogs
        .filter((l) => l.choreId === choreId)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [db.choreLogs, choreId],
  )

  if (!chore) return null
  const today = todayKey()
  const done = new Set(logs.map((l) => l.date))

  const dates = logs.map((l) => l.date)
  const since = dates.length ? daysBetween(dates[0], today) : undefined

  // Gaps between consecutive times, for the average. Oldest pair first.
  const gaps: number[] = []
  for (let i = dates.length - 1; i > 0; i--) gaps.push(daysBetween(dates[i], dates[i - 1]))
  const average = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : undefined

  const stat = (value: string, label: string) => (
    <div className="ld-stat">
      <span className="ld-stat-v">{value}</span>
      <span className="ld-stat-l">{label}</span>
    </div>
  )

  return (
    <Sheet open onClose={onClose} title={chore.name}>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {stat(since === undefined ? '—' : String(since), since === 1 ? 'day ago' : 'days ago')}
          {stat(String(dates.length), dates.length === 1 ? 'time' : 'times')}
          {stat(average === undefined ? '—' : String(average), 'avg gap')}
        </div>

        {/* A year of days: one column per week, Sunday at the top. The month
            strip lives inside the same scroller as the squares, so the two
            cannot drift apart when it is scrolled sideways. */}
        <div className="ld-cal cal-glass" ref={cal}>
          <div className="ld-cal-inner">
            <div className="ld-months">
              {(() => {
                // Label the first week of each month, but only if it is far
                // enough from the last label to not collide with it — three
                // columns is about the width of "Sep".
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
                  {week.map((d) => (
                    <i
                      key={d}
                      data-on={done.has(d) || undefined}
                      data-today={d === today || undefined}
                      data-future={d > today || undefined}
                      style={done.has(d) ? { background: chore.color } : undefined}
                      title={d}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Every date on record, newest first, each one removable. */}
        <div>
          <div className="text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
            {dates.length ? 'Every time' : 'Nothing recorded yet'}
          </div>
          <div className="ld-dates">
            {logs.map((l) => (
              <div key={l.id} className="ld-date">
                <span className="num">{l.date}</span>
                <button
                  className="text-[12px] px-2"
                  style={{ color: 'var(--muted)' }}
                  onClick={() => removeChoreLog(l.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            className="flex-1 py-3 rounded-lg text-[14px] font-semibold"
            style={{ background: 'var(--surface-3)' }}
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            className="flex-1 py-3 rounded-lg text-white text-[14px] font-semibold"
            style={{ background: chore.color, opacity: since === 0 ? 0.5 : 1 }}
            disabled={since === 0}
            onClick={() => {
              hapticMedium()
              logChore(chore.id, today)
            }}
          >
            {since === 0 ? 'Done today' : 'Did it today'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

function ChoreEditor({ chore, onClose }: { chore: Chore | null; onClose: () => void }) {
  const { db, addChore, updateChore, deleteChore } = useStore()
  const [name, setName] = useState(chore?.name ?? '')
  const [subtitle, setSubtitle] = useState(chore?.subtitle ?? '')
  const [every, setEvery] = useState(chore?.everyDays ? String(chore.everyDays) : '')
  // Every new job takes the next colour along rather than all of them being
  // the same teal — the cards are meant to be told apart at a glance.
  const [color, setColor] = useState(
    chore?.color ?? CHART_COLORS[(db.chores.length * 5) % CHART_COLORS.length],
  )
  const [confirm, setConfirm] = useState(false)

  const save = () => {
    if (!name.trim()) return
    const n = parseInt(every, 10)
    const payload = {
      name: name.trim(),
      subtitle: subtitle.trim() || undefined,
      everyDays: isFinite(n) && n > 0 ? n : undefined,
      color,
    }
    if (chore) updateChore({ ...chore, ...payload })
    else addChore(payload)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={chore ? 'Edit' : 'New job'}>
      <div className="p-4 space-y-4">
        <input
          className="w-full border-b pb-2 text-[15px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="What is it? e.g. Service 3D printer"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <input
          className="w-full border-b pb-2 text-[14px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="Note (optional)"
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
        />

        <div className="flex items-center gap-3">
          <span className="text-[14px]">Every</span>
          <input
            className="w-20 border-b pb-1.5 text-[15px] text-center num"
            style={{ borderColor: 'var(--line)' }}
            inputMode="numeric"
            placeholder="—"
            value={every}
            onChange={(e) => setEvery(e.target.value.replace(/\D/g, ''))}
          />
          <span className="text-[14px]" style={{ color: 'var(--muted)' }}>
            days — leave empty if it has no schedule
          </span>
        </div>

        <div>
          <div className="text-[12px] mb-2" style={{ color: 'var(--muted)' }}>
            Colour
          </div>
          <div className="flex flex-wrap gap-2">
            {CHART_COLORS.map((c) => (
              <button
                key={c}
                className="w-8 h-8 rounded-full"
                style={{ background: c, outline: c === color ? '2px solid var(--text)' : 'none', outlineOffset: 2 }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          {chore && (
            <button
              className="flex-1 py-3 rounded-lg text-[14px]"
              style={{ background: 'var(--bg)', color: 'var(--expense)' }}
              onClick={() => setConfirm(true)}
            >
              Delete
            </button>
          )}
          <button
            className="flex-1 py-3 rounded-lg text-white text-[14px] font-semibold"
            style={{ background: 'var(--accent)' }}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>

      <Confirm
        open={confirm}
        title="Delete this job?"
        body="Its history will be deleted too."
        confirmLabel="Delete"
        danger
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          if (chore) deleteChore(chore.id)
          onClose()
        }}
      />
    </Sheet>
  )
}
