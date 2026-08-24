import { useMemo, useState } from 'react'
import type { Transaction } from '../types'
import { TYPE_LABEL } from '../types'
import { useStore } from '../store'
import { byCategory, totalsOf, txsInMonth, txsInRange, type CategorySlice } from '../lib/calc'
import { addMonths, monthRange, parseISO } from '../lib/date'
import { Empty, Money, Screen } from '../components/ui'
import { TxRow } from '../components/TxRow'

/**
 * `All` exists for one question: "how much have I given Adarsh, in total".
 * Every other period answers "how much this week/month/year", and none of
 * them can add up a subcategory over the whole life of the ledger — which is
 * the number actually being asked for.
 *
 * `Custom` is the escape hatch from the fixed four: a festival week that
 * straddles two months, one supplier's billing cycle, "since I reopened in
 * March" — real questions a shop asks that no calendar-aligned period can
 * answer. Its two dates live in the shell alongside the period itself (see
 * `statsRange` in App.tsx) so the header can label the button with them.
 */
export const STATS_PERIODS = ['Weekly', 'Monthly', 'Annually', 'All', 'Custom'] as const
export type StatsPeriod = (typeof STATS_PERIODS)[number]

/** The two ends of a `Custom` period, each YYYY-MM-DD and inclusive. */
export interface StatsRange {
  from: string
  to: string
}

function periodTxs(
  db: ReturnType<typeof useStore>['db'],
  month: string,
  period: StatsPeriod,
  range?: StatsRange,
): Transaction[] {
  if (period === 'All') return db.transactions
  if (period === 'Custom') {
    // Both ends inclusive — a range typed as 1st–31st should contain
    // everything filed on the 31st, not stop at midnight as it began.
    // Backwards ranges are read either way round rather than silently
    // returning nothing, since a date picker makes it easy to set the far
    // end first.
    if (!range) return db.transactions
    const a = parseISO(range.from + 'T00:00')
    const b = parseISO(range.to + 'T00:00')
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    const end = new Date(hi)
    end.setHours(23, 59, 59, 999)
    return txsInRange(db, lo, end)
  }
  if (period === 'Monthly') return txsInMonth(db, month)
  if (period === 'Annually') {
    const year = month.slice(0, 4)
    return db.transactions.filter((t) => t.date.slice(0, 4) === year)
  }
  // Weekly — the week containing today, or the 1st of the shown month
  const anchor = new Date()
  if (anchor.toISOString().slice(0, 7) !== month) {
    const { start } = monthRange(month, db.settings.monthStartDay)
    anchor.setTime(start.getTime())
  }
  let lead = anchor.getDay() - db.settings.firstDayOfWeek
  if (lead < 0) lead += 7
  const start = new Date(anchor)
  start.setDate(start.getDate() - lead)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return txsInRange(db, start, end)
}

export function Stats({
  month,
  period,
  range,
  onEdit,
}: {
  month: string
  period: StatsPeriod
  range?: StatsRange
  onEdit: (tx: Transaction) => void
}) {
  const { db } = useStore()
  const [type, setType] = useState<'expense' | 'income'>('expense')
  const [drill, setDrill] = useState<string | null>(null)
  // A second level inside the drill: one subcategory on its own. Family
  // answers "how much on family"; this answers "how much to Adarsh".
  const [sub, setSub] = useState<string | null>(null)
  const [find, setFind] = useState('')

  const txs = useMemo(() => periodTxs(db, month, period, range), [db, month, period, range])
  const t = totalsOf(txs)
  // Stock is not a transaction view, so the pie only ever reads income/expense.
  const slices = byCategory(db, txs, type, true)

  // a slice is a top-level category — drilling shows it plus its subcategories
  const drillIds = useMemo(() => {
    if (!drill) return new Set<string>()
    return new Set([drill, ...db.categories.filter((c) => c.parentId === drill).map((c) => c.id)])
  }, [db.categories, drill])
  // Memoised because the subcategory totals and the shown list both depend on
  // it; rebuilt inline it changed identity every render and defeated both.
  const drillTxs = useMemo(
    () => (drill ? txs.filter((x) => x.categoryId && drillIds.has(x.categoryId)) : []),
    [drill, txs, drillIds],
  )
  const drillCat = slices.find((s) => s.categoryId === drill)

  /**
   * The parent's children, each with what it came to over the period.
   *
   * The parent's own directly-filed entries are listed alongside them as a
   * row of their own, otherwise the children never add up to the total above
   * and the screen looks like it is losing money.
   */
  const subTotals = useMemo(() => {
    if (!drill) return []
    const kids = db.categories.filter((c) => c.parentId === drill)
    const sum = (id: string) =>
      drillTxs.filter((x) => x.categoryId === id).reduce((a, x) => a + x.amount, 0)
    const rows = kids.map((c) => ({ id: c.id, name: c.name, color: c.color, amount: sum(c.id) }))
    const own = sum(drill)
    if (own > 0) {
      rows.push({
        id: drill,
        name: `${drillCat?.name ?? 'Category'} (direct)`,
        color: drillCat?.color ?? 'var(--accent)',
        amount: own,
      })
    }
    return rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount)
  }, [db.categories, drill, drillTxs, drillCat])

  // With a subcategory chosen, everything below narrows to just that one.
  const subCat = db.categories.find((c) => c.id === sub)
  const shownTxs = useMemo(() => {
    const base = sub ? drillTxs.filter((x) => x.categoryId === sub) : drillTxs
    const q = find.trim().toLowerCase()
    if (!q) return base
    return base.filter(
      (x) =>
        x.note.toLowerCase().includes(q) ||
        x.description.toLowerCase().includes(q) ||
        String(x.amount / 100).includes(q),
    )
  }, [drillTxs, sub, find])
  const shownTotal = shownTxs.reduce((a, x) => a + x.amount, 0)
  // Follows whichever level is open — the whole of Family, or just Adarsh.
  const drillTrend = useMemo(() => {
    if (!drill) return []
    return Array.from({ length: 6 }, (_, i) => {
      const m = addMonths(month, i - 5)
      const amount = txsInMonth(db, m)
        .filter((x) => (sub ? x.categoryId === sub : x.categoryId && drillIds.has(x.categoryId)))
        .reduce((a, x) => a + x.amount, 0)
      return { month: m, amount }
    })
  }, [db, drill, drillIds, month, sub])
  const drillMax = Math.max(1, ...drillTrend.map((d) => d.amount))

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div
        className="grid grid-cols-3 border-b shrink-0"
        style={{ borderColor: 'var(--line)' }}
      >
        {(['income', 'expense'] as const).map((k) => {
          const active = k === type
          return (
            <button
              key={k}
              className="py-2.5 relative flex flex-col items-center gap-0.5"
              style={{
                color: active ? 'var(--text)' : 'var(--muted)',
                fontWeight: active ? 600 : 400,
                transition: 'color 260ms var(--ease-out)',
              }}
              onClick={() => setType(k)}
            >
              <span className="text-[12px]">{TYPE_LABEL[k]}</span>
              <Money
                value={k === 'income' ? t.income : t.expense}
                kind="plain"
                className="text-[15px]"
              />
              {active && (
                <span
                  className="absolute left-4 right-4 -bottom-px h-[3px] rounded-t-full"
                  style={{ background: 'var(--accent)' }}
                />
              )}
            </button>
          )
        })}
      </div>


      <div className="flex-1 overflow-y-auto no-scrollbar pb-content">
        {slices.length === 0 ? (
          <Empty text="No data for this period" />
        ) : (
          <>
            <div className="py-4" style={{ background: 'var(--surface)' }}>
              <Pie slices={slices} />
            </div>
            <div className="h-2" />
            {slices.map((s) => (
              <button
                key={s.categoryId}
                className="w-full px-4 py-3.5 border-b flex items-center gap-4 text-left"
                style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
                onClick={() => setDrill(s.categoryId)}
              >
                <span
                  className="w-14 py-1.5 rounded text-center text-[14px] font-medium text-white shrink-0"
                  style={{ background: s.color }}
                >
                  {Math.round(s.pct)}%
                </span>
                <span className="flex-1 truncate text-[16px]">{s.name}</span>
                <Money value={s.amount} kind="plain" className="text-[16px]" />
              </button>
            ))}
          </>
        )}
      </div>

      {drill && (
        <Screen
          title={subCat?.name ?? drillCat?.name ?? ''}
          // Back steps out one level at a time: Adarsh → Family → the list.
          onBack={() => {
            setFind('')
            if (sub) setSub(null)
            else setDrill(null)
          }}
        >
          {/* The number he actually came for: the total for whichever level
              is open, stated once at the top rather than left to be added up
              from the rows. */}
          <div className="px-4 pt-4 pb-3" style={{ background: 'var(--surface)' }}>
            <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {sub ? `Total given to ${subCat?.name}` : 'Total'}
            </div>
            <Money value={shownTotal} kind="plain" className="text-[30px] font-bold" />
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
              {shownTxs.length} {shownTxs.length === 1 ? 'entry' : 'entries'}
            </div>
          </div>

          <div className="px-4 py-4" style={{ background: 'var(--surface)' }}>
            <div className="text-[12px] mb-2" style={{ color: 'var(--muted)' }}>
              Last 6 months
            </div>
            <div className="flex items-end gap-2 h-28">
              {drillTrend.map((d) => (
                <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: `${(d.amount / drillMax) * 88}px`,
                      background: drillCat?.color ?? 'var(--accent)',
                      minHeight: d.amount ? 2 : 0,
                    }}
                  />
                  <span className="text-[9px]" style={{ color: 'var(--muted)' }}>
                    {d.month.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="h-2" />

          {/* One row per subcategory, only at the parent level. Tapping one
              narrows everything above and below to it. */}
          {!sub && subTotals.length > 0 && (
            <>
              {subTotals.map((r) => (
                <button
                  key={r.id}
                  className="w-full px-4 py-3 border-b flex items-center gap-3 text-left"
                  style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
                  // The parent's own direct entries are a filter like any
                  // other, so that row drills too.
                  onClick={() => setSub(r.id)}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: r.color }}
                  />
                  <span className="flex-1 truncate text-[15px]">{r.name}</span>
                  <Money value={r.amount} kind="plain" className="text-[15px]" />
                  <span className="text-[16px]" style={{ color: 'var(--muted)' }}>
                    ›
                  </span>
                </button>
              ))}
              <div className="h-2" />
            </>
          )}

          {/* Search only once the list is long enough to need it — a search
              box over six entries is furniture. */}
          {shownTxs.length + (find ? 1 : 0) > 8 && (
            <div className="px-4 py-2" style={{ background: 'var(--surface)' }}>
              <input
                className="w-full border-b pb-2 text-[14px]"
                style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
                placeholder="Search these entries"
                value={find}
                onChange={(e) => setFind(e.target.value)}
              />
            </div>
          )}

          {shownTxs.length === 0 ? (
            <Empty text={find ? 'Nothing matches that' : 'Nothing here yet'} />
          ) : (
            shownTxs
              .slice()
              .sort((a, b) => (a.date < b.date ? 1 : -1))
              .map((tx) => <TxRow key={tx.id} tx={tx} onEdit={onEdit} showDate />)
          )}
        </Screen>
      )}
    </div>
  )
}

/** Pie with leader lines and outside labels, the way the app draws it. */
function Pie({ slices }: { slices: CategorySlice[] }) {
  const W = 360
  const H = 300
  const cx = W / 2
  const cy = H / 2
  const r = 88

  let angle = -Math.PI / 2
  const drawn = slices.map((s) => {
    const sweep = (s.pct / 100) * Math.PI * 2
    const start = angle
    const end = angle + sweep
    const mid = angle + sweep / 2
    angle = end
    return { ...s, start, end, mid, sweep }
  })

  const pt = (a: number, radius: number) => [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]

  // Label geometry per slice, before overlap resolution.
  const labels = drawn.map((s) => {
    const side: 'l' | 'r' = Math.cos(s.mid) < 0 ? 'l' : 'r'
    const [ex, ey] = pt(s.mid, r)
    const [bx, by] = pt(s.mid, r + 22)
    return {
      ...s,
      side,
      ex,
      ey,
      bx,
      by,
      tx: side === 'l' ? 26 : W - 26,
      anchor: side === 'l' ? ('start' as const) : ('end' as const),
    }
  })

  // Labels sharing a side get stacked top-to-bottom in one monotonic pass —
  // several small slices clustered at similar angles no longer pile on top of
  // each other the way pairwise nudging did.
  const MIN_GAP = 30
  const MIN_Y = 20
  const MAX_Y = H - 12
  function stackSide(side: 'l' | 'r'): Map<string, number> {
    const items = labels.filter((l) => l.side === side).sort((a, b) => a.by - b.by)
    const ys: number[] = []
    for (const it of items) ys.push(Math.max(it.by, (ys[ys.length - 1] ?? -Infinity) + MIN_GAP))
    const overflow = ys.length ? ys[ys.length - 1] - MAX_Y : 0
    if (overflow > 0) for (let i = 0; i < ys.length; i++) ys[i] -= overflow
    if (ys.length && ys[0] < MIN_Y) {
      const up = MIN_Y - ys[0]
      for (let i = 0; i < ys.length; i++) ys[i] += up
    }
    return new Map(items.map((it, i) => [it.categoryId, ys[i]]))
  }
  const placedY = new Map([...stackSide('l'), ...stackSide('r')])

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 320 }}>
      {drawn.map((s) => {
        if (s.sweep <= 0) return null
        if (s.pct >= 99.999) {
          return <circle key={s.categoryId} cx={cx} cy={cy} r={r} fill={s.color} />
        }
        const [x1, y1] = pt(s.start, r)
        const [x2, y2] = pt(s.end, r)
        const large = s.sweep > Math.PI ? 1 : 0
        return (
          <path
            key={s.categoryId}
            d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
            fill={s.color}
            stroke="var(--surface)"
            strokeWidth="1.9"
          />
        )
      })}

      {labels.map((s) => {
        const ty = placedY.get(s.categoryId) ?? s.by
        return (
          <g key={s.categoryId}>
            <polyline
              points={`${s.ex},${s.ey} ${s.bx},${s.by} ${s.side === 'l' ? s.tx + 4 : s.tx - 4},${ty}`}
              fill="none"
              stroke={s.color}
              strokeWidth="2.2"
            />
            <text x={s.tx} y={ty - 3} textAnchor={s.anchor} fontSize="13" fontWeight="600" fill="var(--text)">
              {s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name}
            </text>
            <text x={s.tx} y={ty + 13} textAnchor={s.anchor} fontSize="12" fill="var(--text)">
              {s.pct.toFixed(1)} %
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** 12-month income vs expense bars — reached from the Accounts screen chart button. */
export function TrendScreen({ month, onBack }: { month: string; onBack: () => void }) {
  const { db } = useStore()
  const data = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const m = addMonths(month, i - 11)
        return { month: m, ...totalsOf(txsInMonth(db, m)) }
      }),
    [db, month],
  )
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)))

  return (
    <Screen title="Trend" onBack={onBack}>
      <div className="px-3 py-5" style={{ background: 'var(--surface)' }}>
        <div className="flex items-end gap-1.5 h-44">
          {data.map((d) => (
            <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
              <div className="flex items-end gap-[2px] h-40 w-full justify-center">
                <div
                  className="w-1/2 rounded-t"
                  style={{
                    height: `${(d.income / max) * 150}px`,
                    background: 'var(--income)',
                    minHeight: d.income ? 2 : 0,
                  }}
                />
                <div
                  className="w-1/2 rounded-t"
                  style={{
                    height: `${(d.expense / max) * 150}px`,
                    background: 'var(--expense)',
                    minHeight: d.expense ? 2 : 0,
                  }}
                />
              </div>
              <span className="text-[9px]" style={{ color: 'var(--muted)' }}>
                {d.month.slice(5)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="h-2" />
      {data
        .slice()
        .reverse()
        .map((d) => (
          <div
            key={d.month}
            className="flex px-4 py-2.5 border-b text-[13px]"
            style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
          >
            <span className="w-16">{d.month.replace('-', '.')}</span>
            <Money value={d.income} kind="income" className="flex-1 text-right" />
            <Money value={d.expense} kind="expense" className="flex-1 text-right" />
            <Money value={d.total} kind="plain" className="flex-1 text-right" />
          </div>
        ))}
    </Screen>
  )
}
