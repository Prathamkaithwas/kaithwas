import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { categoryLabel, txsInMonth } from '../lib/calc'
import { addMonths } from '../lib/date'
import { formatAmount, toPaise } from '../lib/money'
import { Bar, Money, Screen } from '../components/ui'

/** Budget overview + editor for one month. Reached from Total and Configuration. */
export function BudgetSetting({ month, onBack }: { month: string; onBack: () => void }) {
  const { db, setBudget, copyBudget } = useStore()
  const [editing, setEditing] = useState(false)

  const txs = useMemo(() => txsInMonth(db, month), [db, month])
  const spentBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of txs) {
      if (t.type !== 'expense' || !t.categoryId) continue
      m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + t.amount)
    }
    return m
  }, [txs])
  const spentTotal = [...spentBy.values()].reduce((a, b) => a + b, 0)

  const monthBudgets = db.budgets.filter((b) => b.month === month)
  const totalBudget = monthBudgets.find((b) => !b.categoryId)?.amount ?? 0
  const catBudgets = monthBudgets.filter((b) => b.categoryId)

  const cats = db.categories
    .filter((c) => c.type === 'expense' && !c.parentId)
    .sort((a, b) => a.order - b.order)
  const budgeted = new Set(catBudgets.map((b) => b.categoryId))
  const unbudgeted = cats.filter((c) => !budgeted.has(c.id))

  const pct = totalBudget ? (spentTotal / totalBudget) * 100 : 0
  const remaining = totalBudget - spentTotal

  const initial: Record<string, string> = {}
  for (const b of monthBudgets) initial[b.categoryId ?? 'total'] = formatAmount(b.amount, db.settings)
  const [values, setValues] = useState<Record<string, string>>(initial)

  const saveEdits = () => {
    setBudget(month, undefined, toPaise((values.total ?? '0').replace(/,/g, '')))
    for (const c of cats) setBudget(month, c.id, toPaise((values[c.id] ?? '0').replace(/,/g, '')))
    setEditing(false)
  }

  const input = (key: string) => (
    <input
      className="w-28 text-right tabular-nums border-b pb-1 text-[15px]"
      style={{ borderColor: 'var(--line)' }}
      inputMode="decimal"
      placeholder="0"
      value={values[key] ?? ''}
      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
    />
  )

  if (editing) {
    return (
      <Screen
        title={`Budget ${month.replace('-', '.')}`}
        onBack={() => setEditing(false)}
        action={
          <button className="px-4 text-[15px] font-semibold" style={{ color: 'var(--accent)' }} onClick={saveEdits}>
            Save
          </button>
        }
      >
        <div
          className="flex items-center px-4 py-3.5 border-b"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
        >
          <span className="flex-1 text-[16px] font-semibold">Total budget</span>
          {input('total')}
        </div>
        <div className="h-2" />
        {cats.map((c) => (
          <div
            key={c.id}
            className="flex items-center px-4 py-3.5 border-b gap-2"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
          >
            <span className="flex-1 text-[16px]">{categoryLabel(c)}</span>
            {input(c.id)}
          </div>
        ))}
        <div className="h-16" />
      </Screen>
    )
  }

  return (
    <Screen
      title="Budget Setting"
      onBack={onBack}
      action={
        <button
          className="px-4 text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      }
    >
      <div className="px-4 py-4 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-[14px]" style={{ color: 'var(--muted)' }}>
            {month.replace('-', '.')} total
          </span>
          <span className="text-[14px]">
            <Money value={spentTotal} kind="expense" /> / <Money value={totalBudget} kind="plain" />
          </span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden mb-2" style={{ background: 'var(--line)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, pct)}%`,
              background: pct > 100 ? 'var(--expense)' : 'var(--accent)',
            }}
          />
        </div>
        <div className="flex justify-between text-[12px]">
          <span style={{ color: 'var(--muted)' }}>{pct.toFixed(0)}% used</span>
          <span style={{ color: remaining < 0 ? 'var(--expense)' : 'var(--muted)' }}>
            {remaining < 0 ? 'Over by ' : 'Remaining '}
            <Money value={Math.abs(remaining)} kind="plain" />
          </span>
        </div>
      </div>

      <div className="h-2" />

      {catBudgets.length === 0 && (
        <div className="py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
          No category budgets set
        </div>
      )}
      {catBudgets.map((b) => {
        const cat = db.categories.find((c) => c.id === b.categoryId)
        if (!cat) return null
        const spent = spentBy.get(cat.id) ?? 0
        const p = (spent / b.amount) * 100
        const left = b.amount - spent
        return (
          <div key={b.id} className="px-4 py-3 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
            <div className="flex items-center gap-2 mb-1.5 text-[14px]">
              <span className="flex-1">{categoryLabel(cat)}</span>
              <span>
                <Money value={spent} kind={p > 100 ? 'expense' : 'plain'} /> /{' '}
                <span style={{ color: 'var(--muted)' }}>
                  <Money value={b.amount} kind="plain" />
                </span>
              </span>
            </div>
            <Bar pct={p} color={p > 100 ? 'var(--expense)' : cat.color} />
            <div
              className="text-[11px] mt-1 text-right"
              style={{ color: left < 0 ? 'var(--expense)' : 'var(--muted)' }}
            >
              {left < 0 ? 'over by ' : 'left '}
              <Money value={Math.abs(left)} kind="plain" />
            </div>
          </div>
        )
      })}

      {unbudgeted.length > 0 && (
        <>
          <div className="px-4 py-2 text-[12px] mt-2" style={{ background: 'var(--bg)', color: 'var(--muted)' }}>
            No budget set
          </div>
          <div
            className="px-4 py-3 flex flex-wrap gap-2 border-b"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)', opacity: 0.6 }}
          >
            {unbudgeted.map((c) => (
              <span key={c.id} className="text-[12px] px-2 py-1 rounded" style={{ background: 'var(--bg)' }}>
                {categoryLabel(c)}
              </span>
            ))}
          </div>
        </>
      )}

      <div className="p-4">
        <button
          className="w-full py-3 rounded-lg text-[15px]"
          style={{ background: 'var(--surface)' }}
          onClick={() => copyBudget(addMonths(month, -1), month)}
        >
          Copy last month's budget
        </button>
      </div>
    </Screen>
  )
}

