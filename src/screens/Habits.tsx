import { useEffect, useMemo, useRef, useState } from 'react'
import type { Habit, MoodDef } from '../types'
import { MOOD_COLOR_CHOICES } from '../types'
import { useStore } from '../store'
import { CHART_COLORS, uid } from '../lib/seed'
import { activityWeeks, dateToKey, dayLabel, GRAPH_RANGE_WEEKS, MONTHS_SHORT, parseISO, todayKey, weeksToShow, WEEKDAYS } from '../lib/date'
import { Confirm, EditLockButton, Sheet } from '../components/ui'
import { HoldConfirm } from '../components/HoldConfirm'
import { hapticLight, hapticMedium } from '../lib/haptics'
import { burst } from '../lib/fx'
import { Meter } from '../components/Meter'
import { HABIT_ICON_IDS, HABIT_ICON_LABEL, HabitIcon } from '../lib/habitIcons'
import { useCountUp } from '../lib/useCountUp'
import { useToast } from '../components/Toast'
import { fileToPhoto } from '../lib/photo'
import { cancelHabitReminders, ensureNotificationPermission, syncHabitReminders } from '../lib/notifications'

/** How many days each tile's dot row shows. */
const RECENT_DAYS = 14

/**
 * The card surfaces, in the order they are handed out.
 *
 * Every one of them is an infinite animation, and every one of them is idle
 * until the card is actually held — which is the whole reason they are
 * affordable. Six cards looping forever on a mid-range phone is heat and
 * battery for something nobody is looking at; six cards that come alive under
 * a thumb cost nothing the rest of the time.
 */
export const HABIT_SURFACES = [
  'dither',
  'lenticular',
  'specular',
  'foil',
  'metaball',
  'moire',
  'aurora',
  'grid',
] as const

/**
 * The night sky behind this tab.
 *
 * Drawn rather than shipped: a couple of hundred bytes of gradient instead of
 * a few hundred kilobytes of PNG, sharp at any screen size, and every colour
 * in it comes from `--accent`, so it follows the accent setting instead of
 * being frozen to one red.
 *
 * The stars are laid out by hand rather than randomly — a fixed arrangement
 * can be balanced, and it also means the sky does not reshuffle itself on
 * every render.
 */
const STARS: [x: number, y: number, r: number, rays: number][] = [
  [18, 12, 2.6, 0], [72, 20, 4.2, 26], [88, 9, 2.1, 0], [46, 33, 2.8, 12],
  [66, 41, 3.4, 0], [30, 52, 1.8, 0], [82, 58, 2.4, 0], [12, 68, 2.0, 0],
  [55, 72, 3.0, 14], [92, 78, 1.7, 0], [24, 88, 2.3, 0], [70, 94, 2.7, 0],
  [40, 104, 1.9, 0], [86, 112, 3.2, 18], [16, 120, 2.2, 0], [60, 130, 2.5, 0],
]

function HabitSky() {
  return (
    <div className="habit-sky" aria-hidden>
      <svg
        className="habit-stars"
        viewBox="0 0 100 160"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        {STARS.map(([x, y, r, rays], i) => (
          <g key={i} opacity={i % 4 === 0 ? 0.95 : 0.7}>
            {rays > 0 && (
              <>
                <path d={`M${x - rays} ${y}H${x + rays}`} stroke="currentColor" strokeWidth="0.35" />
                <path d={`M${x} ${y - rays}V${y + rays}`} stroke="currentColor" strokeWidth="0.35" />
              </>
            )}
            {/* a four-point sparkle: straight out to the tips, pinched at the waist */}
            <path
              d={`M${x} ${y - r} Q${x + r * 0.16} ${y - r * 0.16} ${x + r} ${y}
                  Q${x + r * 0.16} ${y + r * 0.16} ${x} ${y + r}
                  Q${x - r * 0.16} ${y + r * 0.16} ${x - r} ${y}
                  Q${x - r * 0.16} ${y - r * 0.16} ${x} ${y - r} Z`}
              fill="currentColor"
            />
          </g>
        ))}
      </svg>
    </div>
  )
}

export function Habits({ editing, onCloseEditor }: { editing: Habit | 'new' | null; onCloseEditor: () => void }) {
  const { db, toggleHabitLog } = useStore()
  const [detail, setDetail] = useState<Habit | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [moodOpen, setMoodOpen] = useState(false)

  const active = useMemo(
    () => db.habits.filter((h) => !h.archived).sort((a, b) => a.order - b.order),
    [db.habits],
  )

  const logsByHabit = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of db.habitLogs) {
      const s = m.get(l.habitId)
      if (s) s.add(l.date)
      else m.set(l.habitId, new Set([l.date]))
    }
    return m
  }, [db.habitLogs])

  const today = todayKey()
  // Carries the most recent entry forward until today gets its own — the
  // tile used to go back to "Tap to log how you're feeling today" the
  // moment midnight passed, even though nothing about how you're feeling
  // actually reset. An exact match for today still wins once you log one.
  const todaysMood = useMemo(() => {
    // Only days that actually carry a mood. A day can now exist with nothing
    // but a journal answer on it (see setMoodAnswer in store.tsx), and those
    // have `level: ''` — left unfiltered, writing one this morning would
    // blank this tile and break the carry-forward below, which is the whole
    // reason the tile shows the last mood rather than resetting at midnight.
    const rated = db.moodLogs.filter((m) => m.level)
    const exact = rated.find((m) => m.date === today)
    if (exact) return exact
    return [...rated].sort((a, b) => (a.date < b.date ? 1 : -1))[0]
  }, [db.moodLogs, today])

  const scroller = useRef<HTMLDivElement>(null)

  return (
    // The sky sits in a clipped wrapper alongside the scroller rather than
    // inside it, so it stays put while the tiles scroll over it.
    <div className="relative flex-1 overflow-hidden">
      <HabitSky />
      <div ref={scroller} className="relative h-full overflow-y-auto no-scrollbar pb-content px-3 pt-3">
        {/* Mood is the hero — the thing worth seeing first on opening the
            tab. There used to be a completion-count card here too ("2/4");
            it is gone outright rather than demoted, since a habit list that
            is pure journaling — did it or didn't, nothing scored — has
            nothing for a percentage to report. */}
        <MoodTile mood={todaysMood} moods={db.moods} onOpen={() => setMoodOpen(true)} />

        {active.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5 mt-2.5">
            {active.map((h) => (
              <HabitTile
                key={h.id}
                habit={h}
                index={active.indexOf(h)}
                logs={logsByHabit.get(h.id) ?? EMPTY_SET}
                onToggleToday={() => toggleHabitLog(h.id, today)}
                onOpenDetail={() => setDetail(h)}
              />
            ))}
          </div>
        )}

        {moodOpen && <MoodDetail onClose={() => setMoodOpen(false)} />}

        {detail && (
          <HabitDetail
            habitId={detail.id}
            onClose={() => setDetail(null)}
            onEdit={() => setEditingId(detail.id)}
          />
        )}

        {(editing || editingId) && (
          <HabitEditor
            habit={
              editing === 'new'
                ? null
                : (editing ?? db.habits.find((h) => h.id === editingId) ?? null)
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

const EMPTY_SET: Set<string> = new Set()

/** Days running up to today, oldest first. */
function recentDays(n: number): string[] {
  const out: string[] = []
  const base = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setDate(d.getDate() - i)
    out.push(dateToKey(d))
  }
  return out
}

/** The Sunday that starts the week containing `dateKey`. */
function startOfWeek(dateKey: string): string {
  const d = parseISO(dateKey + 'T12:00')
  d.setDate(d.getDate() - d.getDay())
  return dateToKey(d)
}

/**
 * Consecutive days done, up to and including today. Today not being ticked
 * yet does not break it — the day is not over — but a whole missed day does:
 * this is a real streak, not the gentler weeks-tolerant version tried
 * earlier. He asked for it back — a plain count of how many days running,
 * in days, not softened into weeks.
 */
function dayStreak(logs: Set<string>): number {
  const d = new Date()
  if (!logs.has(dateToKey(d))) d.setDate(d.getDate() - 1)
  let n = 0
  while (logs.has(dateToKey(d))) {
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}

/** The longest run of consecutive days ever, not just the current one —
 *  built for the one habit that gets its own extra stats (see
 *  MeditationStats below), where "best you've ever done" is worth showing
 *  alongside "how you're doing right now". */
function longestStreak(logs: Set<string>): number {
  const days = [...logs].sort()
  let best = 0
  let run = 0
  let prev: string | null = null
  for (const d of days) {
    if (prev) {
      const gapDays = Math.round(
        (parseISO(d + 'T00:00').getTime() - parseISO(prev + 'T00:00').getTime()) / 86400000,
      )
      run = gapDays === 1 ? run + 1 : 1
    } else {
      run = 1
    }
    best = Math.max(best, run)
    prev = d
  }
  return best
}

/** Days actually done out of the last `days` days, as a percentage —
 *  trailing rather than since-the-habit-began, so it reads the same "how
 *  am I doing lately" regardless of how old the habit is. */
function consistencyPct(logs: Set<string>, today: string, days: number): number {
  let done = 0
  const d = parseISO(today + 'T12:00')
  for (let i = 0; i < days; i++) {
    if (logs.has(dateToKey(d))) done++
    d.setDate(d.getDate() - 1)
  }
  return Math.round((done / days) * 100)
}

/**
 * The daily mood check-in — one word for the day, from a vocabulary built for
 * more than good-versus-bad (stressed, productive, successful, calm… — see
 * `MOOD_TAGS`). The wide card at the top, the thing worth seeing before
 * anything else on this tab.
 */
/** Looks a mood id up in the owner's own list — falls back to a plain
 *  muted dot and the id itself rather than crashing, for a log still
 *  pointing at a mood that's since been deleted. */
function moodDef(moods: MoodDef[], id?: string): MoodDef {
  return moods.find((m) => m.id === id) ?? { id: id ?? 'okay', label: id ?? '—', color: 'var(--muted)' }
}

function MoodTile({
  mood,
  moods,
  onOpen,
}: {
  mood?: { level: string; note?: string }
  moods: MoodDef[]
  onOpen: () => void
}) {
  const def = mood ? moodDef(moods, mood.level) : undefined
  const tone = def?.color ?? 'var(--accent)'
  return (
    <button
      className="habit-tile habit-tile-wide w-full text-left"
      style={{ '--c1': tone } as React.CSSProperties}
      onClick={onOpen}
    >
      <div className="flex-1 min-w-0">
        <div className="habit-tile-name">Mood</div>
        {mood && def ? (
          <>
            <div className="habit-mood-label">{def.label}</div>
            {mood.note && <div className="habit-mood-note">{mood.note}</div>}
          </>
        ) : (
          <div className="habit-mood-note" style={{ marginTop: 8 }}>
            Tap to log how you're feeling today
          </div>
        )}
      </div>
      {/* A planet, not a face — nothing in a nine-word vocabulary maps onto
          one mouth shape, and trying would flatten it back toward the
          good/bad scale this replaced. Each mood gets its own body instead:
          same colour it always had, but with an atmosphere and a surface,
          so the nine read as a set of worlds rather than nine paint chips. */}
      <div className="habit-mood-badge" data-mood={mood?.level} aria-hidden />
    </button>
  )
}

/** The Sunday that starts the week containing today — same rule the habit
 *  streak uses. */
function moodWeekTypical(logs: { date: string; level: string }[], moods: MoodDef[]): MoodDef | undefined {
  const start = startOfWeek(todayKey())
  const today = todayKey()
  const inWeek = logs.filter((m) => m.date >= start && m.date <= today)
  if (!inWeek.length) return undefined
  // The mode, not an average — these are words, not points on a line, so
  // there is nothing to average two of them into. Ties keep whichever the
  // owner's list happens to list first, which is arbitrary but at least
  // stable.
  const counts = new Map<string, number>()
  for (const m of inWeek) counts.set(m.level, (counts.get(m.level) ?? 0) + 1)
  let best: string | undefined
  let bestN = 0
  for (const m of moods) {
    const n = counts.get(m.id) ?? 0
    if (n > bestN) {
      best = m.id
      bestN = n
    }
  }
  return best ? moodDef(moods, best) : undefined
}

/**
 * The mood history: today's picker up top, a year of days coloured by mood
 * underneath — the "see all days" card he asked for.
 *
 * One entry per day, same shape as Sleep's night editor: tapping a past
 * square opens it for editing rather than only ever showing today.
 */
function MoodDetail({ onClose }: { onClose: () => void }) {
  const { db, setMood, removeMood, setMoodAnswer } = useStore()
  const [managing, setManaging] = useState(false)
  const prompts = useMemo(
    () => [...db.journalPrompts].sort((a, b) => a.order - b.order),
    [db.journalPrompts],
  )
  const [writtenOnly, setWrittenOnly] = useState(true)
  // Back to the first day actually logged, not a fixed year of mostly
  // empty columns — see Sleep.tsx's calendar for the same reasoning.
  const grid = useMemo(() => {
    const earliest = db.moodLogs.reduce<string | undefined>(
      (min, l) => (min === undefined || l.date < min ? l.date : min),
      undefined,
    )
    return activityWeeks(weeksToShow(earliest))
  }, [db.moodLogs])
  const cal = useRef<HTMLDivElement>(null)
  const today = todayKey()
  const [editing, setEditing] = useState(today)
  const [note, setNote] = useState('')

  useEffect(() => {
    const el = cal.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [])

  const byDate = useMemo(() => {
    const m = new Map<string, (typeof db.moodLogs)[number]>()
    for (const l of db.moodLogs) m.set(l.date, l)
    return m
  }, [db.moodLogs])

  const current = byDate.get(editing)

  // The note field tracks whichever day is open, so switching days does not
  // leave one day's half-typed note sitting in another day's box.
  useEffect(() => {
    setNote(current?.note ?? '')
  }, [editing, current])

  // Same lock Sleep's night editor uses: a day that already has a mood on
  // it opens view-only, so scrolling past the chip grid or catching one
  // with a stray tap can't quietly overwrite a real day's mood. A day with
  // nothing on it yet opens unlocked, since there's nothing there to
  // protect. Only resets on a genuine day switch — see Sleep.tsx's SleepDial
  // lock for the same reasoning on why `current` itself isn't a dependency.
  const [unlocked, setUnlocked] = useState(!current)
  useEffect(() => {
    setUnlocked(!byDate.get(editing))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const weekTypical = useMemo(() => moodWeekTypical(db.moodLogs, db.moods), [db.moodLogs, db.moods])

  const ratedCount = useMemo(() => db.moodLogs.filter((m) => m.level).length, [db.moodLogs])

  const journalEntries = useMemo(() => {
    const sorted = [...db.moodLogs].sort((a, b) => (a.date < b.date ? 1 : -1))
    if (!writtenOnly) return sorted
    return sorted.filter((l) => l.note || (l.answers && Object.keys(l.answers).length > 0))
  }, [db.moodLogs, writtenOnly])

  const stat = (value: string, label: string) => (
    <div className="ld-stat">
      <span className="ld-stat-v">{value}</span>
      <span className="ld-stat-l">{label}</span>
    </div>
  )

  return (
    <Sheet open onClose={onClose} title="Mood">
      <div className="p-4 space-y-4">
        <div className="relative flex items-center justify-center">
          <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
            {editing === today ? 'Today' : dayLabel(editing)}
          </div>
          {/* Only a day with a mood already on it has anything to protect —
              an empty day is already unlocked, so there is no button here. */}
          {current && (
            <div className="absolute right-0">
              <EditLockButton unlocked={unlocked} onClick={() => setUnlocked((u) => !u)} />
            </div>
          )}
        </div>

        <div className="habit-mood-grid">
          {db.moods.map((m) => (
            <button
              key={m.id}
              className="habit-mood-chip"
              data-on={current?.level === m.id || undefined}
              style={{ '--c': m.color } as React.CSSProperties}
              aria-pressed={current?.level === m.id}
              disabled={!unlocked}
              onClick={() => {
                hapticLight()
                setMood(editing, m.id, current?.note)
              }}
            >
              <span className="habit-mood-chip-dot" data-mood={m.id} aria-hidden />
              {m.label || '—'}
            </button>
          ))}
        </div>

        {/* Renaming a mood or adding one to the vocabulary — a different,
            lower-stakes action than logging a day, but gated behind the same
            lock rather than inventing a second one: reachable freely on an
            empty day, one tap away on a day that already has a mood set. */}
        {unlocked && (
          <button className="text-[12px]" style={{ color: 'var(--accent)' }} onClick={() => setManaging(true)}>
            + Add or rename moods
          </button>
        )}

        {/* The note only appears once a day has a mood on it — writing a
            note with nothing to attach it to is a memo, not a mood entry,
            and Niba already covers that. */}
        {current && (
          <input
            className="w-full border-b pb-2 text-[14px]"
            style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
            placeholder="What happened? (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note !== (current.note ?? '')) setMood(editing, current.level, note || undefined)
            }}
          />
        )}

        {/* The day's reflection. Unlike the note above these show whether or
            not a mood has been picked — some days the questions are the
            whole reason the sheet is open, and refusing to take an answer
            until a chip is tapped would throw away what was typed. */}
        {prompts.length > 0 && unlocked && (
          <div className="mood-prompts">
            {prompts.map((p) => (
              <PromptField
                key={p.id}
                question={p.question}
                value={current?.answers?.[p.id] ?? ''}
                onCommit={(text) => setMoodAnswer(editing, p.id, text)}
              />
            ))}
          </div>
        )}

        {/* Locked days still show what was written — read-only, so revisiting
            a week later is a scroll rather than an unlock. */}
        {prompts.length > 0 && !unlocked && current?.answers && (
          <div className="mood-prompts">
            {prompts
              .filter((p) => current.answers?.[p.id])
              .map((p) => (
                <div key={p.id} className="mood-prompt" data-read>
                  <div className="mood-prompt-q">{p.question}</div>
                  <div className="mood-prompt-a">{current.answers?.[p.id]}</div>
                </div>
              ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {/* Days with a mood on them, not rows in the table — an
              answers-only day is a journal entry, not a mood logged. */}
          {stat(String(ratedCount), ratedCount === 1 ? 'day logged' : 'days logged')}
          {stat(weekTypical?.label ?? '—', 'most this week')}
        </div>

        {/* Every day, in order, read straight down rather than hunted for
            one calendar square at a time — the calendar below is for seeing
            the shape of a month at a glance; this is for actually reading
            what was written. Tapping a line opens it the same way tapping
            its square does. */}
        {db.moodLogs.length > 0 && (
          <div>
            <div className="mood-journal-head-row">
              <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Journal
              </span>
              {/* A day with nothing but a mood chip on it is a data point,
                  not an entry worth re-reading. This filter is what makes
                  the list usable once there are months of both. */}
              <button
                className="mood-journal-filter"
                data-on={writtenOnly || undefined}
                onClick={() => setWrittenOnly((w) => !w)}
              >
                {writtenOnly ? 'Written only' : 'All days'}
              </button>
            </div>
            <div className="mood-journal">
              {journalEntries.length === 0 && (
                <div className="mood-journal-empty">
                  Nothing written yet — answer a question above and the day shows up here.
                </div>
              )}
              {journalEntries.map((log) => {
                const def = moodDef(db.moods, log.level)
                const written = prompts
                  .filter((p) => log.answers?.[p.id])
                  .map((p) => [p.question, log.answers![p.id]] as const)
                return (
                  <button
                    key={log.date}
                    className="mood-journal-row"
                    data-on={log.date === editing || undefined}
                    onClick={() => setEditing(log.date)}
                  >
                    {/* The mood's own colour, run down the edge of its
                        entry — a page of text needs something to tell one
                        day from the next at a glance, and the dot alone was
                        doing that job from inside the header row. */}
                    <span
                      className="mood-journal-edge"
                      style={{ background: log.level ? def.color : 'var(--line-strong)' }}
                      aria-hidden
                    />
                    <div className="mood-journal-head">
                      <span className="mood-journal-date">
                        {log.date === today ? 'Today' : dayLabel(log.date)}
                      </span>
                      {log.level && (
                        <span className="mood-journal-mood" style={{ color: def.color }}>
                          {def.label || '—'}
                        </span>
                      )}
                    </div>
                    {log.note && <div className="mood-journal-note">{log.note}</div>}
                    {written.map(([q, a]) => (
                      <div key={q} className="mood-journal-qa">
                        <div className="mood-journal-q">{q}</div>
                        <div className="mood-journal-a">{a}</div>
                      </div>
                    ))}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="ld-cal cal-glass" ref={cal}>
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
                    const log = byDate.get(d)
                    // A day with only a journal answer on it has no mood to
                    // colour a square with — filling it in the fallback grey
                    // would read as "logged a grey mood", which is not a
                    // thing. It still opens on tap like any other day.
                    const def = log?.level ? moodDef(db.moods, log.level) : undefined
                    return (
                      <i
                        key={d}
                        data-on={!!def || undefined}
                        data-today={d === today || undefined}
                        data-future={d > today || undefined}
                        style={def ? { background: def.color } : undefined}
                        title={def ? `${d} · ${def.label}` : d}
                        onClick={() => {
                          if (d > today) return
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

        {/* Same lock as the mood chips — deleting a whole day's entry is a
            bigger mistake than misclicking a mood, so it doesn't make sense
            to guard the small change and leave the irreversible one open. */}
        {current && unlocked && (
          <button
            className="w-full py-3 rounded-lg text-[14px]"
            style={{ background: 'var(--bg)', color: 'var(--expense)' }}
            onClick={() => {
              removeMood(current.id)
              setNote('')
            }}
          >
            Remove this day
          </button>
        )}
      </div>

      {managing && <MoodManager onClose={() => setManaging(false)} />}
    </Sheet>
  )
}

/**
 * One reflection question and its answer.
 *
 * Its own component so the draft state is per-question and keyed by the
 * field's position in the list — one shared `useState` in the parent would
 * need an object keyed by prompt id and a effect to reseed it on every day
 * switch. Committing on blur rather than per keystroke keeps a sentence
 * being typed from writing to storage thirty times.
 */
function PromptField({
  question,
  value,
  onCommit,
}: {
  question: string
  value: string
  onCommit: (text: string) => void
}) {
  const [draft, setDraft] = useState(value)
  // Reseeds when the day changes underneath it — `value` is the saved answer
  // for whichever date is open, so switching days has to replace the draft
  // rather than carry one day's half-typed answer onto another.
  useEffect(() => setDraft(value), [value])

  return (
    <label className="mood-prompt">
      <span className="mood-prompt-q">{question}</span>
      <textarea
        className="mood-prompt-input"
        rows={2}
        placeholder="…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft)
        }}
      />
    </label>
  )
}

/**
 * The mood vocabulary itself — renaming one of the built-in nine, adding a
 * new one, or dropping one that never gets used. A day already logged under
 * a deleted mood keeps its own colour and stays right where it is in the
 * calendar below; only the chip disappears from the picker going forward.
 */
function MoodManager({ onClose }: { onClose: () => void }) {
  const { db, addMood, updateMood, deleteMood } = useStore()
  const [confirmDel, setConfirmDel] = useState<MoodDef | null>(null)

  return (
    <Sheet open onClose={onClose} title="Edit moods">
      <div className="p-4 space-y-4">
        <div className="space-y-1.5">
          {db.moods.map((m) => (
            <MoodRow key={m.id} mood={m} onUpdate={updateMood} onDelete={() => setConfirmDel(m)} />
          ))}
        </div>
        <button
          className="w-full py-2.5 rounded-lg text-[13px]"
          style={{ border: '1.5px dashed var(--accent)', color: 'var(--accent)' }}
          onClick={() =>
            addMood({ label: '', color: MOOD_COLOR_CHOICES[db.moods.length % MOOD_COLOR_CHOICES.length] })
          }
        >
          + Add mood
        </button>
      </div>

      <Confirm
        open={!!confirmDel}
        title={`Delete "${confirmDel?.label || 'this mood'}"?`}
        body="Any day already logged with it keeps its colour in your history — only the chip itself goes away."
        confirmLabel="Delete"
        danger
        onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && deleteMood(confirmDel.id)}
      />
    </Sheet>
  )
}

/** One editable row — its own local label so a keystroke doesn't rewrite
 *  the store on every letter; committed on blur, same as the day note field
 *  above. The colour swatch expands into the same twelve choices `+ Add
 *  mood` cycles through, rather than a full colour wheel nobody asked for. */
function MoodRow({
  mood,
  onUpdate,
  onDelete,
}: {
  mood: MoodDef
  onUpdate: (m: MoodDef) => void
  onDelete: () => void
}) {
  const [label, setLabel] = useState(mood.label)
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <div className="rounded-lg" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center gap-2 pl-1.5 pr-1.5 py-1.5">
        <button
          className="w-7 h-7 rounded-full shrink-0"
          style={{ background: mood.color, border: '1.5px solid var(--line)' }}
          onClick={() => setPickerOpen((o) => !o)}
          aria-label={`Change colour for ${mood.label || 'this mood'}`}
        />
        <input
          className="flex-1 min-w-0 bg-transparent text-[14px]"
          placeholder="Mood name"
          value={label}
          // A freshly-added mood has nothing typed yet — this only ever
          // mounts once per id, so it cannot refire on a later keystroke.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={!mood.label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            const trimmed = label.trim()
            if (trimmed && trimmed !== mood.label) onUpdate({ ...mood, label: trimmed })
            else setLabel(mood.label)
          }}
        />
        <button
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[13px]"
          style={{ color: 'var(--muted)' }}
          onClick={onDelete}
          aria-label={`Delete ${mood.label || 'this mood'}`}
        >
          ✕
        </button>
      </div>
      {pickerOpen && (
        <div className="flex flex-wrap gap-2 px-3 pb-2.5">
          {MOOD_COLOR_CHOICES.map((c) => (
            <button
              key={c}
              className="w-7 h-7 rounded-full"
              style={{ background: c, border: c === mood.color ? '2px solid var(--text)' : '1.5px solid transparent' }}
              onClick={() => {
                onUpdate({ ...mood, color: c })
                setPickerOpen(false)
              }}
              aria-label={`Use ${c}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function HabitTile({
  habit,
  index,
  logs,
  onToggleToday,
  onOpenDetail,
}: {
  habit: Habit
  index: number
  logs: Set<string>
  onToggleToday: () => void
  onOpenDetail: () => void
}) {
  const today = todayKey()
  const doneToday = logs.has(today)
  const days = useMemo(() => recentDays(RECENT_DAYS), [])
  const streak = dayStreak(logs)
  const displayStreak = useCountUp(streak)
  const tick = useRef<HTMLButtonElement>(null)
  const tile = useRef<HTMLDivElement>(null)
  const [held, setHeld] = useState(false)
  const toast = useToast()

  // Unset surfaces are dealt out by position, so a set of habits is varied
  // before anyone has chosen anything.
  const surface = habit.surface ?? HABIT_SURFACES[index % HABIT_SURFACES.length]

  return (
    <div
      ref={tile}
      className="habit-tile"
      data-surface={surface}
      data-held={held || undefined}
      // Held, not hovered — there is no hover on a phone. pointercancel is
      // Android taking the gesture for a scroll, which must also end it.
      onPointerDown={() => setHeld(true)}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
      onPointerLeave={() => setHeld(false)}
      style={
        {
          '--c1': habit.color,
          '--c2': `color-mix(in srgb, ${habit.color} 35%, var(--accent))`,
        } as React.CSSProperties
      }
    >
      {/* The surface. Its own clipped layer so the tile itself can stay
          unclipped for the tick's particle burst. `custom` swaps the two
          throwaway animated layers for the owner's own photo — everything
          else about the tile (the darkening overlay so the name and streak
          stay legible over it, the same z-index) is unchanged. */}
      <span className="habit-fx" aria-hidden>
        {surface === 'custom' && habit.customSurfaceImage ? (
          <img className="habit-fx-custom" src={habit.customSurfaceImage} alt="" />
        ) : (
          <>
            <i />
            <b />
          </>
        )}
      </span>
      {/* Covers the tile so anywhere that is not the tick opens the habit.
          A button inside a button is invalid, hence the overlay. */}
      <button className="habit-hit" onClick={onOpenDetail} aria-label={`Open ${habit.name}`} />

      <div className="habit-tile-head">
        <span className="habit-tile-name-group">
          {habit.icon && (
            <span className="habit-tile-icon" aria-hidden>
              <HabitIcon id={habit.icon} size={15} />
            </span>
          )}
          <span className="habit-tile-name">{habit.name}</span>
        </span>
        <button
          ref={tick}
          className="habit-check fx-emit"
          data-done={doneToday || undefined}
          onClick={() => {
            // A metered habit's "done" is a number, not a tap — open the
            // meter instead of toggling blind.
            if (habit.unit) {
              onOpenDetail()
              return
            }
            // The burst and the card's own reaction only fire on the way
            // *on*. Unticking is a correction, and celebrating a correction
            // is noise.
            if (!doneToday) {
              toast.success(`${habit.name} done!`)
              if (tick.current) burst(tick.current, habit.color)
              if (
                tile.current &&
                !document.hidden &&
                !window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ) {
                // A quick settle rather than a loop — the burst already
                // carries the celebration; this is the card itself
                // acknowledging the tap landed, the way a real button gives
                // slightly underfoot.
                //
                // A CSS keyframe rather than the anime.js tween this used to
                // be: one transform-only animation the compositor owns, with
                // no library behind it. Removing the class and forcing a
                // reflow before re-adding is what lets it replay on a second
                // tap — without that the browser sees no change and the
                // animation never restarts.
                const el = tile.current
                el.classList.remove('is-tapped')
                void el.offsetWidth
                el.classList.add('is-tapped')
              }
            }
            onToggleToday()
          }}
          aria-pressed={doneToday}
          aria-label={
            habit.unit
              ? `Log ${habit.name}`
              : doneToday
                ? `Mark ${habit.name} not done today`
                : `Mark ${habit.name} done today`
          }
        >
          {/* A heart rather than a tick once it is done — the tick states a
              fact, the heart is the bit of the day worth having. It pops past
              its own size and settles back on a spring. */}
          <svg
            className="habit-heart"
            data-done={doneToday || undefined}
            width="15"
            height="15"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinejoin="round"
          >
            <path d="M12 20.3 4.7 13a4.6 4.6 0 0 1 6.5-6.5l.8.8.8-.8A4.6 4.6 0 0 1 19.3 13Z" />
          </svg>
        </button>
      </div>

      <div className="habit-big">
        {displayStreak}
        <span className="habit-unit">{streak === 1 ? 'day' : 'days'}</span>
      </div>

      <div className="habit-dots">
        {days.map((d) => (
          <i key={d} data-on={logs.has(d) || undefined} data-today={d === today || undefined} />
        ))}
      </div>
    </div>
  )
}


/**
 * Everything known about one habit: the same year-of-squares graph Last Done
 * uses, plus the weeks-unbroken streak spelled out as a number instead of
 * left for the tile's small print. Opened by tapping a tile — editing is one
 * button inside it now, rather than what tapping a tile did.
 */
function HabitDetail({
  habitId,
  onClose,
  onEdit,
}: {
  habitId: string
  onClose: () => void
  onEdit: () => void
}) {
  const { db, toggleHabitLog, setHabitAmount, updateSettings } = useStore()
  const habit = db.habits.find((h) => h.id === habitId)
  // The week/month views exist to make room for a number in each square —
  // a plain done/not-done habit has no number to show, so it always gets
  // the dense year view, the same as before this existed. Only a metered
  // habit gets a choice at all, defaulting to week: that's a metered
  // habit's whole point, seeing "yes, I did it, and this much" at a glance,
  // and the year view's squares are too small to hold that number at all.
  const range = habit?.unit ? (db.settings.habitGraphRange ?? 'week') : 'year'
  const grid = useMemo(() => activityWeeks(GRAPH_RANGE_WEEKS[range]), [range])
  const cal = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = cal.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [range])

  const entries = useMemo(
    () => db.habitLogs.filter((l) => l.habitId === habitId),
    [db.habitLogs, habitId],
  )
  const logs = useMemo(() => new Set(entries.map((l) => l.date)), [entries])
  const amountOf = (d: string) => entries.find((l) => l.date === d)?.amount

  if (!habit) return null
  const today = todayKey()
  const streak = dayStreak(logs)
  const todayAmount = entries.find((l) => l.date === today)?.amount ?? 0
  const weekStart = startOfWeek(today)
  const thisWeek = [...logs].filter((d) => d >= weekStart && d <= today).length
  const doneToday = logs.has(today)

  // The one habit that gets more than the others — an explicit toggle in
  // the editor now, rather than only ever inferred from the name. A habit
  // saved before that toggle existed has `meditation` as undefined, not
  // false, so it still falls back to the name check that used to be the
  // only way in — nothing already relying on being named "Meditate" quietly
  // loses its stats row.
  const isMeditation = habit.meditation ?? /meditat/i.test(habit.name)
  const amounts = entries.map((e) => e.amount).filter((a): a is number => a !== undefined)
  const avgAmount = amounts.length ? Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length) : 0
  const bestAmount = amounts.length ? Math.max(...amounts) : 0
  const monthKey = today.slice(0, 7)
  const thisMonthCount = [...logs].filter((d) => d.slice(0, 7) === monthKey).length
  const best = longestStreak(logs)
  const consistency = consistencyPct(logs, today, 30)

  const stat = (value: string, label: string) => (
    <div className="ld-stat">
      <span className="ld-stat-v">{value}</span>
      <span className="ld-stat-l">{label}</span>
    </div>
  )

  return (
    <Sheet open onClose={onClose} title={habit.name}>
      {/* Its own pane of glass, floating inside the sheet's own — asked for
          as its own card rather than as the sheet's background. See
          .glass-turb-card in index.css. */}
      <div className="glass-turb-card relative p-4 m-3 space-y-4">
        {/* Edit used to be a full-width button down with Mark/Done — equal
            billing with the thing you actually reach for most days. It is
            reached for rarely, so it is a small mark in the corner now,
            still there but not competing for the thumb. */}
        <button
          className="habit-edit-tab"
          onClick={onEdit}
          aria-label={`Edit ${habit.name}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </button>

        <div className="grid grid-cols-3 gap-2">
          {stat(String(streak), 'day streak')}
          {stat(String(logs.size), logs.size === 1 ? 'day total' : 'days total')}
          {stat(`${thisWeek}/7`, 'this week')}
        </div>

        {/* Meditate's own extra row — asked for by name, the one habit
            meant to feel as looked-after as Sleep. A metered habit (a
            number logged each day) gets its average and best session; a
            plain tick still gets more than the row above — its longest run
            ever, not just the current one, and how the last 30 days have
            actually gone. */}
        {isMeditation && (
          <div
            className="habit-meditation-stats"
            style={{ '--habit-glow': habit.color } as React.CSSProperties}
          >
            <div className="habit-meditation-label">Meditation</div>
            <div className="grid grid-cols-3 gap-2">
              {habit.unit && amounts.length > 0 ? (
                <>
                  {stat(`${avgAmount} ${habit.unit}`, 'average session')}
                  {stat(`${bestAmount} ${habit.unit}`, 'best session')}
                  {stat(`${consistency}%`, 'last 30 days')}
                </>
              ) : (
                <>
                  {stat(String(best), best === 1 ? 'best day ever' : 'best run ever')}
                  {stat(`${consistency}%`, 'last 30 days')}
                  {stat(String(thisMonthCount), 'this month')}
                </>
              )}
            </div>
          </div>
        )}

        {/* Only a metered habit has a number worth making room for — a
            plain done/not-done one always gets the dense year view below,
            same as it always did, with no toggle cluttering it up. */}
        {habit.unit && (
          <div className="flex gap-2">
            {(['week', 'month', 'year'] as const).map((r) => (
              <button
                key={r}
                className="px-3 py-1.5 rounded-full text-[12px] capitalize"
                style={{
                  background: r === range ? habit.color : 'var(--bg)',
                  color: r === range ? '#fff' : 'var(--muted)',
                }}
                onClick={() => updateSettings({ habitGraphRange: r })}
              >
                {r}
              </button>
            ))}
          </div>
        )}

        {range === 'week' ? (
          /* A single week reads as a row, not a lone column stranded in a
             box sized for a year's worth of them — same squares, laid out
             the way a week actually is. */
          <div className="ld-week-strip">
            {grid[0].map((d) => {
              const amount = amountOf(d)
              return (
                <div key={d} className="ld-week-strip-col">
                  <span className="ld-week-strip-label">{WEEKDAYS[parseISO(d + 'T00:00').getDay()]}</span>
                  <i
                    data-on={logs.has(d) || undefined}
                    data-today={d === today || undefined}
                    data-future={d > today || undefined}
                    style={logs.has(d) ? { background: habit.color } : undefined}
                    title={d}
                  >
                    {amount !== undefined ? amount : null}
                  </i>
                </div>
              )
            })}
          </div>
        ) : (
          /* One column per week, Sunday at the top. Same layout as Last
              Done's calendar, opened scrolled to the recent end. */
          <div className="ld-cal habit-cal" data-range={range} ref={cal}>
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
                      const amount = amountOf(d)
                      return (
                        <i
                          key={d}
                          data-on={logs.has(d) || undefined}
                          data-today={d === today || undefined}
                          data-future={d > today || undefined}
                          style={logs.has(d) ? { background: habit.color } : undefined}
                          title={d}
                        >
                          {/* Only where a square is actually big enough to
                              hold it — see the range toggle above. */}
                          {habit.unit && range === 'month' && amount !== undefined ? amount : null}
                        </i>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Metered habits get the dial instead of a plain tick — today's
            amount is a number, not a yes/no. */}
        {habit.unit && (
          <Meter
            value={todayAmount}
            max={habit.target ?? 1}
            unit={habit.unit}
            color={habit.color}
            onChange={(n) => {
              hapticLight()
              setHabitAmount(habit.id, today, n)
            }}
          />
        )}

        {!habit.unit && (
          <button
            className="w-full py-3 rounded-lg text-white text-[14px] font-semibold"
            style={{ background: habit.color, opacity: doneToday ? 0.5 : 1 }}
            disabled={doneToday}
            onClick={() => {
              hapticMedium()
              toggleHabitLog(habit.id, today)
            }}
          >
            {doneToday ? 'Done today' : 'Mark today done'}
          </button>
        )}
      </div>
    </Sheet>
  )
}

function HabitEditor({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const { addHabit, updateHabit, deleteHabit } = useStore()
  const [name, setName] = useState(habit?.name ?? '')
  const [subtitle, setSubtitle] = useState(habit?.subtitle ?? '')
  const [color, setColor] = useState(habit?.color ?? CHART_COLORS[0])
  const [icon, setIcon] = useState(habit?.icon ?? '')
  const [surface, setSurface] = useState<string | undefined>(habit?.surface)
  const [customSurfaceImage, setCustomSurfaceImage] = useState(habit?.customSurfaceImage)
  const [customBusy, setCustomBusy] = useState(false)
  const customFileRef = useRef<HTMLInputElement>(null)
  const [metered, setMetered] = useState(!!habit?.unit)
  const [unit, setUnit] = useState(habit?.unit ?? 'min')
  const [target, setTarget] = useState(String(habit?.target ?? 30))
  // A brand-new habit defaults from the name typed so far, same guess the
  // old name-only check made — but from here on it's a real switch, not a
  // spelling requirement, and it stops tracking the name the moment it's
  // been touched by hand (see the input below).
  const [meditation, setMeditation] = useState(habit?.meditation ?? /meditat/i.test(habit?.name ?? ''))
  const [meditationTouched, setMeditationTouched] = useState(!!habit)
  const [reminders, setReminders] = useState<string[]>(habit?.reminders ?? [])
  const [newReminderTime, setNewReminderTime] = useState('09:00')
  const toast = useToast()
  // A brand-new habit needs its id decided up front, not handed back by
  // addHabit — its reminders have to be scheduled against the same id the
  // habit is about to be saved under, in this same save() call.
  const habitId = useRef(habit?.id ?? uid()).current

  const save = () => {
    if (!name.trim()) return
    const targetNum = Math.max(1, Math.round(Number(target)) || 30)
    const payload = {
      name: name.trim(),
      subtitle: subtitle.trim() || undefined,
      icon,
      color,
      surface,
      customSurfaceImage,
      unit: metered ? unit.trim() || 'min' : undefined,
      target: metered ? targetNum : undefined,
      meditation,
      reminders: reminders.length ? reminders : undefined,
    }
    if (habit) updateHabit({ ...habit, ...payload })
    else addHabit({ ...payload, id: habitId })
    void syncHabitReminders({ id: habitId, name: payload.name, subtitle: payload.subtitle, reminders: payload.reminders })
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={habit ? 'Edit habit' : 'New habit'}>
      <div className="p-4 space-y-4">
        <div>
          <input
            className="w-full border-b pb-2 text-[15px]"
            style={{ borderColor: 'var(--line)' }}
            placeholder="Habit name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              // The live guess only runs until the switch below is touched
              // by hand — otherwise typing "Meditate" into the name would
              // silently flip a choice already made the other way.
              if (!meditationTouched) setMeditation(/meditat/i.test(e.target.value))
            }}
            autoFocus
          />
          <div className="text-[12px] mt-1.5" style={{ color: 'var(--muted)' }}>
            Type an emoji into the name if you want one — e.g. "🧘 Meditate".
          </div>
        </div>

        <input
          className="w-full border-b pb-2 text-[14px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="Subtitle (optional)"
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
        />

        <div>
          <div className="text-[12px] mb-2" style={{ color: 'var(--muted)' }}>
            Want a meter for this one? Something like meditation is a number
            you build up through the day, not a single tap.
          </div>
          <div className="flex gap-2">
            <button
              className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold"
              style={{
                background: !metered ? 'var(--accent)' : 'var(--bg)',
                color: !metered ? '#fff' : 'var(--text-2)',
              }}
              onClick={() => setMetered(false)}
            >
              No, just a tap
            </button>
            <button
              className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold"
              style={{
                background: metered ? 'var(--accent)' : 'var(--bg)',
                color: metered ? '#fff' : 'var(--text-2)',
              }}
              onClick={() => setMetered(true)}
            >
              Yes, a meter
            </button>
          </div>

          {metered && (
            <div className="flex gap-3 mt-3">
              <div className="flex-1">
                <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
                  Unit
                </div>
                <input
                  className="w-full border-b pb-2 text-[14px]"
                  style={{ borderColor: 'var(--line)' }}
                  placeholder="min"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
                  Target per day
                </div>
                <input
                  className="w-full border-b pb-2 text-[14px] num"
                  style={{ borderColor: 'var(--line)' }}
                  type="number"
                  inputMode="numeric"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </div>
            </div>
          )}
          {metered && (
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
              The dial fills up to the target — you can always type an exact
              amount past it too.
            </div>
          )}
        </div>

        <div>
          <div className="text-[12px] mb-2" style={{ color: 'var(--muted)' }}>
            Meditate's own extra row of stats — average and best session, or
            longest streak and last 30 days for a plain tick.
          </div>
          <button
            className="w-full py-2.5 rounded-lg text-[13px] font-semibold"
            style={{
              background: meditation ? 'var(--accent)' : 'var(--bg)',
              color: meditation ? '#fff' : 'var(--text-2)',
            }}
            onClick={() => {
              setMeditationTouched(true)
              setMeditation((m) => !m)
            }}
          >
            {meditation ? 'On for this habit' : 'Off for this habit'}
          </button>
        </div>

        <div>
          <div className="text-[12px] mb-2" style={{ color: 'var(--muted)' }}>
            Reminders — a nudge at each time below, every day. Good for
            something like medicine that needs a few separate taps rather
            than one at the end of the day.
          </div>
          {reminders.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {reminders.map((t, i) => (
                <span
                  key={t + i}
                  className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full text-[13px] num"
                  style={{ background: 'var(--bg)', color: 'var(--text)' }}
                >
                  {t}
                  <button
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[13px] leading-none"
                    style={{ color: 'var(--muted)' }}
                    aria-label={`Remove ${t} reminder`}
                    onClick={() => setReminders((r) => r.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="time"
              className="border-b pb-2 text-[14px] num"
              style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
              value={newReminderTime}
              onChange={(e) => setNewReminderTime(e.target.value)}
            />
            <button
              className="px-3 py-1.5 rounded-full text-[12px] font-semibold shrink-0"
              style={{ background: 'var(--bg)', color: 'var(--accent)' }}
              onClick={async () => {
                if (!newReminderTime || reminders.includes(newReminderTime)) return
                setReminders((r) => [...r, newReminderTime].sort())
                const granted = await ensureNotificationPermission()
                if (!granted) toast.error('Notifications are off for Kaithwas — turn them on to actually get this reminder')
              }}
            >
              + Add reminder
            </button>
          </div>
        </div>

        <div>
          <div className="text-[12px] mb-2" style={{ color: 'var(--muted)' }}>
            Color
          </div>
          <div className="flex flex-wrap gap-2">
            {CHART_COLORS.map((c) => (
              <button
                key={c}
                className="w-8 h-8 rounded-full"
                style={{
                  background: c,
                  outline: c === color ? '2px solid var(--text)' : 'none',
                  outlineOffset: 2,
                }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="text-[12px] mb-2" style={{ color: 'var(--muted)' }}>
            Icon (optional)
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold"
              style={{
                background: !icon ? 'var(--accent)' : 'var(--bg)',
                color: !icon ? '#fff' : 'var(--text-2)',
              }}
              onClick={() => setIcon('')}
              aria-label="No icon"
            >
              ✕
            </button>
            {HABIT_ICON_IDS.map((id) => (
              <button
                key={id}
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{
                  background: icon === id ? 'var(--accent)' : 'var(--bg)',
                  color: icon === id ? '#fff' : color,
                }}
                onClick={() => setIcon(id)}
                aria-label={HABIT_ICON_LABEL[id]}
                aria-pressed={icon === id}
              >
                <HabitIcon id={id} size={18} />
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[12px] mb-2" style={{ color: 'var(--muted)' }}>
            Card surface — press and hold a card to see it move
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="px-3 py-1.5 rounded-full text-[12px]"
              style={{
                background: surface === undefined ? 'var(--accent)' : 'var(--bg)',
                color: surface === undefined ? '#fff' : 'var(--text-2)',
              }}
              onClick={() => setSurface(undefined)}
            >
              Auto
            </button>
            {HABIT_SURFACES.map((sf) => (
              <button
                key={sf}
                className="px-3 py-1.5 rounded-full text-[12px] capitalize"
                style={{
                  background: surface === sf ? 'var(--accent)' : 'var(--bg)',
                  color: surface === sf ? '#fff' : 'var(--text-2)',
                }}
                onClick={() => setSurface(sf)}
              >
                {sf}
              </button>
            ))}
            {/* The one surface that isn't a built-in animated treatment —
                a photo from the gallery instead, for whoever gets bored of
                the eight on offer. Tapping it goes straight to the picker
                rather than selecting an empty state first; there is nothing
                to preview until a photo actually exists. */}
            <button
              className="px-3 py-1.5 rounded-full text-[12px] flex items-center gap-1.5"
              style={{
                background: surface === 'custom' ? 'var(--accent)' : 'var(--bg)',
                color: surface === 'custom' ? '#fff' : 'var(--text-2)',
              }}
              disabled={customBusy}
              onClick={() => customFileRef.current?.click()}
            >
              {customSurfaceImage && (
                <img src={customSurfaceImage} alt="" className="w-4 h-4 rounded-full object-cover" />
              )}
              {customBusy ? 'Loading…' : customSurfaceImage ? 'Custom' : 'Custom…'}
            </button>
            <input
              ref={customFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                setCustomBusy(true)
                try {
                  setCustomSurfaceImage(await fileToPhoto(file))
                  setSurface('custom')
                } catch {
                  /* an unreadable file just leaves the previous surface in place */
                } finally {
                  setCustomBusy(false)
                }
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          {habit && (
            <>
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                hold to delete — history goes too
              </span>
              <HoldConfirm
                label="Delete habit"
                onConfirm={() => {
                  deleteHabit(habit.id)
                  void cancelHabitReminders(habit.id)
                  onClose()
                }}
              />
            </>
          )}
          <span className="flex-1" />
          <button
            className="flex-1 py-3 rounded-lg text-white text-[14px] font-semibold"
            style={{ background: 'var(--accent)' }}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </Sheet>
  )
}
