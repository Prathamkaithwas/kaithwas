import { useStore } from '../store'
import { Screen, Money } from '../components/ui'
import { categoryName } from '../lib/calc'
import { hapticMedium } from '../lib/haptics'

/**
 * Everything the app has been told to delete.
 *
 * Nothing in Kaithwas actually destroys a record. Deleting an entry moves it
 * to `hiddenTransactions`, deleting a habit or a job sets `archived` — so the
 * thing leaves every list and every total, which is what "delete" is asked to
 * do, without leaving the database. This screen is where it all goes and the
 * only place it comes back from.
 *
 * It is deliberately not in the menu. The point of hiding an entry is that it
 * is out of the way; a Recycle Bin sitting in Settings would be one more row
 * to read past every time, and this is a screen for the rare bad day rather
 * than a daily destination. It opens on a long press of the version number in
 * the Settings header.
 *
 * There is no "delete permanently" here, on purpose. Adding one would put the
 * irreversible action back, one screen further along, and hand it to whoever
 * arrived because something had already gone wrong.
 */
export function Hidden({ onBack }: { onBack: () => void }) {
  const { db, restoreTx, restoreMemo, unarchiveHabit, unarchiveChore } = useStore()

  const txs = [...db.hiddenTransactions].sort((a, b) => (a.date < b.date ? 1 : -1))
  const memos = [...db.hiddenMemos].sort((a, b) => (a.date < b.date ? 1 : -1))
  const habits = db.habits.filter((h) => h.archived)
  const chores = db.chores.filter((c) => c.archived)
  const total = txs.length + memos.length + habits.length + chores.length

  const section = (label: string, count: number) =>
    count > 0 && (
      <div
        className="px-4 py-2 text-[11px] uppercase tracking-wide"
        style={{ background: 'var(--bg)', color: 'var(--muted)' }}
      >
        {label} · {count}
      </div>
    )

  const restoreButton = (fn: () => void) => (
    <button
      className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold"
      style={{ background: 'var(--surface-3)', color: 'var(--accent)' }}
      onClick={() => {
        hapticMedium()
        fn()
      }}
    >
      Restore
    </button>
  )

  return (
    <Screen title="Hidden" onBack={onBack}>
      <div className="px-4 py-3 text-[12px]" style={{ color: 'var(--text-2)' }}>
        {total === 0
          ? 'Nothing has been deleted. When something is, it waits here instead of going away.'
          : 'Deleted things are kept here rather than destroyed. Restoring puts one back exactly as it was.'}
      </div>

      {section('Entries', txs.length)}
      {txs.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-3 px-4 py-3 border-b"
          style={{ borderColor: 'var(--line)' }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[14px] truncate">
              {t.note || t.description || categoryName(db, t.categoryId) || 'Entry'}
            </div>
            <div className="text-[12px] num" style={{ color: 'var(--muted)' }}>
              {t.date.slice(0, 10)}
            </div>
          </div>
          <Money
            value={t.amount}
            kind={t.type === 'income' ? 'income' : t.type === 'expense' ? 'expense' : 'transfer'}
            className="text-[14px] font-semibold shrink-0"
          />
          {restoreButton(() => restoreTx(t.id))}
        </div>
      ))}

      {section('Notes', memos.length)}
      {memos.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-3 px-4 py-3 border-b"
          style={{ borderColor: 'var(--line)' }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[14px] truncate">{m.title || 'Note'}</div>
            <div className="text-[12px] num" style={{ color: 'var(--muted)' }}>
              {m.date}
            </div>
          </div>
          {restoreButton(() => restoreMemo(m.id))}
        </div>
      ))}

      {section('Habits', habits.length)}
      {habits.map((h) => (
        <div
          key={h.id}
          className="flex items-center gap-3 px-4 py-3 border-b"
          style={{ borderColor: 'var(--line)' }}
        >
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: h.color }} />
          <div className="flex-1 min-w-0 text-[14px] truncate">{h.name}</div>
          <span className="text-[12px] shrink-0" style={{ color: 'var(--muted)' }}>
            {db.habitLogs.filter((l) => l.habitId === h.id).length} days kept
          </span>
          {restoreButton(() => unarchiveHabit(h.id))}
        </div>
      ))}

      {section('Muskan', chores.length)}
      {chores.map((c) => (
        <div
          key={c.id}
          className="flex items-center gap-3 px-4 py-3 border-b"
          style={{ borderColor: 'var(--line)' }}
        >
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
          <div className="flex-1 min-w-0 text-[14px] truncate">{c.name}</div>
          <span className="text-[12px] shrink-0" style={{ color: 'var(--muted)' }}>
            {db.choreLogs.filter((l) => l.choreId === c.id).length} kept
          </span>
          {restoreButton(() => unarchiveChore(c.id))}
        </div>
      ))}

      <div className="h-16" />
    </Screen>
  )
}
