import type { DB, Transaction, TxType } from '../types'

/**
 * Guess the category and account for an entry from what has already been
 * typed into it, by counting what was chosen the last time similar words
 * were typed.
 *
 * Pure counting over the owner's own history. No model, no service, nothing
 * leaves the device — which is the only kind of prediction that belongs in
 * an app whose whole premise is that the data never goes anywhere. It also
 * means the guesses are right for *this* shop from the first week, rather
 * than right for shops in general and never quite right for this one.
 *
 * The signal is deliberately shallow: substring and whole-word overlap, aged
 * so recent habits win over old ones. Anything cleverer (stemming, fuzzy
 * distance) starts guessing confidently in cases where a person would not,
 * and a confidently wrong category is worse than no suggestion at all —
 * it gets accepted without reading.
 */

export interface Prediction {
  categoryId?: string
  accountId?: string
  /** How many past entries stand behind this. Shown, so the guess can be
   *  judged rather than just trusted. */
  support: number
}

/** Lowercased words of two or more characters. One-character tokens match
 *  far too much to carry any signal. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9ऀ-ॿ]+/)
    .filter((w) => w.length >= 2)
}

/** How strongly a past entry's text answers to what is being typed now.
 *  0 means no relationship worth acting on. */
function affinity(pastText: string, typed: string, typedTokens: string[]): number {
  const past = pastText.toLowerCase().trim()
  if (!past) return 0

  // The same thing typed again, give or take case — by far the strongest
  // signal there is, and the case this feature mostly exists for.
  if (past === typed) return 6
  if (past.startsWith(typed) || typed.startsWith(past)) return 4
  if (past.includes(typed)) return 3

  const pastTokens = new Set(tokens(past))
  const shared = typedTokens.filter((t) => pastTokens.has(t)).length
  if (shared === 0) return 0
  // Two words in common is a real match; one is a hint.
  return shared >= 2 ? 2 : 1
}

/**
 * Older entries still count, but less. Six months halves the weight, so a
 * category changed recently overtakes a long history of the old one within
 * a few uses rather than being outvoted by years of it.
 */
function recency(date: string, now: number): number {
  const then = new Date(date.slice(0, 10) + 'T12:00').getTime()
  if (!isFinite(then)) return 0.5
  const months = (now - then) / (86400000 * 30.44)
  return 1 / (1 + Math.max(0, months) / 6)
}

/**
 * The best guess for `text`, or null when nothing in the history supports
 * one. Only ever looks at entries of the same type — an expense's categories
 * are a different vocabulary from an income's, and mixing them produces
 * suggestions that cannot even be selected.
 */
export function predictEntry(
  db: Pick<DB, 'transactions'>,
  type: TxType,
  text: string,
): Prediction | null {
  const typed = text.toLowerCase().trim()
  if (typed.length < 2) return null

  const typedTokens = tokens(typed)
  const now = Date.now()
  const byCategory = new Map<string, number>()
  const byAccount = new Map<string, number>()
  let support = 0

  for (const t of db.transactions as Transaction[]) {
    if (t.type !== type) continue
    const score = affinity(`${t.note ?? ''} ${t.description ?? ''}`, typed, typedTokens)
    if (score === 0) continue

    const weight = score * recency(t.date, now)
    support++
    if (t.categoryId) byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) + weight)
    const acc = t.accountId ?? t.fromAccountId
    if (acc) byAccount.set(acc, (byAccount.get(acc) ?? 0) + weight)
  }

  if (support === 0) return null

  const top = (m: Map<string, number>): string | undefined => {
    let best: string | undefined
    let bestScore = 0
    for (const [id, score] of m) {
      if (score > bestScore) {
        best = id
        bestScore = score
      }
    }
    // A single weak brush against one shared word is not worth putting a
    // suggestion on screen for.
    return bestScore >= 1.5 ? best : undefined
  }

  const categoryId = top(byCategory)
  const accountId = top(byAccount)
  if (!categoryId && !accountId) return null
  return { categoryId, accountId, support }
}
