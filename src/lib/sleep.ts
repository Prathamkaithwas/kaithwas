import type { SleepLog } from '../types'
import { dateToKey, pad, parseISO } from './date'

/**
 * Sleep maths, in one place.
 *
 * All of it is about the same awkward fact: a night is not a day. It starts on
 * one date and ends on another, and the date a person files it under is
 * neither of those in every case.
 */

/** Minutes past midnight, from a local ISO timestamp. */
export function minutesOfDay(iso: string): number {
  const d = parseISO(iso)
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * The night a bedtime belongs to.
 *
 * A night is filed under the day you went to bed — Tuesday 23:30 is Tuesday
 * night. But a bedtime of 01:15 is calendar-Wednesday while still being
 * Tuesday night to the person in the bed, so anything before noon is pushed
 * back a day. Noon is the split because nobody's bedtime is midday, which
 * makes it the one hour of the clock this rule can never get wrong.
 */
export function nightKeyOf(start: string): string {
  const d = parseISO(start)
  if (d.getHours() < 12) d.setDate(d.getDate() - 1)
  return dateToKey(d)
}

/** How long a night was, in minutes. */
export function durationOf(log: Pick<SleepLog, 'start' | 'end'>): number {
  const ms = parseISO(log.end).getTime() - parseISO(log.start).getTime()
  return Math.max(0, Math.round(ms / 60000))
}

/** "07hr 30min" split into its parts, so each can be styled separately. */
export function hoursMinutes(minutes: number): { h: number; m: number } {
  return { h: Math.floor(minutes / 60), m: minutes % 60 }
}

/** "7h 30m" — the compact form, for stats and tooltips. */
export function shortDuration(minutes: number): string {
  const { h, m } = hoursMinutes(minutes)
  return m ? `${h}h ${m}m` : `${h}h`
}

/** "23:30" from a local ISO timestamp. */
export function clockOf(iso: string): string {
  const d = parseISO(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Build the two timestamps for a night filed under `nightKey`, given the two
 * times as minutes past midnight.
 *
 * Which calendar day each end lands on is worked out here rather than by the
 * caller, because it is the part that is easy to get wrong: a bedtime before
 * noon belongs to the *morning after* the night's date, and a wake-up is on
 * the following day whenever it is not later in the clock than the bedtime.
 */
export function timesToRange(
  nightKey: string,
  startMin: number,
  endMin: number,
): { start: string; end: string } {
  const base = parseISO(`${nightKey}T00:00`)

  const startDay = new Date(base)
  // Before noon means the sleep began after midnight, i.e. the next calendar
  // day — which is exactly the case nightKeyOf pushed back to get here.
  if (startMin < 12 * 60) startDay.setDate(startDay.getDate() + 1)

  const endDay = new Date(startDay)
  // Waking at or before the hour you went to bed can only mean the next day.
  if (endMin <= startMin) endDay.setDate(endDay.getDate() + 1)

  const stamp = (day: Date, mins: number) =>
    `${dateToKey(day)}T${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`

  return { start: stamp(startDay, startMin), end: stamp(endDay, endMin) }
}

/** Average minutes slept over the most recent `n` nights on record. */
export function recentAverage(logs: SleepLog[], n: number): number | undefined {
  const recent = [...logs].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, n)
  if (!recent.length) return undefined
  return Math.round(recent.reduce((sum, l) => sum + durationOf(l), 0) / recent.length)
}
