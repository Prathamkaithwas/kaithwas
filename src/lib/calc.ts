import type { Account, Category, DB, Transaction } from '../types'
import { inMonth, parseISO } from './date'

export interface Totals {
  income: number
  expense: number
  total: number
}

/** Transfers never count as income or expense — they only move money between accounts. */
export function totalsOf(txs: Transaction[]): Totals {
  let income = 0
  let expense = 0
  for (const t of txs) {
    if (t.type === 'income') income += t.amount
    else if (t.type === 'expense') expense += t.amount
  }
  return { income, expense, total: income - expense }
}

/** Sum of the margin noted on each entry. */
export function profitOf(txs: Transaction[]): number {
  let sum = 0
  for (const t of txs) sum += t.profit ?? 0
  return sum
}

export function txsInMonth(db: DB, month: string): Transaction[] {
  return db.transactions.filter((t) => inMonth(t.date, month, db.settings.monthStartDay))
}

export function txsInRange(db: DB, start: Date, end: Date): Transaction[] {
  const s = start.getTime()
  const e = end.getTime()
  return db.transactions.filter((t) => {
    const d = parseISO(t.date).getTime()
    return d >= s && d <= e
  })
}

/** Expense split the way the Total screen reports it. */
export function expenseSplit(
  db: DB,
  txs: Transaction[],
): { cash: number; card: number; transfer: number } {
  const cardIds = new Set(
    db.accounts.filter((a) => a.group === 'Card').map((a) => a.id),
  )
  let cash = 0
  let card = 0
  let transfer = 0
  for (const t of txs) {
    if (t.type === 'expense') {
      if (t.splits?.length) {
        for (const s of t.splits) {
          if (cardIds.has(s.accountId)) card += s.amount
          else cash += s.amount
        }
      } else if (t.accountId && cardIds.has(t.accountId)) {
        card += t.amount
      } else {
        cash += t.amount
      }
    } else if (t.type === 'transfer') {
      transfer += t.amount
    }
  }
  return { cash, card, transfer }
}

/** How much of a transaction landed on one account — split-aware. */
export function amountOnAccount(t: Transaction, accountId: string): number {
  if (t.splits?.length) {
    return t.splits.reduce((sum, s) => (s.accountId === accountId ? sum + s.amount : sum), 0)
  }
  return t.accountId === accountId ? t.amount : 0
}

/** Every account a transaction touches, in order. */
export function accountsOf(t: Transaction): string[] {
  if (t.splits?.length) return [...new Set(t.splits.map((s) => s.accountId))]
  return t.accountId ? [t.accountId] : []
}

/** Current balance of an account, in paise. */
export function accountBalance(db: DB, accountId: string): number {
  const acc = db.accounts.find((a) => a.id === accountId)
  if (!acc) return 0
  let bal = acc.initialBalance
  for (const t of db.transactions) {
    if (t.type === 'income') bal += amountOnAccount(t, accountId)
    else if (t.type === 'expense') bal -= amountOnAccount(t, accountId)
    else if (t.type === 'transfer') {
      if (t.fromAccountId === accountId) bal -= t.amount + (t.fee ?? 0)
      if (t.toAccountId === accountId) bal += t.amount
    }
  }
  return bal
}

export function assetsLiabilities(db: DB): {
  assets: number
  liabilities: number
  total: number
} {
  let assets = 0
  let liabilities = 0
  for (const a of db.accounts) {
    if (a.excludeFromTotal) continue
    const bal = accountBalance(db, a.id)
    if (bal >= 0) assets += bal
    else liabilities += -bal
  }
  return { assets, liabilities, total: assets - liabilities }
}

export function groupByDay(txs: Transaction[]): [string, Transaction[]][] {
  const map = new Map<string, Transaction[]>()
  for (const t of txs) {
    const k = t.date.slice(0, 10)
    const arr = map.get(k)
    if (arr) arr.push(t)
    else map.set(k, [t])
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(
      ([k, arr]) =>
        [k, arr.sort((a, b) => (a.date < b.date ? 1 : -1))] as [string, Transaction[]],
    )
}

export interface CategorySlice {
  categoryId: string
  name: string
  color: string
  icon: string
  amount: number
  pct: number
  count: number
}

/** Amounts grouped by category. `rollUp` folds subcategories into their parent. */
export function byCategory(
  db: DB,
  txs: Transaction[],
  type: 'income' | 'expense',
  rollUp = false,
): CategorySlice[] {
  const sums = new Map<string, { amount: number; count: number }>()
  let total = 0
  for (const t of txs) {
    if (t.type !== type || !t.categoryId) continue
    let key = t.categoryId
    if (rollUp) {
      const c = db.categories.find((x) => x.id === key)
      if (c?.parentId) key = c.parentId
    }
    const cur = sums.get(key) ?? { amount: 0, count: 0 }
    cur.amount += t.amount
    cur.count += 1
    sums.set(key, cur)
    total += t.amount
  }
  return [...sums.entries()]
    .map(([categoryId, { amount, count }]) => {
      const cat = db.categories.find((c) => c.id === categoryId)
      return {
        categoryId,
        name: categoryLabel(cat) || 'Unknown',
        color: cat?.color ?? '#9AA0A6',
        icon: cat?.icon ?? '❓',
        amount,
        count,
        pct: total ? (amount / total) * 100 : 0,
      }
    })
    .sort((a, b) => b.amount - a.amount)
}

export function accountsByGroup(db: DB): [string, Account[]][] {
  const map = new Map<string, Account[]>()
  for (const a of [...db.accounts].sort((x, y) => x.order - y.order)) {
    const arr = map.get(a.group)
    if (arr) arr.push(a)
    else map.set(a.group, [a])
  }
  return [...map.entries()]
}

/**
 * Categories are plain text — any emoji is simply part of the name the user typed.
 * Imported data keeps its emoji in a separate field, so glue it back on for display.
 */
export function categoryLabel(c?: Category): string {
  if (!c) return ''
  return c.icon ? `${c.icon} ${c.name}` : c.name
}

/** Split into the top-level name and the subcategory, the way the Daily rows show them. */
export function categoryParts(db: DB, id?: string): { main: string; sub: string } {
  if (!id) return { main: '', sub: '' }
  const c = db.categories.find((x) => x.id === id)
  if (!c) return { main: '', sub: '' }
  if (c.parentId) {
    const p = db.categories.find((x) => x.id === c.parentId)
    return { main: categoryLabel(p ?? c), sub: categoryLabel(c) }
  }
  return { main: categoryLabel(c), sub: '' }
}

export function categoryName(db: DB, id?: string): string {
  if (!id) return ''
  const c = db.categories.find((x) => x.id === id)
  if (!c) return ''
  if (c.parentId) {
    const p = db.categories.find((x) => x.id === c.parentId)
    return p ? `${categoryLabel(p)} > ${categoryLabel(c)}` : categoryLabel(c)
  }
  return categoryLabel(c)
}

export function accountName(db: DB, id?: string): string {
  return db.accounts.find((a) => a.id === id)?.name ?? ''
}

/** "CashGalla + Gpay" for a split payment, or just the account name. */
export function accountLabel(db: DB, t: Transaction): string {
  const ids = accountsOf(t)
  if (ids.length <= 1) return accountName(db, ids[0] ?? t.accountId)
  return ids.map((id) => accountName(db, id)).join(' + ')
}
