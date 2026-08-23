import { useMemo, useState } from 'react'
import type { DealRating, Transaction, TxType } from '../types'
import { DEAL_COLORS, DEAL_LABEL, DEAL_LEVELS } from '../types'
import { useStore } from '../store'
import { accountName, categoryName, profitOf, totalsOf } from '../lib/calc'
import { Empty, Screen, SummaryBar } from '../components/ui'
import { TxRow } from '../components/TxRow'

const TYPES: (TxType | 'all')[] = ['all', 'income', 'expense', 'transfer']

export function Search({
  onBack,
  onEdit,
  openFilters,
}: {
  onBack: () => void
  onEdit: (tx: Transaction) => void
  openFilters?: boolean
}) {
  const { db } = useStore()
  const [q, setQ] = useState('')
  const [type, setType] = useState<TxType | 'all'>('all')
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [deal, setDeal] = useState<DealRating | ''>('')
  const [filters, setFilters] = useState(!!openFilters)

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return db.transactions
      .filter((t) => (type === 'all' ? true : t.type === type))
      .filter((t) => (!accountId ? true : t.accountId === accountId || t.fromAccountId === accountId || t.toAccountId === accountId))
      .filter((t) => (!categoryId ? true : t.categoryId === categoryId))
      .filter((t) => (!from || t.date.slice(0, 10) >= from) && (!to || t.date.slice(0, 10) <= to))
      .filter((t) => (!deal ? true : t.deal === deal))
      .filter((t) => {
        if (!needle) return true
        const hay = [
          t.note,
          t.description,
          categoryName(db, t.categoryId),
          accountName(db, t.accountId),
          accountName(db, t.fromAccountId),
          accountName(db, t.toAccountId),
        ]
          .join(' ')
          .toLowerCase()
        return hay.includes(needle)
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [db, q, type, accountId, categoryId, from, to, deal])

  const t = totalsOf(results)

  return (
    <Screen
      title="Search"
      onBack={onBack}
      action={
        <button
          className="px-4 text-[13px]"
          style={{ color: filters ? 'var(--accent)' : 'var(--muted)' }}
          onClick={() => setFilters((v) => !v)}
        >
          Filters
        </button>
      }
    >
      <div className="p-3 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
        <input
          className="w-full px-3 py-2 rounded-lg text-[14px]"
          style={{ background: 'var(--bg)' }}
          placeholder="Search notes, categories, accounts"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>

      {filters && (
        <div className="p-3 space-y-3 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
          <div className="flex gap-2">
            {TYPES.map((x) => (
              <button
                key={x}
                className="flex-1 py-1.5 rounded-full text-[12px] capitalize"
                style={{
                  background: x === type ? 'var(--accent)' : 'var(--bg)',
                  color: x === type ? '#fff' : 'var(--muted)',
                }}
                onClick={() => setType(x)}
              >
                {x}
              </button>
            ))}
          </div>
          <div className="flex gap-3 text-[13px]">
            <select
              className="flex-1 border-b pb-1"
              style={{ borderColor: 'var(--line)' }}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">All accounts</option>
              {db.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              className="flex-1 border-b pb-1"
              style={{ borderColor: 'var(--line)' }}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">All categories</option>
              {db.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 text-[13px]">
            <input type="date" className="flex-1" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="flex-1" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>

          {/* The rating picked on the deal slider while entering an income —
              expenses and transfers never carry one, so this only ever
              narrows income entries. Tapping the active rating again clears
              it, same toggle the type row above uses. */}
          <div>
            <div className="text-[11px] mb-1.5" style={{ color: 'var(--muted)' }}>
              Deal
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DEAL_LEVELS.map((level) => (
                <button
                  key={level}
                  className="search-filter-chip"
                  data-on={deal === level || undefined}
                  style={{ '--c': DEAL_COLORS[level] } as React.CSSProperties}
                  onClick={() => setDeal((d) => (d === level ? '' : level))}
                >
                  <span className="search-filter-chip-dot" aria-hidden />
                  {DEAL_LABEL[level]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <SummaryBar income={t.income} expense={t.expense} profit={profitOf(results)} />
      {results.length === 0 && <Empty text="No matches" />}
      {results.map((tx) => (
        <TxRow key={tx.id} tx={tx} onEdit={onEdit} showDate />
      ))}
    </Screen>
  )
}
