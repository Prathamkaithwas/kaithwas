import { useMemo, useState } from 'react'
import type { DealRating, Transaction, TxType } from '../types'
import { DEAL_COLORS, DEAL_LABEL, DEAL_LEVELS } from '../types'
import { useStore } from '../store'
import { accountName, categoryName, profitOf, totalsOf } from '../lib/calc'
import { Empty, Screen, SummaryBar } from '../components/ui'
import { TxRow } from '../components/TxRow'
import { formatMoney } from '../lib/money'
import { balanceOf } from '../types'
import type { ExtraPage } from '../App'

const TYPES: (TxType | 'all')[] = ['all', 'income', 'expense', 'transfer']

export function Search({
  onBack,
  onEdit,
  onOpenPage,
  onOpenNotes,
  openFilters,
}: {
  onBack: () => void
  onEdit: (tx: Transaction) => void
  /** Jump to whichever More screen a non-entry match lives on. */
  onOpenPage: (page: ExtraPage) => void
  onOpenNotes: () => void
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

  /**
   * Everything that is not a ledger entry.
   *
   * The filters above are all transaction-shaped — type, account, category,
   * deal — so they deliberately do not narrow these; a date range means
   * nothing to a supplier's phone number. Only the typed words apply.
   *
   * Shafali is not searched. Documents are not encrypted the way vault
   * entries are, but they sit behind the lock screen, and that screen is
   * the boundary: listing a document's title out here would walk it around
   * the lock without asking for the sequence.
   */
  const elsewhere = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    const hit = (...parts: (string | undefined)[]) =>
      parts.filter(Boolean).join(' ').toLowerCase().includes(needle)

    const groups: { label: string; page: 'notes' | ExtraPage; items: { id: string; title: string; sub?: string; right?: string }[] }[] = []

    const notes = db.memos
      .filter((m) => hit(m.title, m.body, ...(m.checklist ?? []).map((c) => c.text)))
      .slice(0, 8)
      .map((m) => ({ id: m.id, title: m.title || 'Untitled note', sub: m.body || undefined, right: m.date.slice(8, 10) + '/' + m.date.slice(5, 7) }))
    if (notes.length) groups.push({ label: 'Niba — notes', page: 'notes', items: notes })

    const loans = db.loans
      .filter((l) => !l.archived && hit(l.lender, l.purpose, l.loanAccountNumber, l.notes))
      .slice(0, 6)
      .map((l) => ({ id: l.id, title: l.lender, sub: l.purpose || undefined, right: formatMoney(l.emiAmount, db.settings) }))
    if (loans.length) groups.push({ label: 'Loans', page: 'loans', items: loans })

    const owed = db.balances
      .filter((b) => hit(b.name, b.phone, b.note, ...b.entries.map((e) => e.note ?? '')))
      .slice(0, 6)
      .map((b) => ({ id: b.id, title: b.name, sub: b.note || b.phone || undefined, right: formatMoney(balanceOf(b), db.settings) }))
    if (owed.length) groups.push({ label: 'Balance', page: 'balance', items: owed })

    const rates = db.purchaseItems
      .filter((x) => hit(x.name, x.variant, x.supplier, x.category, x.subcategory, x.notes))
      .slice(0, 8)
      .map((x) => ({
        id: x.id,
        title: x.name + (x.variant ? ' ' + x.variant : ''),
        sub: [x.subcategory, x.supplier].filter(Boolean).join(' · ') || undefined,
        right: formatMoney(x.rate, db.settings) + (x.unit ? '/' + x.unit : ''),
      }))
    if (rates.length) groups.push({ label: 'Khushi — rate book', page: 'kitee', items: rates })

    const suppliers = db.suppliers
      .filter((x) => hit(x.name, x.phone, x.notes))
      .slice(0, 6)
      .map((x) => ({ id: x.id, title: x.name, sub: x.notes || undefined, right: x.phone }))
    if (suppliers.length) groups.push({ label: 'Suppliers', page: 'kitee', items: suppliers })

    const stock = db.stockItems
      .filter((x) => hit(x.name, x.notes))
      .slice(0, 6)
      .map((x) => ({ id: x.id, title: x.name, sub: x.notes || undefined, right: x.quantity }))
    if (stock.length) groups.push({ label: 'Taruna — stock', page: 'stock', items: stock })

    return groups
  }, [db, q])

  const nothing = results.length === 0 && elsewhere.length === 0

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
          placeholder="Search entries, notes, loans, rates, people"
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
      {nothing && <Empty text="No matches" />}
      {results.map((tx) => (
        <TxRow key={tx.id} tx={tx} onEdit={onEdit} showDate />
      ))}

      {/* Everything that isn't a ledger entry, grouped by where it lives, so
          a half-remembered word finds the note or the rate it was actually
          in. Each row carries enough of its own content that the answer is
          often readable here without going anywhere. */}
      {elsewhere.map((group) => (
        <div key={group.label}>
          <div className="gsearch-head">{group.label}</div>
          {group.items.map((item) => (
            <button
              key={item.id}
              className="gsearch-row"
              onClick={() => (group.page === 'notes' ? onOpenNotes() : onOpenPage(group.page))}
            >
              <span className="gsearch-main">
                <span className="gsearch-title">{item.title}</span>
                {item.sub && <span className="gsearch-sub">{item.sub}</span>}
              </span>
              {item.right && <span className="gsearch-right num">{item.right}</span>}
            </button>
          ))}
        </div>
      ))}

      {q.trim() && (
        <div className="gsearch-note">
          Shafali isn't searched — what's behind the lock stays behind it.
        </div>
      )}
    </Screen>
  )
}
