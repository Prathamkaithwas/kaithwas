/**
 * The Partner Journal's reasoning: cycle estimates, patterns, and the
 * prompts behind "Surprise Me".
 *
 * Everything here is a pure function over records the owner typed in
 * himself. Nothing reads a message, a call log, a location or a calendar,
 * and there is no model and no network — the whole engine is arithmetic over
 * `PartnerRecord[]`, which is what makes it honest enough to show her.
 *
 * Three kinds of statement, kept apart on purpose and labelled that way in
 * the UI:
 *
 *   FACT       something recorded directly. "Her birthday is 4 March."
 *   PATTERN    counted across several records. "Italian food, 3 times."
 *   PREDICTION an estimate about the future, always with its confidence and
 *              always hedged in words.
 *
 * The rule the whole file is written to: never state as known something that
 * was inferred. A wrong guess presented confidently is worse here than
 * saying nothing, because the point of the feature is that he actually knows
 * her — not that an app told him something plausible.
 */
import type {
  PartnerCycle,
  PartnerDate,
  PartnerGift,
  PartnerItem,
  PartnerJournalEntry,
  PartnerKind,
  PartnerPlain,
  PartnerPreference,
  PartnerSymptom,
  PartnerWant,
} from '../types'

/** A decrypted record, still carrying the envelope's bookkeeping fields. */
export interface PartnerRecord<T extends PartnerPlain = PartnerPlain> {
  id: string
  kind: PartnerKind
  order: number
  data: T
}

export type Confidence = 'low' | 'medium' | 'high'

/* ------------------------------------------------------------------ dates */

const DAY = 86_400_000

/** Both are YYYY-MM-DD. Parsed as UTC midnight so a timezone with a DST
 *  shift in the middle of a cycle cannot bend a day count by one. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
}

/* ----------------------------------------------------------- record split */

export function byKind<T extends PartnerPlain>(
  records: PartnerRecord[],
  kind: PartnerKind,
): PartnerRecord<T>[] {
  return records.filter((r) => r.kind === kind) as PartnerRecord<T>[]
}

/* ------------------------------------------------------------ cycle model */

/**
 * How long the luteal phase runs, in days.
 *
 * The one constant the estimate leans on, and the reason it can say anything
 * useful from few cycles. Cycle length varies mostly in the *first* half —
 * the stretch from ovulation to the next period is far steadier across
 * people and across months. So ovulation is estimated backwards from the
 * predicted next start rather than forwards from the last one, which is both
 * the standard simple model and the one that degrades most gracefully when
 * her cycles are irregular.
 *
 * It is an average, not a law. Everything derived from it is labelled
 * estimated.
 */
const LUTEAL_DAYS = 14

/** Default bleed length when a cycle has no recorded end. */
const DEFAULT_PERIOD_DAYS = 5

/** Gaps outside this are treated as a missed observation rather than a real
 *  cycle — a 90-day gap almost always means a period nobody wrote down, and
 *  folding it in as one cycle would wreck the median. */
const MIN_GAP = 15
const MAX_GAP = 60

/** How much each certainty level is trusted, for weighting confidence. */
const CERTAINTY_WEIGHT: Record<PartnerCycle['certainty'], number> = {
  exact: 1,
  about: 0.7,
  guess: 0.4,
}

export interface CycleGap {
  from: string
  to: string
  days: number
  /** Lowest certainty of the two observations the gap was measured between —
   *  a gap is only as trustworthy as its shakier end. */
  weight: number
}

export interface CycleStats {
  cycles: PartnerRecord<PartnerCycle>[]
  /** Start-to-start gaps that passed the plausibility filter. */
  gaps: CycleGap[]
  /** Gaps that were dropped, so the UI can say so rather than hide it. */
  skipped: number
  medianLength: number | null
  averageLength: number | null
  /** Mean absolute deviation from the median, in days. Plain-spoken spread —
   *  "usually within N days" — rather than a standard deviation nobody can
   *  picture. */
  spread: number | null
  periodDays: number
  lastStart: string | null
}

export function cycleStats(records: PartnerRecord[]): CycleStats {
  const cycles = byKind<PartnerCycle>(records, 'cycle')
    .slice()
    .sort((a, b) => a.data.startDate.localeCompare(b.data.startDate))

  const gaps: CycleGap[] = []
  let skipped = 0
  for (let i = 1; i < cycles.length; i++) {
    const from = cycles[i - 1].data
    const to = cycles[i].data
    const days = daysBetween(from.startDate, to.startDate)
    if (days < MIN_GAP || days > MAX_GAP) {
      skipped++
      continue
    }
    gaps.push({
      from: from.startDate,
      to: to.startDate,
      days,
      weight: Math.min(CERTAINTY_WEIGHT[from.certainty], CERTAINTY_WEIGHT[to.certainty]),
    })
  }

  const lengths = gaps.map((g) => g.days).sort((a, b) => a - b)
  const medianLength = lengths.length
    ? lengths.length % 2
      ? lengths[(lengths.length - 1) / 2]
      : Math.round((lengths[lengths.length / 2 - 1] + lengths[lengths.length / 2]) / 2)
    : null
  const averageLength = lengths.length
    ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
    : null
  const spread =
    medianLength !== null && lengths.length
      ? Math.round(
          (lengths.reduce((a, b) => a + Math.abs(b - medianLength), 0) / lengths.length) * 10,
        ) / 10
      : null

  // Recorded bleed lengths, when she gave an end date. Falls back to a
  // typical five days rather than pretending to know.
  const bleeds = cycles
    .map((c) => (c.data.endDate ? daysBetween(c.data.startDate, c.data.endDate) + 1 : null))
    .filter((n): n is number => n !== null && n > 0 && n < 15)
  const periodDays = bleeds.length
    ? Math.round(bleeds.reduce((a, b) => a + b, 0) / bleeds.length)
    : DEFAULT_PERIOD_DAYS

  return {
    cycles,
    gaps,
    skipped,
    medianLength,
    averageLength,
    spread,
    periodDays,
    lastStart: cycles.length ? cycles[cycles.length - 1].data.startDate : null,
  }
}

export type CyclePhase = 'period' | 'follicular' | 'ovulation' | 'luteal' | 'late' | 'unknown'

export const PHASE_LABEL: Record<CyclePhase, string> = {
  period: 'Period',
  follicular: 'Follicular',
  ovulation: 'Around ovulation',
  luteal: 'Luteal',
  late: 'Later than usual',
  unknown: 'Not enough recorded yet',
}

/** What each phase tends to mean for how she might be feeling. Written as
 *  tendencies, never as claims about her specifically — he still has to look
 *  at her, and the copy says so. */
export const PHASE_NOTE: Record<CyclePhase, string> = {
  period: 'Comfort, warmth, and no big plans tend to land well.',
  follicular: 'Energy usually climbs through this stretch.',
  ovulation: 'Often the most social, highest-energy days.',
  luteal: 'Energy often dips towards the end. Patience is the gift here.',
  late: 'Later than her usual pattern. Could be nothing — cycles move.',
  unknown: 'Record a few periods and an estimate will appear here.',
}

export interface CyclePrediction {
  stats: CycleStats
  /** 1-based day of the current cycle, or null with nothing to count from. */
  currentDay: number | null
  phase: CyclePhase
  nextStart: string | null
  /** Plus or minus, in days — the honest width of `nextStart`. */
  nextStartWindow: number | null
  daysUntilNext: number | null
  estimatedOvulation: string | null
  /** 0..1 */
  confidence: number
  confidenceLabel: Confidence
  /** Every reason the confidence is what it is, in plain words, so the
   *  number is never just asserted at him. */
  reasons: string[]
  basedOn: number
}

/**
 * The estimate, and an honest account of how much to trust it.
 *
 * Confidence is deliberately a product of four things that can each only
 * pull it *down*, starting from a ceiling set by how many cycles exist:
 *
 *   evidence   two cycles is a guess, six is a pattern
 *   spread     regular cycles predict well, scattered ones do not
 *   certainty  "she told me it started today" beats "sometime last week"
 *   freshness  an estimate drifts the further past the due date it gets
 *
 * There is no tuning here beyond making each term obvious, because a
 * confidence number that cannot be explained is worse than none.
 */
export function predictCycle(records: PartnerRecord[], today: string): CyclePrediction {
  const stats = cycleStats(records)
  const { medianLength, lastStart, gaps, spread, periodDays } = stats

  const base: CyclePrediction = {
    stats,
    currentDay: null,
    phase: 'unknown',
    nextStart: null,
    nextStartWindow: null,
    daysUntilNext: null,
    estimatedOvulation: null,
    confidence: 0,
    confidenceLabel: 'low',
    reasons: [],
    basedOn: gaps.length,
  }

  if (!lastStart) return base

  const currentDay = daysBetween(lastStart, today) + 1
  // A "current day" in the hundreds means the log simply stopped, not that
  // she is 200 days into a cycle. Say nothing rather than something absurd.
  if (currentDay < 1 || currentDay > 120) {
    return { ...base, currentDay: currentDay >= 1 ? currentDay : null }
  }
  if (medianLength === null) {
    // One period recorded. Enough to count days, not enough to predict.
    return {
      ...base,
      currentDay,
      phase: currentDay <= periodDays ? 'period' : 'unknown',
      reasons: ['Only one period recorded — no gap to measure a cycle from yet.'],
    }
  }

  const nextStart = addDays(lastStart, medianLength)
  const daysUntilNext = daysBetween(today, nextStart)
  const estimatedOvulation = addDays(nextStart, -LUTEAL_DAYS)
  const ovulationDay = medianLength - LUTEAL_DAYS

  let phase: CyclePhase
  if (currentDay <= periodDays) phase = 'period'
  else if (currentDay > medianLength + 2) phase = 'late'
  else if (Math.abs(currentDay - ovulationDay) <= 1) phase = 'ovulation'
  else if (currentDay < ovulationDay) phase = 'follicular'
  else phase = 'luteal'

  // ---- confidence, term by term ----
  const reasons: string[] = []

  // Evidence. Saturating, so the sixth cycle helps less than the second.
  const evidence = Math.min(1, gaps.length / 6)
  reasons.push(
    gaps.length === 1
      ? 'Based on a single recorded gap between periods.'
      : `Based on ${gaps.length} recorded cycles.`,
  )

  // Regularity. A spread of 0-1 days is as good as it gets; the further
  // apart her cycles run, the less the median predicts.
  //
  // The divisor and the floor are both deliberately gentle. Tuned tighter
  // (÷7, floor 0.15) a perfectly ordinary irregular cycle — six days of
  // spread, which is common and not a problem — scored 6%, and a number
  // that low reads as "this feature is broken" rather than "be careful with
  // this". It should be humble, not useless.
  const regularity = spread === null ? 0.5 : Math.max(0.3, 1 - spread / 10)
  if (spread !== null) {
    reasons.push(
      spread <= 1.5
        ? `Her cycles have been regular — usually within ${spread} days of ${medianLength}.`
        : `Her cycles vary by about ${spread} days, so this is a rough window.`,
    )
  }

  // Certainty of the observations actually used.
  const certainty = gaps.length
    ? gaps.reduce((a, g) => a + g.weight, 0) / gaps.length
    : 0.5
  if (certainty < 0.8) {
    reasons.push('Some periods were recorded as approximate, which widens the estimate.')
  }

  // Freshness. Past the due date the model is extrapolating.
  const overdue = Math.max(0, -daysUntilNext)
  const freshness = overdue === 0 ? 1 : Math.max(0.3, 1 - overdue / 14)
  if (overdue > 2) {
    reasons.push(`Her period is ${overdue} days past the usual point, so this is less certain.`)
  }

  const confidence = Math.round(evidence * regularity * certainty * freshness * 100) / 100
  const confidenceLabel: Confidence = confidence >= 0.66 ? 'high' : confidence >= 0.4 ? 'medium' : 'low'

  // The window widens with the spread and with how little evidence there is.
  const nextStartWindow = Math.max(1, Math.round((spread ?? 3) + (gaps.length < 3 ? 2 : 0)))

  return {
    stats,
    currentDay,
    phase,
    nextStart,
    nextStartWindow,
    daysUntilNext,
    estimatedOvulation,
    confidence,
    confidenceLabel,
    reasons,
    basedOn: gaps.length,
  }
}

/* --------------------------------------------------------------- patterns */

export type InsightKind = 'fact' | 'pattern' | 'prediction'

export interface Insight {
  id: string
  kind: InsightKind
  text: string
  /** Ids of the records this was counted from, so the UI can show its
   *  working instead of asking to be believed. */
  from: string[]
  /** Sorting weight — how worth surfacing this is right now. */
  weight: number
}

/** Words too common to be a preference. Kept small and obvious rather than a
 *  real stopword list; this only has to stop "the" being a favourite. */
const STOP = new Set([
  'the', 'and', 'for', 'that', 'with', 'she', 'her', 'was', 'has', 'had', 'she\'s',
  'this', 'from', 'they', 'have', 'been', 'want', 'wants', 'wanted', 'said', 'says',
  'about', 'would', 'could', 'really', 'very', 'just', 'like', 'likes', 'liked',
  'some', 'more', 'when', 'then', 'them', 'than', 'into', 'your', 'you', 'our',
])

function terms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOP.has(w)),
    ),
  ]
}

/** Text worth counting words from, per record kind. */
function searchableText(r: PartnerRecord): string {
  const d = r.data as unknown as Record<string, unknown>
  const parts = [
    d.item, d.value, d.category, d.text, d.label, d.observed, d.notes, d.reaction, d.occasion,
  ]
  return parts
    .flatMap((p) => (Array.isArray(p) ? p : [p]))
    .filter((p): p is string => typeof p === 'string')
    .join(' ')
}

/**
 * Everything the app can say, ranked.
 *
 * Each rule counts something already written down. None of them guess at a
 * cause, and none of them speak about her mood or her body from anything but
 * her own recorded observations.
 */
export function buildInsights(
  records: PartnerRecord[],
  today: string,
  prediction: CyclePrediction,
): Insight[] {
  const out: Insight[] = []
  const wants = byKind<PartnerWant>(records, 'want')
  const gifts = byKind<PartnerGift>(records, 'gift')
  const prefs = byKind<PartnerPreference>(records, 'preference')
  const dates = byKind<PartnerDate>(records, 'date')
  const journal = byKind<PartnerJournalEntry>(records, 'journal')
  const symptoms = byKind<PartnerSymptom>(records, 'symptom')

  // ---- FACT: dates coming up ----
  for (const d of dates) {
    const away = daysUntilAnnual(d.data.date, today, d.data.recurring !== false)
    if (away !== null && away <= 45) {
      out.push({
        id: `date-${d.id}`,
        kind: 'fact',
        text:
          away === 0
            ? `${d.data.label} is today.`
            : away === 1
              ? `${d.data.label} is tomorrow.`
              : `${d.data.label} is in ${away} days.`,
        from: [d.id],
        // The closer it is, the louder — and today is the loudest thing here.
        weight: 100 - away * 2,
      })
    }
  }

  // ---- FACT: wants still unfulfilled, aged ----
  for (const w of wants) {
    if (w.data.fulfilled) continue
    const age = daysBetween(w.data.dateMentioned, today)
    if (age < 0) continue
    out.push({
      id: `want-${w.id}`,
      kind: 'fact',
      text:
        age === 0
          // Quoted rather than folded into a sentence: quick capture saves
          // whatever was typed, which is often already a full sentence
          // ("She said she really wants..."), and prefixing that produced
          // "She mentioned She said she really wants...".
          ? `"${w.data.item}" — mentioned today.`
          : `"${w.data.item}" — mentioned ${age} day${age === 1 ? '' : 's'} ago.`,
      from: [w.id],
      // Old enough to be forgotten, not so old it is stale.
      weight: 30 + Math.min(age, 60) * 0.5 + (w.data.priority === 'high' ? 20 : 0),
    })
  }

  // ---- PATTERN: something mentioned repeatedly ----
  const counts = new Map<string, string[]>()
  for (const r of records) {
    if (r.kind === 'cycle' || r.kind === 'profile') continue
    for (const t of terms(searchableText(r))) {
      const list = counts.get(t) ?? []
      list.push(r.id)
      counts.set(t, list)
    }
  }
  for (const [term, ids] of counts) {
    if (ids.length < 3) continue
    out.push({
      id: `term-${term}`,
      kind: 'pattern',
      text: `You have written down "${term}" ${ids.length} times.`,
      from: ids,
      weight: 25 + ids.length * 4,
    })
  }

  // ---- PATTERN: gifts that landed ----
  const liked = gifts.filter((g) => g.data.status === 'given' && g.data.liked)
  if (liked.length >= 2) {
    const cats = new Map<string, string[]>()
    for (const g of liked) {
      const key = (g.data.occasion || g.data.item).toLowerCase()
      cats.set(key, [...(cats.get(key) ?? []), g.id])
    }
    for (const [key, ids] of cats) {
      if (ids.length < 2) continue
      out.push({
        id: `gift-${key}`,
        kind: 'pattern',
        text: `${key} — she liked it ${ids.length} times.`,
        from: ids,
        weight: 40 + ids.length * 5,
      })
    }
  }

  // ---- FACT: gift ideas going unused ----
  const ideas = gifts.filter((g) => g.data.status === 'idea')
  if (ideas.length) {
    out.push({
      id: 'gift-ideas',
      kind: 'fact',
      text: `You have ${ideas.length} gift idea${ideas.length === 1 ? '' : 's'} saved and not used.`,
      from: ideas.map((g) => g.id),
      weight: 35,
    })
  }

  // ---- PATTERN: symptoms recurring at this point of the cycle ----
  if (prediction.currentDay !== null && prediction.stats.medianLength) {
    const near = new Map<string, string[]>()
    for (const s of symptoms) {
      const day = cycleDayOf(s.data.date, prediction.stats)
      if (day === null || Math.abs(day - prediction.currentDay) > 2) continue
      for (const obs of s.data.observed) {
        near.set(obs.toLowerCase(), [...(near.get(obs.toLowerCase()) ?? []), s.id])
      }
    }
    for (const [obs, ids] of near) {
      if (ids.length < 2) continue
      out.push({
        id: `sym-${obs}`,
        kind: 'pattern',
        text: `You have noted "${obs}" around this point of her cycle ${ids.length} times before.`,
        from: ids,
        weight: 45 + ids.length * 3,
      })
    }
  }

  // ---- PREDICTION: the cycle estimate, if it is worth stating ----
  if (prediction.nextStart && prediction.daysUntilNext !== null && prediction.confidence >= 0.25) {
    const d = prediction.daysUntilNext
    out.push({
      id: 'cycle-next',
      kind: 'prediction',
      text:
        d < 0
          ? `Her period is estimated to have been due about ${-d} day${-d === 1 ? '' : 's'} ago.`
          : d === 0
            ? 'Her period is estimated to be due around today.'
            : `Her period is estimated to be due in about ${d} day${d === 1 ? '' : 's'}.`,
      from: prediction.stats.cycles.map((c) => c.id),
      weight: 55 - Math.min(Math.abs(d), 20),
    })
  }

  // ---- FACT: a memory worth revisiting ----
  const old = journal
    .filter((j) => daysBetween(j.data.date, today) >= 180)
    .sort((a, b) => a.data.date.localeCompare(b.data.date))
  if (old.length) {
    const pick = old[Math.floor(old.length / 2)]
    out.push({
      id: `memory-${pick.id}`,
      kind: 'fact',
      text: `From ${pick.data.date}: ${truncate(pick.data.text, 90)}`,
      from: [pick.id],
      weight: 20,
    })
  }

  // ---- PATTERN: favourites she has more than one note about ----
  const byCategory = new Map<string, string[]>()
  for (const p of prefs) {
    const k = p.data.category.toLowerCase()
    byCategory.set(k, [...(byCategory.get(k) ?? []), p.id])
  }
  for (const [cat, ids] of byCategory) {
    if (ids.length < 3) continue
    out.push({
      id: `pref-${cat}`,
      kind: 'pattern',
      text: `You have recorded ${ids.length} things about her ${cat}.`,
      from: ids,
      weight: 18 + ids.length,
    })
  }

  return out.sort((a, b) => b.weight - a.weight)
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`
}

/** Which day of which cycle a date falls on, or null if it sits outside all
 *  of them. */
export function cycleDayOf(date: string, stats: CycleStats): number | null {
  for (let i = stats.cycles.length - 1; i >= 0; i--) {
    const start = stats.cycles[i].data.startDate
    if (date < start) continue
    const day = daysBetween(start, date) + 1
    return day >= 1 && day <= 60 ? day : null
  }
  return null
}

/**
 * Days until a date's next occurrence.
 *
 * `recurring` dates (a birthday, an anniversary) roll to next year once
 * they pass; one-off dates simply stop counting. Handles 29 February by
 * letting the Date constructor roll it to 1 March in a common year, which is
 * the behaviour anyone actually wants from a birthday reminder.
 */
export function daysUntilAnnual(date: string, today: string, recurring: boolean): number | null {
  if (!recurring) {
    const away = daysBetween(today, date)
    return away >= 0 ? away : null
  }
  const [, m, d] = date.split('-').map(Number)
  const year = Number(today.slice(0, 4))
  for (const y of [year, year + 1]) {
    const cand = new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
    const away = daysBetween(today, cand)
    if (away >= 0) return away
  }
  return null
}

/* ------------------------------------------------------------------ search */

export interface SearchHit {
  record: PartnerRecord
  /** Where the match landed, for the result row's subtitle. */
  field: string
  snippet: string
}

export function searchPartner(records: PartnerRecord[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const hits: SearchHit[] = []
  for (const r of records) {
    const d = r.data as unknown as Record<string, unknown>
    for (const [field, raw] of Object.entries(d)) {
      const value = Array.isArray(raw) ? raw.join(', ') : raw
      if (typeof value !== 'string') continue
      // Photos are data URLs and would match almost any query.
      if (field === 'photo' || value.startsWith('data:')) continue
      const at = value.toLowerCase().indexOf(q)
      if (at === -1) continue
      hits.push({
        record: r,
        field,
        snippet: truncate(value.slice(Math.max(0, at - 24)), 96),
      })
      break
    }
  }
  return hits
}

/* ------------------------------------------------- quick-capture guessing */

/**
 * A first guess at what a typed line is, so "+ Remember Something" can be one
 * box instead of a form.
 *
 * Only ever a *default* — the category sits right there on the confirm step
 * and can be changed before saving, which is the whole reason it is safe for
 * this to be as crude as it is.
 */
export function guessKind(text: string): PartnerKind {
  const t = text.toLowerCase()
  if (/\b(wants?|wish|wishes|would love|dying to|looking for)\b/.test(t)) return 'want'
  if (/\b(gift|present|buy her|got her|gave her)\b/.test(t)) return 'gift'
  if (/\b(favourite|favorite|loves|likes|hates|dislikes|can't stand|allergic)\b/.test(t))
    return 'preference'
  if (/\b(birthday|anniversary|wedding|first met)\b/.test(t)) return 'date'
  if (/\b(period|cramps|cycle)\b/.test(t)) return 'symptom'
  return 'journal'
}

/** Decrypted records, newest-meaningful-first, for a list view. */
export function sortForDisplay(records: PartnerRecord[]): PartnerRecord[] {
  return records.slice().sort((a, b) => {
    const da = (a.data as { date?: string; dateMentioned?: string }).date ??
      (a.data as { dateMentioned?: string }).dateMentioned ?? a.data.createdAt
    const db_ = (b.data as { date?: string; dateMentioned?: string }).date ??
      (b.data as { dateMentioned?: string }).dateMentioned ?? b.data.createdAt
    return db_.localeCompare(da)
  })
}

/** The envelope half of a record, for callers that only have the item. */
export function toRecord(item: PartnerItem, data: PartnerPlain): PartnerRecord {
  return { id: item.id, kind: item.kind, order: item.order, data }
}
