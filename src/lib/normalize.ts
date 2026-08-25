import type { Category, DB, Transaction } from '../types'
import { DEFAULT_JOURNAL_PROMPTS, DEFAULT_MOODS, SLEEP_QUALITY_LEVELS, dealLevel, moodTag } from '../types'
import { seedDB } from './seed'

/**
 * Bring any database — one read off disk, one restored from a backup file —
 * up to the shape this build expects.
 *
 * Every collection is read defensively. A database written by an older build
 * is missing whatever keys were added since, and the app has to open on it
 * rather than crash: the user's real ledger lives in one of those older
 * shapes. Settings are layered over the defaults for the same reason, so a
 * newly-added setting arrives populated instead of `undefined`.
 *
 * Restoring a backup runs through here too. It used to take a different path
 * that skipped the deal-rating migration, so a file exported before the
 * three-point → five-point change came back with ratings the UI could not
 * render.
 */

/**
 * Fold away categories that are the same thing typed twice.
 *
 * Two subcategories under one parent with the same name — "Sugar" and
 * "sugar ", say — are one category as far as anyone using the app is
 * concerned, and having both means the entries filed under each are invisible
 * to the other. Quick-add makes this easy to do by accident, since it takes a
 * name and nothing else.
 *
 * The oldest one wins, every transaction pointing at a duplicate is repointed
 * to it, and the duplicates are dropped. Nothing is lost: no entry is deleted
 * and no amount changes, only which category id an entry names.
 *
 * Matching is per parent and per type, so "Other" under Food and "Other"
 * under Transport are left alone — they genuinely are different categories.
 * Comparison is case-insensitive and trims surrounding space, because that is
 * exactly how the accidental pair gets made.
 */
function mergeDuplicateCategories(
  categories: Category[],
  transactions: Transaction[],
): { categories: Category[]; transactions: Transaction[]; merged: number } {
  const keep = new Map<string, string>() // signature -> surviving id
  const remap = new Map<string, string>() // dropped id -> surviving id
  const survivors: Category[] = []

  for (const c of categories) {
    const sig = `${c.type}|${c.parentId ?? ''}|${c.name.trim().toLowerCase()}`
    const first = keep.get(sig)
    if (first === undefined) {
      keep.set(sig, c.id)
      survivors.push(c)
    } else {
      remap.set(c.id, first)
    }
  }

  if (remap.size === 0) return { categories, transactions, merged: 0 }

  return {
    // A duplicate could itself have been someone's parent, so parentId has to
    // be remapped too or those children would point at a category that is
    // no longer there.
    categories: survivors.map((c) =>
      c.parentId && remap.has(c.parentId) ? { ...c, parentId: remap.get(c.parentId) } : c,
    ),
    transactions: transactions.map((t) =>
      t.categoryId && remap.has(t.categoryId)
        ? { ...t, categoryId: remap.get(t.categoryId) }
        : t,
    ),
    merged: remap.size,
  }
}

export function normalizeDB(input: Partial<DB> | null | undefined): DB {
  const fresh = seedDB()
  const base = input ?? fresh

  // Which schema the incoming database was written by. Read before anything
  // overwrites it, so version-gated migrations below can actually fire —
  // previously `version` was clobbered with the current number on the way in,
  // which made it impossible to tell an old database from a new one.
  const from = base.version ?? 1

  const settings = { ...fresh.settings, ...base.settings }

  // v5: repair the "@" currency.
  //
  // This used to be the opposite migration — it rewrote '₹' to '@' for any
  // database older than v3, on the belief that the at-sign was a deliberate
  // change. It was not. '₹' became '@' in the 2026-07-29 rebuild commit, in
  // DEFAULT_SETTINGS and in the currency picker list at the same time, which
  // is the signature of an encoding casualty rather than a decision — and
  // this migration then faithfully pushed it onto every existing database.
  //
  // So it runs backwards now. Only ever rewrites the exact string '@', which
  // is not a currency in any locale and is no longer offered by the picker,
  // so there is no real choice this can destroy.
  if (settings.currencySymbol === '@') {
    settings.currencySymbol = '₹'
  }

  // v4: the accent moved from coral to a deep vampire red. Same one-shot
  // rule — only rewrites the old default, so a colour picked by hand sticks.
  if (from < 4 && settings.accent.toUpperCase() === '#F4695D') {
    settings.accent = '#C41230'
  }

  const cleaned = mergeDuplicateCategories(
    base.categories ?? [],
    (base.transactions ?? []) as Transaction[],
  )

  return {
    ...fresh,
    ...base,
    version: fresh.version,
    accounts: base.accounts ?? [],
    categories: cleaned.categories,
    budgets: base.budgets ?? [],
    repeats: base.repeats ?? [],
    memos: base.memos ?? [],
    habits: base.habits ?? [],
    habitLogs: base.habitLogs ?? [],
    chores: base.chores ?? [],
    choreLogs: base.choreLogs ?? [],
    // `quality` is a named level ('rough'…'great'), but it briefly shipped
    // as a 1–5 number and a restored backup or a hand-edited file can carry
    // anything. An unrecognised value is dropped rather than guessed at: a
    // number would index the label table to `undefined` and the moon's phase
    // lookup to -1, drawing a broken crescent for a night nobody can explain.
    sleepLogs: (base.sleepLogs ?? []).map((s) =>
      s.quality === undefined || SLEEP_QUALITY_LEVELS.includes(s.quality)
        ? s
        : { ...s, quality: undefined },
    ),
    importantDates: base.importantDates ?? [],
    // Mood used to reuse the deal rating's five points before it had its own
    // vocabulary; moodTag carries anything saved under those old values
    // forward to its nearest new tag.
    // An empty level is deliberate, not missing: a day can carry journal
    // answers with no mood picked (see setMoodAnswer in store.tsx), and
    // those are stored as ''. moodTag treats any falsy value as legacy data
    // and returns 'okay', which would have quietly turned every
    // answers-only day into an "Okay" mood the owner never chose — on the
    // next app load, invisibly, and then counted it in the weekly mode and
    // the carry-forward tile. Only a genuinely absent level gets the
    // legacy default now.
    moodLogs: (base.moodLogs ?? []).map((m) => ({
      ...m,
      level: m.level === '' ? '' : moodTag(m.level),
    })),
    // A database from before moods were editable has no list of its own —
    // it seeds from the seed nine, the same values `moodTag` above already
    // normalises old entries onto, so every log still points at something
    // real the first time this runs.
    moods: base.moods?.length ? base.moods : DEFAULT_MOODS,
    hiddenTransactions: base.hiddenTransactions ?? [],
    hiddenMemos: base.hiddenMemos ?? [],
    vaultItems: base.vaultItems ?? [],
    partnerItems: base.partnerItems ?? [],
    passwordItems: base.passwordItems ?? [],
    // A document used to carry one `photo` string rather than a `photos`
    // array — every doc saved before that change still has the old field on
    // disk. `as never` reads it off an object the current DocItem type says
    // does not have it, which is exactly true from here on; it is only ever
    // true of a record from before this build.
    docItems: (base.docItems ?? []).map((d) =>
      d.photos ? d : { ...d, photos: [(d as never as { photo: string }).photo] },
    ),
    loans: base.loans ?? [],
    stockItems: base.stockItems ?? [],
    purchaseItems: base.purchaseItems ?? [],
    suppliers: base.suppliers ?? [],
    // Entries default too: a person record from a build before entries
    // existed would otherwise crash every balance calculation on undefined.
    balances: (base.balances ?? []).map((b) => ({ ...b, entries: b.entries ?? [] })),
    // Seeded rather than left empty for a database saved before prompts
    // existed — an upgrade should find the three questions already there,
    // the same as a fresh install, not an empty Journal with no way to know
    // anything is meant to be in it. An owner who deletes them all gets an
    // empty array, which is preserved (?? only fills in a missing key).
    journalPrompts: base.journalPrompts ?? DEFAULT_JOURNAL_PROMPTS,
    plannerTasks: base.plannerTasks ?? [],
    transactions: cleaned.transactions.map((t) => {
      let next = t
      // The deal rating went from three points to five; rewrite the old
      // red/blue/green values once, on the way in.
      if (next.deal) next = { ...next, deal: dealLevel(next.deal) }
      // A single `photo` becomes the first of `photos`, so every reader after
      // this point deals with one shape.
      if (next.photo && !next.photos?.length) {
        next = { ...next, photos: [next.photo], photo: undefined }
      }
      return next
    }),
    settings,
  }
}

/**
 * A backup file is only worth restoring if it actually looks like one. This
 * is deliberately loose — it checks the shape, not the version — because an
 * old export must still be importable.
 */
export function looksLikeBackup(value: unknown): value is Partial<DB> {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<DB>
  return Array.isArray(v.transactions) && Array.isArray(v.accounts)
}
