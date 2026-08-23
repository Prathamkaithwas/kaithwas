import type { Settings } from '../types'

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** local-time ISO-ish key: YYYY-MM-DDTHH:mm */
export function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

export function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export function parseISO(iso: string): Date {
  const [datePart, timePart = '00:00'] = iso.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0)
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function todayMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Step a YYYY-MM-DD key by whole days, rolling over months and years. */
export function addDays(key: string, delta: number): string {
  const d = parseISO(key + 'T12:00')
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * "28 Jul" — the Daily header.
 *
 * Deliberately just the day and month. The weekday and the year were both
 * noise on a screen you are looking at several times a day: you already know
 * what year it is, and the header is a stepper, so which day it is is the
 * thing being changed rather than something to be told.
 */
export function dayLabel(key: string): string {
  const d = parseISO(key + 'T12:00')
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}

/**
 * Range of a "book month" honouring settings.monthStartDay.
 * With monthStartDay = 1 this is simply the calendar month.
 */
export function monthRange(
  month: string,
  monthStartDay: number,
): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number)
  if (monthStartDay <= 1) {
    return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) }
  }
  return {
    start: new Date(y, m - 1, monthStartDay),
    end: new Date(y, m, monthStartDay),
  }
}

export function inMonth(iso: string, month: string, monthStartDay: number): boolean {
  if (monthStartDay <= 1) return iso.slice(0, 7) === month
  const { start, end } = monthRange(month, monthStartDay)
  const d = parseISO(iso)
  return d >= start && d < end
}

export function formatDate(iso: string, s: Pick<Settings, 'dateFormat'>): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  switch (s.dateFormat) {
    case 'MM/DD/YYYY':
      return `${m}/${d}/${y}`
    case 'YYYY-MM-DD':
      return `${y}-${m}-${d}`
    default:
      return `${d}/${m}/${y}`
  }
}

export function formatDateLong(iso: string, s: Pick<Settings, 'dateFormat'>): string {
  const d = parseISO(iso)
  return `${formatDate(iso, s)} (${WEEKDAYS[d.getDay()]})`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-')
  return `${y}.${m}`
}

/** Cells for a calendar grid, always 6 rows of 7. */
export function calendarCells(month: string, firstDayOfWeek: 0 | 1): Date[] {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  let lead = first.getDay() - firstDayOfWeek
  if (lead < 0) lead += 7
  const start = new Date(y, m - 1, 1 - lead)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

export function dateToKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Whole days from today until an important date comes round.
 *
 * A yearly date is matched on month and day only: once this year's has gone
 * past, the answer is next year's, so a birthday never reads as overdue. Feb
 * 29 lands on Mar 1 in a common year, which is what `new Date(y, 1, 29)`
 * already does and is the behaviour most people expect from a reminder.
 *
 * A one-off returns a negative number once it is behind us, which is how the
 * list knows to move it to the past section rather than pretending it is
 * still coming.
 */
export function daysUntilDate(date: string, yearly: boolean, from: Date = new Date()): number {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const [y, m, d] = date.split('-').map(Number)
  let target = new Date(yearly ? today.getFullYear() : y, m - 1, d)
  if (yearly && target < today) target = new Date(today.getFullYear() + 1, m - 1, d)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

/** "in 3 days" / "today" / "tomorrow" / "12 days ago" */
export function relativeDayLabel(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

/**
 * How many weeks an activity grid should default to — back to the earliest
 * thing actually recorded, not a fixed year of mostly-empty columns.
 *
 * Floored at MIN_GRID_WEEKS rather than at one. The grid's columns stretch
 * to fill the card they sit in (see .ld-week) but stop growing at 26px, so
 * below roughly this many columns they hit that ceiling and the row ends
 * short, leaving dead space beside it. Filling the width is what the floor
 * buys; it is chosen to be the fewest columns that still reach the edge on
 * a phone, so it costs the least extra empty history to get there.
 *
 * Nothing pushes past a full year at the other end.
 */
const MIN_GRID_WEEKS = 18

export function weeksToShow(earliestKey: string | undefined): number {
  if (!earliestKey) return MIN_GRID_WEEKS
  const days = Math.floor((Date.now() - parseISO(earliestKey).getTime()) / 86400000)
  return Math.min(53, Math.max(MIN_GRID_WEEKS, Math.ceil(days / 7) + 1))
}

/** `count` weeks of Sundays-to-Saturdays ending with the week containing
 *  today — 53 (a year) unless told otherwise. */
export function activityWeeks(count = 53): string[][] {
  const end = new Date()
  // walk forward to the Saturday of this week so the last column is complete
  end.setDate(end.getDate() + (6 - end.getDay()))
  const weeks: string[][] = []
  for (let w = count - 1; w >= 0; w--) {
    const week: string[] = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(end)
      day.setDate(day.getDate() - (w * 7 + (6 - d)))
      week.push(dateToKey(day))
    }
    weeks.push(week)
  }
  return weeks
}

/** Weeks-per-column for each habit graph range — a week is just this week,
 *  a month a trailing ~5 weeks (not calendar-aligned; simpler and it's a
 *  rolling window either way), a year the full 53. */
export const GRAPH_RANGE_WEEKS: Record<'week' | 'month' | 'year', number> = {
  week: 1,
  month: 5,
  year: 53,
}

/** The next occurrence of `emiDay` on/after `from` — clamped to short months (e.g. 31 → 28/29/30). */
export function nextEmiDate(emiDay: number, from: Date = new Date()): Date {
  const y = from.getFullYear()
  const m = from.getMonth()
  const today = new Date(y, m, from.getDate())
  const clampedThisMonth = Math.min(emiDay, new Date(y, m + 1, 0).getDate())
  let target = new Date(y, m, clampedThisMonth)
  if (target < today) {
    const nm = m + 1
    const clampedNextMonth = Math.min(emiDay, new Date(y, nm + 1, 0).getDate())
    target = new Date(y, nm, clampedNextMonth)
  }
  return target
}

/** Whole days from `from` (defaults to today) until the next EMI due date. */
export function daysUntilEmi(emiDay: number, from: Date = new Date()): number {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const target = nextEmiDate(emiDay, from)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

/** Weeks (start/end dates) that overlap the given book month. */
export function weeksOfMonth(
  month: string,
  monthStartDay: number,
  firstDayOfWeek: 0 | 1,
): { start: Date; end: Date }[] {
  const { start, end } = monthRange(month, monthStartDay)
  const cursor = new Date(start)
  let lead = cursor.getDay() - firstDayOfWeek
  if (lead < 0) lead += 7
  cursor.setDate(cursor.getDate() - lead)

  const out: { start: Date; end: Date }[] = []
  while (cursor < end) {
    const wStart = new Date(cursor)
    const wEnd = new Date(cursor)
    wEnd.setDate(wEnd.getDate() + 6)
    out.push({ start: wStart, end: wEnd })
    cursor.setDate(cursor.getDate() + 7)
  }
  return out.reverse()
}

/** "01.07.26 ~ 31.07.26" */
export function shortRange(start: Date, end: Date): string {
  const f = (d: Date) =>
    `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`
  return `${f(start)} ~ ${f(end)}`
}

/** "26.07 ~ 01.08" */
export function weekLabel(start: Date, end: Date): string {
  const f = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`
  return `${f(start)} ~ ${f(end)}`
}

export function advance(iso: string, freq: string, interval: number): string {
  const d = parseISO(iso)
  switch (freq) {
    case 'daily':
      d.setDate(d.getDate() + interval)
      break
    case 'weekly':
      d.setDate(d.getDate() + 7 * interval)
      break
    case 'monthly':
      d.setMonth(d.getMonth() + interval)
      break
    case 'yearly':
      d.setFullYear(d.getFullYear() + interval)
      break
  }
  return toLocalISO(d)
}
