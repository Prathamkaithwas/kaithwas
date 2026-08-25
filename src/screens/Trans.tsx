import { useMemo, useRef, useState } from 'react'
import type { ChecklistItem, Habit, Memo, Transaction } from '../types'
import { FIELD_LABEL, TYPE_LABEL } from '../types'
import { uid } from '../lib/seed'
import { Habits } from './Habits'
import { Sleep as SleepScreen } from './Sleep'
import { useStore } from '../store'
import {
  categoryLabel,
  expenseSplit,
  profitOf,
  totalsOf,
  txsInMonth,
  txsInRange,
} from '../lib/calc'
import {
  MONTHS_SHORT,
  WEEKDAYS,
  addMonths,
  calendarCells,
  dateToKey,
  inMonth,
  monthRange,
  parseISO,
  shortRange,
  todayKey,
  weekLabel,
  weeksOfMonth,
} from '../lib/date'
import { Bar, Empty, Money, Sheet, SummaryBar } from '../components/ui'
import { TxRow } from '../components/TxRow'
import { fileToPhoto, photosOf } from '../lib/photo'
import { PhotoCropper, NOTE_CARD_ASPECT } from '../components/PhotoCropper'

// Total, Loans, Stats, Accounts, Stock, Last Done and Kitee now live in the
// More menu — they are looked at occasionally, and giving them permanent
// slots pushed the day-to-day screens into a crowd.
export const TRANS_TABS = ['Daily', 'Niba', 'Habits', 'Sleep'] as const
export type TransTab = (typeof TRANS_TABS)[number]

/** Sub-tabs that show their own title instead of the date stepper. */
export const TITLE_TABS: readonly TransTab[] = ['Habits', 'Sleep']

/**
 * What colour each sub-tab makes the header.
 *
 * Three of these screens own a whole look — Habits its red sky over black,
 * Last Done its ink, Sleep its purple night — and the header used to sit
 * above all of them in the same flat grey, so the screen started at the top
 * of the content rather than at the top of the phone. Each tab now carries
 * its own ground and tint up into the bar, and the two cross-fade as you move
 * between tabs.
 *
 * `tint` drives the title, the travelling pill and the active label; `ground`
 * is the bar behind them. Both are plain colours rather than gradients on
 * purpose — a gradient cannot be transitioned, and the move between tabs is
 * the point.
 */
export const TAB_THEME: Record<TransTab, { tint: string; ground: string }> = {
  // The two ledger screens are the app's own furniture and stay on it.
  // Daily sits on the phoenix image now, and red read as invisible against
  // its own flame tones — black is the one colour that reads on both the
  // bright and dark parts of that photo.
  Daily: { tint: '#000000', ground: 'var(--surface)' },
  // Niba sits on the blossom photo now — the accent tint used to be free to
  // pick any hue, but a photo behind it means the label has to read against
  // whatever colour happens to be under it. Black, same call as Daily: the
  // header crop is the pale-sky part of the image, and black reads on both
  // the light and the deeper parts of it.
  Niba: { tint: '#000000', ground: 'var(--surface)' },
  // Habits sits on the castle photo now — red buried itself in the image
  // the same way it did on Daily. White reads better here than the black
  // Daily uses, since the castle is mostly a dark silhouette.
  // Habits sits on a drawn castle night now rather than the cross-stitch
  // photo. The ground matches the top of that sky exactly (--hab-deep in the
  // stylesheet, repeated here because the header sits outside .habit-screen
  // and cannot read it) so nothing shows through as a band at the join.
  Habits: { tint: '#ffffff', ground: '#08050f' },
  // Lavender on a deep purple ground. Kept in step with --slp-deep in the
  // stylesheet — the header sits outside .sleep-screen, so it cannot read
  // that variable and the value has to be repeated here.
  Sleep: { tint: '#977dff', ground: '#1c0b3d' },
  // Kitee moved into the More menu — see App.tsx's ExtraScreen, which now
  // carries this exact tint/ground pair for its own header instead.
}

/**
 * The sub-tabs in the order the owner arranged them.
 *
 * Forgiving in both directions: names that no longer exist are dropped, and
 * tabs added by a later build are appended rather than vanishing. A saved
 * order from an older version therefore keeps working, and a new tab always
 * shows up somewhere instead of being invisible until the setting is reset.
 */
export function orderedTransTabs(order?: string[]): readonly TransTab[] {
  if (!order?.length) return TRANS_TABS
  const known = order.filter((t): t is TransTab =>
    (TRANS_TABS as readonly string[]).includes(t),
  )
  return [...known, ...TRANS_TABS.filter((t) => !known.includes(t))]
}

export function Trans({
  sub,
  day,
  onEdit,
  editingMemo,
  onCloseMemo,
  editingHabit,
  onCloseHabit,
}: {
  sub: TransTab
  /** YYYY-MM-DD — the single day the Daily tab is focused on */
  day: string
  onEdit: (tx: Transaction) => void
  editingMemo: Memo | 'new' | null
  onCloseMemo: () => void
  editingHabit: Habit | 'new' | null
  onCloseHabit: () => void
}) {
  return (
    <>
      {sub === 'Daily' && <Daily day={day} onEdit={onEdit} />}
      {sub === 'Habits' && <Habits editing={editingHabit} onCloseEditor={onCloseHabit} />}
      {sub === 'Sleep' && <SleepScreen />}
      {sub === 'Niba' && (
        <NoteView editing={editingMemo} onCloseEditor={onCloseMemo} />
      )}
    </>
  )
}

/* ------------------------------ Daily ------------------------------ */

/** One day at a time — the header steps the date, this shows only that day. */
function Daily({ day, onEdit }: { day: string; onEdit: (tx: Transaction) => void }) {
  const { db } = useStore()
  const txs = useMemo(
    () =>
      db.transactions
        .filter((t) => t.date.slice(0, 10) === day)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [db.transactions, day],
  )
  const t = totalsOf(txs)
  const dt = parseISO(day + 'T12:00')
  const isToday = day === todayKey()

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <SummaryBar income={t.income} expense={t.expense} profit={profitOf(txs)} />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-content px-3 pt-1">
        {/* The list's subject line.
            These two siblings must not share a key — duplicates among siblings
            make React keep the previous day's nodes around.

            It used to read "31 Jul", which is word for word what the stepper
            in the bar directly above it already says — the same four
            characters twice within a thumb's width. The big numeral stays as
            the anchor, but the text beside it is now the weekday (which
            nothing else on screen tells you, and which is the thing that
            explains a quiet day) and the count of entries filed. */}
        <div key={`head-${day}`} className="flex items-baseline gap-2 px-2 pt-2 pb-1.5 animate-fade">
          <span className="text-[30px] font-bold num leading-none">{dt.getDate()}</span>
          <span className="text-[15px] font-semibold" style={{ color: 'var(--muted)' }}>
            {WEEKDAYS[dt.getDay()]}
          </span>
          <span className="flex-1" />
          {txs.length > 0 && (
            <span className="text-[12px] num" style={{ color: 'var(--muted)' }}>
              {txs.length} {txs.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
          {isToday && (
            <span
              className="text-[10px] px-2 py-[3px] rounded-md font-semibold tracking-wide"
              style={{
                background: 'color-mix(in srgb, var(--accent) 16%, var(--surface))',
                border: '1.5px solid color-mix(in srgb, var(--accent) 30%, var(--surface))',
                color: 'var(--accent)',
              }}
            >
              TODAY
            </span>
          )}
        </div>

        {/* No placeholder when the day is empty. An empty screen already says
            it is empty, and a glyph plus a sentence restating that is one more
            thing to read past on the screen opened most often. */}
        {txs.length > 0 && (
          /* Keyed on the day so stepping to another date replays the
             entrance — the list visibly arrives rather than blinking. */
          <div key={`list-${day}`} className="card overflow-hidden">
            {txs.map((tx, i) => (
              <div
                key={tx.id}
                className="animate-row"
                style={{
                  // capped so a busy day's last rows don't lag behind
                  animationDelay: `${Math.min(i, 12) * 22}ms`,
                  borderTop: i ? '1.5px solid var(--line)' : undefined,
                }}
              >
                <TxRow tx={tx} onEdit={onEdit} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ----------------------------- Calendar ----------------------------- */

function CalendarView({
  month,
  onEdit,
  onAdd,
}: {
  month: string
  onEdit: (tx: Transaction) => void
  onAdd: (date?: string) => void
}) {
  const { db } = useStore()
  const [day, setDay] = useState<string | null>(null)
  const txs = useMemo(() => txsInMonth(db, month), [db, month])
  const t = totalsOf(txs)

  const perDay = useMemo(() => {
    const m = new Map<string, { income: number; expense: number; marks: number }>()
    for (const tx of txs) {
      const k = tx.date.slice(0, 10)
      const cur = m.get(k) ?? { income: 0, expense: 0, marks: 0 }
      if (tx.type === 'income') cur.income += tx.amount
      else if (tx.type === 'expense') cur.expense += tx.amount
      if (photosOf(tx).length) cur.marks += 1
      m.set(k, cur)
    }
    for (const memo of db.memos) {
      const cur = m.get(memo.date) ?? { income: 0, expense: 0, marks: 0 }
      cur.marks += 1
      m.set(memo.date, cur)
    }
    return m
  }, [txs, db.memos])

  const cells = calendarCells(month, db.settings.firstDayOfWeek)
  const order = db.settings.firstDayOfWeek === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]
  const today = todayKey()
  const dayTxs = day ? db.transactions.filter((x) => x.date.slice(0, 10) === day) : []

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <SummaryBar income={t.income} expense={t.expense} profit={profitOf(txs)} />
      <div
        className="grid grid-cols-7 text-center text-[13px] py-1.5 border-b shrink-0"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        {order.map((i) => (
          <div
            key={i}
            style={{
              color: i === 0 ? 'var(--expense)' : i === 6 ? 'var(--income)' : 'var(--muted)',
            }}
          >
            {WEEKDAYS[i]}
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="grid grid-cols-7" style={{ background: 'var(--surface)' }}>
          {cells.map((cell) => {
            const key = dateToKey(cell)
            const isThisMonth = inMonth(key + 'T00:00', month, db.settings.monthStartDay)
            const d = perDay.get(key)
            const isToday = key === today
            const firstOfMonth = cell.getDate() === 1
            const dow = cell.getDay()
            return (
              <button
                key={key}
                onClick={() => setDay(key)}
                className="h-[112px] border-b border-r p-1 text-left flex flex-col"
                style={{ borderColor: 'var(--line)', opacity: isThisMonth ? 1 : 0.35 }}
              >
                <div className="flex items-start justify-between">
                  <span
                    className="text-[13px] px-1"
                    style={
                      isToday
                        ? { background: '#fff', color: '#111' }
                        : {
                            color:
                              dow === 0
                                ? 'var(--expense)'
                                : dow === 6
                                  ? 'var(--income)'
                                  : 'var(--text)',
                          }
                    }
                  >
                    {firstOfMonth ? `${cell.getDate()}.${cell.getMonth() + 1}` : cell.getDate()}
                  </span>
                  {!!d?.marks && (
                    <span className="flex gap-[2px] pt-[3px] pr-[2px]">
                      {Array.from({ length: Math.min(d.marks, 3) }, (_, i) => (
                        <span
                          key={i}
                          className="w-[7px] h-[7px] rounded-full border"
                          style={{ borderColor: 'var(--accent)' }}
                        />
                      ))}
                    </span>
                  )}
                </div>
                <span className="mt-auto w-full text-right leading-[1.35]">
                  {!!d?.income && (
                    <span className="block text-[11px]">
                      <Money value={d.income} kind="income" hideSymbol />
                    </span>
                  )}
                  {!!d?.expense && (
                    <span className="block text-[11px]">
                      <Money value={d.expense} kind="expense" hideSymbol />
                    </span>
                  )}
                  {!!d && (d.income || d.expense) ? (
                    <span className="block text-[11px]">
                      <Money value={d.income - d.expense} kind="plain" hideSymbol />
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <Sheet open={day !== null} onClose={() => setDay(null)} title={day ?? ''}>
        {dayTxs.length === 0 && <Empty text="Nothing on this day" />}
        {dayTxs.map((tx) => (
          <TxRow key={tx.id} tx={tx} onEdit={onEdit} />
        ))}
        <button
          className="w-full py-4 text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
          onClick={() => {
            const d = day
            setDay(null)
            onAdd(d ? `${d}T12:00` : undefined)
          }}
        >
          + Add on this day
        </button>
      </Sheet>
    </div>
  )
}

/* ----------------------------- Monthly ----------------------------- */

function Monthly({
  month,
  setMonth,
  onJump,
}: {
  month: string
  setMonth: (m: string) => void
  onJump: () => void
}) {
  const { db } = useStore()
  const year = month.slice(0, 4)
  const [expanded, setExpanded] = useState<string | null>(month)

  const rows = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const key = `${year}-${String(i + 1).padStart(2, '0')}`
        const range = monthRange(key, db.settings.monthStartDay)
        const end = new Date(range.end)
        end.setDate(end.getDate() - 1)
        return { key, index: i, range: { start: range.start, end }, ...totalsOf(txsInMonth(db, key)) }
      }),
    [db, year],
  )
  const sum = rows.reduce(
    (a, r) => ({ income: a.income + r.income, expense: a.expense + r.expense }),
    { income: 0, expense: 0 },
  )
  const yearProfit = useMemo(
    () => profitOf(db.transactions.filter((t) => t.date.slice(0, 4) === year)),
    [db.transactions, year],
  )
  const now = new Date()

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <SummaryBar income={sum.income} expense={sum.expense} profit={yearProfit} />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-content">
        {rows.map((r) => {
          const open = expanded === r.key
          const weeks = open
            ? weeksOfMonth(r.key, db.settings.monthStartDay, db.settings.firstDayOfWeek)
            : []
          return (
            <div key={r.key}>
              <button
                className="w-full flex items-center px-4 py-3 border-b text-left"
                style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
                onClick={() => setExpanded(open ? null : r.key)}
                onDoubleClick={() => {
                  setMonth(r.key)
                  onJump()
                }}
              >
                <div className="w-24">
                  <div className="text-[19px]">{MONTHS_SHORT[r.index]}</div>
                  <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
                    {r.range.start.getMonth() + 1}.{r.range.start.getDate()} ~{' '}
                    {r.range.end.getMonth() + 1}.{r.range.end.getDate()}
                  </div>
                </div>
                <div className="flex-1 text-right">
                  <div className="flex justify-end gap-6">
                    <Money value={r.income} kind="income" className="text-[15px]" />
                    <Money value={r.expense} kind="expense" className="text-[15px]" />
                  </div>
                  <Money value={r.total} kind="plain" className="text-[14px]" />
                </div>
              </button>

              {weeks.map((w) => {
                const wt = totalsOf(txsInRange(db, w.start, new Date(w.end.getTime() + 86399999)))
                const current = now >= w.start && now <= new Date(w.end.getTime() + 86399999)
                return (
                  <button
                    key={w.start.toISOString()}
                    className="w-full flex items-center px-4 py-2.5 border-b text-left"
                    style={{
                      borderColor: 'var(--line)',
                      background: current ? 'color-mix(in srgb, var(--expense) 22%, var(--surface))' : 'var(--surface)',
                    }}
                    onClick={() => {
                      setMonth(r.key)
                      onJump()
                    }}
                  >
                    <span className="w-32 text-[14px]" style={{ color: 'var(--text)' }}>
                      {weekLabel(w.start, w.end)}
                    </span>
                    <div className="flex-1 text-right">
                      <div className="flex justify-end gap-6">
                        <Money value={wt.income} kind="income" className="text-[14px]" />
                        <Money value={wt.expense} kind="expense" className="text-[14px]" />
                      </div>
                      <span className="text-[13px]" style={{ color: 'var(--muted)' }}>
                        {current && 'Total '}
                        <Money value={wt.total} kind="plain" className="text-[13px]" />
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------ Total ------------------------------ */

const TOTAL_VIEWS = ['Overview', 'Calendar', 'Monthly'] as const
type TotalView = (typeof TOTAL_VIEWS)[number]

export function Total({
  month,
  setMonth,
  onEdit,
  onAdd,
  onBudgetSetting,
  onExport,
  onJumpDaily,
}: {
  month: string
  setMonth: (m: string) => void
  onEdit: (tx: Transaction) => void
  onAdd: (date?: string) => void
  onBudgetSetting: () => void
  onExport: () => void
  onJumpDaily: () => void
}) {
  const [view, setView] = useState<TotalView>('Overview')

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div
        className="flex gap-2 px-4 py-2 border-b shrink-0"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        {TOTAL_VIEWS.map((v) => (
          <button
            key={v}
            className="px-4 py-1.5 rounded-full text-[13px]"
            style={{
              background: v === view ? 'var(--accent)' : 'var(--bg)',
              color: v === view ? '#fff' : 'var(--muted)',
            }}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </div>
      {view === 'Overview' && (
        <TotalOverview month={month} onBudgetSetting={onBudgetSetting} onExport={onExport} />
      )}
      {view === 'Calendar' && <CalendarView month={month} onEdit={onEdit} onAdd={onAdd} />}
      {view === 'Monthly' && <Monthly month={month} setMonth={setMonth} onJump={onJumpDaily} />}
    </div>
  )
}

function TotalOverview({
  month,
  onBudgetSetting,
  onExport,
}: {
  month: string
  onBudgetSetting: () => void
  onExport: () => void
}) {
  const { db } = useStore()
  const txs = useMemo(() => txsInMonth(db, month), [db, month])
  const t = totalsOf(txs)
  const profit = profitOf(txs)
  const split = expenseSplit(db, txs)

  const prev = addMonths(month, -1)
  const prevExpense = totalsOf(txsInMonth(db, prev)).expense
  const comparedPct = prevExpense ? Math.round((t.expense / prevExpense) * 100) : 100

  const { start, end } = monthRange(month, db.settings.monthStartDay)
  const lastDay = new Date(end)
  lastDay.setDate(lastDay.getDate() - 1)

  const monthBudgets = db.budgets.filter((b) => b.month === month)
  const totalBudget = monthBudgets.find((b) => !b.categoryId)?.amount ?? 0
  const catBudgets = monthBudgets.filter((b) => b.categoryId)
  const spentBy = new Map<string, number>()
  for (const tx of txs) {
    if (tx.type !== 'expense' || !tx.categoryId) continue
    spentBy.set(tx.categoryId, (spentBy.get(tx.categoryId) ?? 0) + tx.amount)
  }

  const line = (label: string, hint: string, value: React.ReactNode) => (
    <div className="flex items-center px-4 py-3">
      <span className="text-[15px]">
        {label} <span style={{ color: 'var(--muted)' }}>{hint}</span>
      </span>
      <span className="flex-1" />
      <span className="text-[15px]">{value}</span>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <SummaryBar income={t.income} expense={t.expense} profit={profitOf(txs)} />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-content">
        {/* Budget */}
        <div className="px-4 py-4 flex items-center gap-3" style={{ background: 'var(--surface)' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M3 16l7-7 4 4 7-7" />
            <path d="M3 20h18" />
          </svg>
          <span className="text-[21px] flex-1">Budget</span>
          <button
            className="px-4 py-2.5 rounded-lg text-[15px] flex items-center gap-1"
            style={{ background: 'var(--bg)', color: 'var(--muted)' }}
            onClick={onBudgetSetting}
          >
            Budget Setting <span className="text-[16px]">›</span>
          </button>
        </div>

        {totalBudget > 0 && (
          <div className="px-4 pb-4" style={{ background: 'var(--surface)' }}>
            <div className="flex justify-between text-[13px] mb-1.5">
              <span style={{ color: 'var(--muted)' }}>Total</span>
              <span>
                <Money value={t.expense} kind="expense" /> /{' '}
                <Money value={totalBudget} kind="plain" />
              </span>
            </div>
            <Bar
              pct={(t.expense / totalBudget) * 100}
              color={t.expense > totalBudget ? 'var(--expense)' : 'var(--accent)'}
            />
            {catBudgets.map((b) => {
              const cat = db.categories.find((c) => c.id === b.categoryId)
              if (!cat) return null
              const spent = spentBy.get(cat.id) ?? 0
              return (
                <div key={b.id} className="mt-3">
                  <div className="flex justify-between text-[13px] mb-1">
                    <span>
                      {categoryLabel(cat)}
                    </span>
                    <span style={{ color: 'var(--muted)' }}>
                      <Money value={spent} kind="plain" /> / <Money value={b.amount} kind="plain" />
                    </span>
                  </div>
                  <Bar
                    pct={(spent / b.amount) * 100}
                    color={spent > b.amount ? 'var(--expense)' : cat.color}
                  />
                </div>
              )
            })}
          </div>
        )}

        <div className="h-2" />

        {/* Accounts summary */}
        <div className="px-4 pt-4 pb-2 flex items-center gap-3" style={{ background: 'var(--surface)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <ellipse cx="12" cy="6" rx="8" ry="3" />
            <path d="M4 6v5c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
            <path d="M4 13v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5" />
          </svg>
          <span className="text-[21px] flex-1">Accounts</span>
          <span className="text-[15px]" style={{ color: 'var(--muted)' }}>
            {shortRange(start, lastDay)}
          </span>
        </div>

        <div className="px-4 pb-4" style={{ background: 'var(--surface)' }}>
          <div className="rounded-lg border" style={{ borderColor: 'var(--line)' }}>
            {line(
              profit < 0 ? FIELD_LABEL.loss : FIELD_LABEL.profit,
              '(noted on entries)',
              <Money
                value={Math.abs(profit)}
                kind={profit > 0 ? 'income' : profit < 0 ? 'expense' : 'plain'}
              />,
            )}
            {line(`Compared ${TYPE_LABEL.expense}`, '(Last month)', `${comparedPct}%`)}
            {line(
              TYPE_LABEL.expense,
              '(Cash, Accounts)',
              <Money value={split.cash} kind="plain" />,
            )}
            {line(TYPE_LABEL.expense, '(Card)', <Money value={split.card} kind="plain" />)}
            {line(
              TYPE_LABEL.transfer,
              '(Cash, Accounts→ )',
              <Money value={split.transfer} kind="plain" />,
            )}
          </div>

          <button
            className="mt-4 w-full py-4 rounded-lg border flex items-center justify-center gap-3 text-[16px]"
            style={{ borderColor: 'var(--line)' }}
            onClick={onExport}
          >
            <span className="text-[18px]">📊</span> Export data to Excel
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------- Note ------------------------------- */

/** How many gradient tones the note cards cycle through before repeating. */
const NIBA_TONES = 4

/**
 * The skins a note card can wear.
 *
 * The first four are the tones the cards already cycled through, given names
 * so one can be pinned to a note rather than shifting whenever the list
 * reorders. The rest are new, and deliberately not more of the same violets —
 * the complaint was that a page of notes read as one pale wash, which is what
 * happens when every card is a neighbouring shade of the screen behind it.
 *
 * Each is a gradient plus a sheen and a texture (see .niba-card in
 * index.css), so they read as a surface rather than a flat fill.
 */
const NOTE_SKINS = [
  'blossom',
  'orchid',
  'iris',
  'dusk',
  'sunset',
  'ocean',
  'forest',
  'ember',
  'gold',
  'ink',
] as const

export const NOTE_SKIN_LABEL: Record<string, string> = {
  blossom: 'Blossom',
  orchid: 'Orchid',
  iris: 'Iris',
  dusk: 'Dusk',
  sunset: 'Sunset',
  ocean: 'Ocean',
  forest: 'Forest',
  ember: 'Ember',
  gold: 'Gold',
  ink: 'Ink',
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z" />
    </svg>
  )
}

/**
 * Niba — notes, and nothing to do with the date the rest of the app is showing.
 *
 * These used to be filtered to the month in the header, which made the tab
 * behave like a ledger view: a note written in April was simply absent all
 * through May, and the screen said "Nothing written this month" as though the
 * note had never existed. A note is not an entry. It does not belong to the
 * period you happen to be browsing — it belongs to the day it was written on,
 * and it should still be there months later without having to go and find the
 * right month first.
 *
 * So: every note, newest first, grouped under its own date.
 */
function NoteView({
  editing,
  onCloseEditor,
}: {
  editing: Memo | 'new' | null
  onCloseEditor: () => void
}) {
  const { db, updateMemo } = useStore()
  const memos = useMemo(
    () => [...db.memos].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [db.memos],
  )

  const groups: [string, Memo[]][] = []
  for (const m of memos) {
    const last = groups[groups.length - 1]
    if (last && last[0] === m.date) last[1].push(m)
    else groups.push([m.date, [m]])
  }

  const [open, setOpen] = useState<Memo | null>(null)

  // A running index across the whole list rather than restarted per day —
  // so the gradient keeps cycling smoothly from one date group into the
  // next instead of every group starting back on the same pink.
  let cardIndex = 0

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden niba-screen">
      {/* A different photo from the header's own blossom crop, on purpose —
          the header stays put, this is the blurred backdrop behind the notes
          for the rest of the screen, same two-photo split Vault uses
          (a sharp lock-screen crop, a separate full-shell background). */}
      <div className="niba-bg" aria-hidden>
        <img src="/img/niba-galaxy.jpg" alt="" />
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar pb-content">
      {groups.map(([date, list]) => {
        const d = parseISO(date + 'T00:00')
        return (
          <div key={date} className="px-4 pt-5">
            {/* The year appears only when the note is not from this one. Now
                that the list runs the whole way back, "3.8 (Mon)" on its own
                could be this August or any earlier one; adding the year to
                every heading would be noise on the recent notes you actually
                read most. */}
            <div className="text-[15px] mb-2" style={{ color: 'var(--muted)' }}>
              {d.getDate()}.{d.getMonth() + 1}
              {d.getFullYear() !== new Date().getFullYear() && `.${d.getFullYear()}`} (
              {WEEKDAYS[d.getDay()]})
            </div>
            {list.map((m) => {
              const tone = cardIndex++ % NIBA_TONES
              return (
                <button
                  key={m.id}
                  className="niba-card w-full text-left mb-3"
                  // An unset skin still cycles through the original four by
                  // position, so notes written before skins existed look
                  // exactly as they did.
                  data-skin={m.skin ?? NOTE_SKINS[tone]}
                  style={
                    m.skin === 'custom' && m.customSkinImage
                      ? ({ '--shot': `url(${m.customSkinImage})` } as React.CSSProperties)
                      : undefined
                  }
                  onClick={() => setOpen(m)}
                >
                  <span
                    className="niba-star"
                    data-on={m.pinned || undefined}
                    role="button"
                    tabIndex={0}
                    aria-label={m.pinned ? 'Unstar note' : 'Star note'}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateMemo({ ...m, pinned: !m.pinned })
                    }}
                  >
                    <StarIcon filled={!!m.pinned} />
                  </span>
                  {m.title && <div className="niba-card-title">{m.title}</div>}
                  {m.body && <div className="niba-card-body">{m.body}</div>}
                  {!!m.checklist?.length && (
                    <div className="niba-checklist">
                      {m.checklist.slice(0, 4).map((it) => (
                        <span
                          key={it.id}
                          className="niba-check-item"
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation()
                            updateMemo({
                              ...m,
                              checklist: m.checklist!.map((x) =>
                                x.id === it.id ? { ...x, done: !x.done } : x,
                              ),
                            })
                          }}
                        >
                          <span className="chk-box" data-on={it.done || undefined} />
                          <span className="niba-check-text" data-done={it.done || undefined}>
                            {it.text}
                          </span>
                        </span>
                      ))}
                      {m.checklist.length > 4 && (
                        <span className="niba-check-more">+{m.checklist.length - 4} more</span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )
      })}
      </div>

      {(editing || open) && (
        <MemoEditor
          memo={editing === 'new' ? null : (editing ?? open)}
          defaultDate={todayKey()}
          onClose={() => {
            setOpen(null)
            onCloseEditor()
          }}
        />
      )}
    </div>
  )
}

function MemoEditor({
  memo,
  defaultDate,
  onClose,
}: {
  memo: Memo | null
  defaultDate: string
  onClose: () => void
}) {
  const { addMemo, updateMemo, deleteMemo } = useStore()
  // defaultDate is a full YYYY-MM-DD. It used to be the *month* being browsed
  // with today's day-of-month glued on, which produced the wrong date whenever
  // you were not looking at the current month — and an impossible one (a 31st
  // in a 30-day month) often enough to matter.
  const [date, setDate] = useState(memo?.date ?? defaultDate)
  const [title, setTitle] = useState(memo?.title ?? '')
  const [body, setBody] = useState(memo?.body ?? '')
  const [checklist, setChecklist] = useState<ChecklistItem[]>(memo?.checklist ?? [])
  const [newItem, setNewItem] = useState('')
  const [skin, setSkin] = useState<string | undefined>(memo?.skin)
  const [customSkinImage, setCustomSkinImage] = useState(memo?.customSkinImage)
  const [skinBusy, setSkinBusy] = useState(false)
  /** The freshly-picked photo, waiting to be framed. Held apart from
   *  `customSkinImage` so cancelling the cropper leaves whatever skin was
   *  already there untouched. */
  const [cropping, setCropping] = useState<string | null>(null)
  const skinFileRef = useRef<HTMLInputElement>(null)

  const addItem = () => {
    const text = newItem.trim()
    if (!text) return
    setChecklist((c) => [...c, { id: uid(), text, done: false }])
    setNewItem('')
  }
  const toggleItem = (id: string) =>
    setChecklist((c) => c.map((i) => (i.id === id ? { ...i, done: !i.done } : i)))
  const editItem = (id: string, text: string) =>
    setChecklist((c) => c.map((i) => (i.id === id ? { ...i, text } : i)))
  const removeItem = (id: string) => setChecklist((c) => c.filter((i) => i.id !== id))

  const save = () => {
    if (!title.trim() && !body.trim() && checklist.length === 0) return onClose()
    const payload = {
      date,
      title,
      body,
      checklist: checklist.length ? checklist : undefined,
      skin,
      customSkinImage,
    }
    if (memo) updateMemo({ ...memo, ...payload })
    else addMemo(payload)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={memo ? 'Edit note' : 'New note'} full>
      {/* Every field states its own colours. Left to inherit, with a
          transparent background, Android's dark-mode pass could read them as
          light surfaces and force the text dark — which is what made typing
          here look like it did nothing. */}
      <div className="p-4 space-y-4 h-full flex flex-col overflow-hidden">
        <input
          type="date"
          className="border-b pb-2 text-[15px] shrink-0"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          className="border-b pb-2 text-[17px] font-medium shrink-0"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar space-y-4">
          <textarea
            className="w-full resize-none text-[15px] leading-relaxed rounded-[var(--r-sm)] p-3"
            style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
            rows={4}
            placeholder="Write anything — loan details, reminders, account numbers…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />

          {/* The card's skin, previewed as the actual swatch it will wear
              rather than a colour dot — the gradients differ mostly in how
              they shade, which a flat dot cannot show. */}
          <div>
            <div className="text-[11px] mb-1.5" style={{ color: 'var(--muted)' }}>
              Card skin
            </div>
            <div className="niba-skins">
              <button
                className="niba-skin niba-skin-auto"
                data-on={skin === undefined || undefined}
                onClick={() => setSkin(undefined)}
                aria-label="Automatic skin"
                aria-pressed={skin === undefined}
              >
                Auto
              </button>
              {NOTE_SKINS.map((sk) => (
                <button
                  key={sk}
                  className="niba-skin"
                  data-skin={sk}
                  data-on={skin === sk || undefined}
                  onClick={() => setSkin(sk)}
                  aria-label={NOTE_SKIN_LABEL[sk]}
                  aria-pressed={skin === sk}
                />
              ))}
              {/* Same "goes straight to the picker" rule as the habit
                  surfaces — there is nothing to preview until a photo
                  actually exists. */}
              <button
                className="niba-skin niba-skin-custom"
                data-on={skin === 'custom' || undefined}
                style={
                  customSkinImage
                    ? ({ backgroundImage: `url(${customSkinImage})` } as React.CSSProperties)
                    : undefined
                }
                disabled={skinBusy}
                // With a photo already chosen this reopens the framing rather
                // than the file picker — adjusting it is the far more common
                // second visit, and "Another photo" inside covers the rest.
                onClick={() =>
                  customSkinImage ? setCropping(customSkinImage) : skinFileRef.current?.click()
                }
                aria-label="Custom photo skin"
                aria-pressed={skin === 'custom'}
              >
                {skinBusy ? '…' : customSkinImage ? '' : 'Photo'}
              </button>
              <input
                ref={skinFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  setSkinBusy(true)
                  try {
                    // Framed before it is committed — see PhotoCropper.
                    setCropping(await fileToPhoto(file))
                  } catch {
                    /* an unreadable file just leaves the previous skin alone */
                  } finally {
                    setSkinBusy(false)
                  }
                }}
              />
            </div>
          </div>

          {cropping && (
            <PhotoCropper
              src={cropping}
              aspect={NOTE_CARD_ASPECT}
              onCancel={() => setCropping(null)}
              // Stays open on purpose — see the same note on the habit
              // card's cropper. Cancelling the system picker used to leave
              // you with neither the new photo nor the framing you had.
              onPickAnother={() => skinFileRef.current?.click()}
              onDone={(shot) => {
                setCustomSkinImage(shot)
                setSkin('custom')
                setCropping(null)
              }}
            />
          )}

          <div>
            <div className="text-[11px] mb-1.5" style={{ color: 'var(--muted)' }}>
              Checklist
            </div>
            <div className="space-y-1">
              {checklist.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <button
                    className="chk-box shrink-0"
                    data-on={item.done || undefined}
                    aria-label={item.done ? 'Mark not done' : 'Mark done'}
                    onClick={() => toggleItem(item.id)}
                  />
                  <input
                    className="flex-1 min-w-0 text-[14px] py-1 border-b"
                    style={{
                      borderColor: 'var(--line)',
                      background: 'transparent',
                      color: item.done ? 'var(--muted)' : 'var(--text)',
                      textDecoration: item.done ? 'line-through' : undefined,
                    }}
                    value={item.text}
                    onChange={(e) => editItem(item.id, e.target.value)}
                  />
                  <button
                    className="shrink-0 text-[16px] leading-none px-1"
                    style={{ color: 'var(--muted)' }}
                    aria-label="Remove item"
                    onClick={() => removeItem(item.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="chk-box shrink-0" style={{ opacity: 0.4 }} />
                <input
                  className="flex-1 min-w-0 text-[14px] py-1 border-b"
                  style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
                  placeholder="Add an item"
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addItem()
                    }
                  }}
                  onBlur={addItem}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          {memo && (
            <button
              className="flex-1 py-3 rounded-lg text-[15px]"
              style={{ background: 'var(--bg)', color: 'var(--expense)' }}
              onClick={() => {
                deleteMemo(memo.id)
                onClose()
              }}
            >
              Delete
            </button>
          )}
          <button
            className="flex-1 py-3 rounded-lg text-white text-[15px] font-semibold"
            style={{ background: 'var(--accent)' }}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/** Income / Expenses pill toggle used by Stats. */
export function Toggle({
  value,
  onChange,
}: {
  value: 'expense' | 'income'
  onChange: (v: 'expense' | 'income') => void
}) {
  return (
    <div className="flex gap-2 px-4 py-2 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
      {(['expense', 'income'] as const).map((t) => {
        const active = t === value
        return (
          <button
            key={t}
            className="px-4 py-1.5 rounded-full text-[13px]"
            style={{
              background: active ? 'var(--accent)' : 'var(--bg)',
              color: active ? '#fff' : 'var(--muted)',
            }}
            onClick={() => onChange(t)}
          >
            {TYPE_LABEL[t]}
          </button>
        )
      })}
    </div>
  )
}
