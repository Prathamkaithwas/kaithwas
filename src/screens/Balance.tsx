import { useMemo, useState } from 'react'
import type { Balance } from '../types'
import { balanceOf, owingSince } from '../types'
import { useStore } from '../store'
import { Empty, Fab, Sheet } from '../components/ui'
import { HoldConfirm } from '../components/HoldConfirm'
import { formatMoney, toPaise } from '../lib/money'
import { dayLabel, todayKey } from '../lib/date'
import { hapticLight } from '../lib/haptics'

/**
 * Balance — who owes the shop money, and what has been paid back.
 *
 * The mirror of Loans, which tracks money going the other way on fixed terms.
 * This has no terms at all: someone takes goods on Tuesday and squares up
 * whenever they can, in whatever mixture of cash and kind suits them, and the
 * only questions that matter are how much is outstanding and how long it has
 * been that way.
 *
 * Sorted by how overdue the debt is rather than by size. A small amount owed
 * since March is the one worth a phone call; a large one from yesterday is
 * just business.
 */

function daysSince(key: string): number {
  const then = new Date(key + 'T12:00').getTime()
  return Math.max(0, Math.round((Date.now() - then) / 86400000))
}

function agingLabel(key: string | undefined): string {
  if (!key) return ''
  const d = daysSince(key)
  if (d === 0) return 'today'
  if (d === 1) return '1 day'
  if (d < 31) return `${d} days`
  const months = Math.round(d / 30.44)
  return months <= 1 ? '1 month' : `${months} months`
}

export function BalancePanel() {
  const { db } = useStore()
  const [editing, setEditing] = useState<Balance | 'new' | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [showSettled, setShowSettled] = useState(false)

  const rows = useMemo(() => {
    return db.balances
      .filter((b) => !b.archived)
      .map((b) => ({ b, due: balanceOf(b), since: owingSince(b) }))
      .sort((x, y) => {
        // Anyone square drops below anyone owing, whatever the amounts.
        const xOwes = x.due > 0
        const yOwes = y.due > 0
        if (xOwes !== yOwes) return xOwes ? -1 : 1
        if (xOwes && x.since && y.since) return x.since < y.since ? -1 : 1
        return x.b.name.localeCompare(y.b.name)
      })
  }, [db.balances])

  const settled = db.balances.filter((b) => b.archived)
  const owing = rows.filter((r) => r.due > 0)
  const total = owing.reduce((n, r) => n + r.due, 0)
  const current = open ? db.balances.find((b) => b.id === open) : undefined

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-content px-3 pt-3">
      {/* The one number the screen exists to show. Kept at the top rather
          than computed in your head from a list of rows. */}
      <div className="bal-total">
        <span className="bal-total-v num">{formatMoney(total, db.settings)}</span>
        <span className="bal-total-l">
          {owing.length === 0
            ? 'nothing outstanding'
            : `owed to you by ${owing.length} ${owing.length === 1 ? 'person' : 'people'}`}
        </span>
      </div>

      {rows.length === 0 && (
        <Empty text="Nobody on the book yet — tap + to add someone who owes you" />
      )}

      {rows.map(({ b, due, since }) => (
        <button key={b.id} className="bal-row" onClick={() => setOpen(b.id)}>
          <span className="bal-row-main">
            <span className="bal-row-name">{b.name}</span>
            {(b.note || b.phone) && (
              <span className="bal-row-sub">{b.note || b.phone}</span>
            )}
          </span>
          <span className="bal-row-right">
            <span className="bal-row-amt num" data-clear={due <= 0 || undefined}>
              {due > 0 ? formatMoney(due, db.settings) : due < 0 ? `+${formatMoney(-due, db.settings)}` : 'Settled'}
            </span>
            {due > 0 && since && (
              /* Aging is the point, so it is coloured by how old it is
                 rather than sitting as plain grey detail. */
              <span className="bal-row-age" data-old={daysSince(since) >= 30 || undefined}>
                {agingLabel(since)}
              </span>
            )}
            {due < 0 && <span className="bal-row-age">you owe them</span>}
          </span>
        </button>
      ))}

      {settled.length > 0 && (
        <div className="pt-4">
          <button
            className="bal-settled-toggle"
            onClick={() => setShowSettled((v) => !v)}
            aria-expanded={showSettled}
          >
            {showSettled ? 'Hide' : 'Show'} {settled.length} put away
          </button>
          {showSettled &&
            settled.map((b) => (
              <button key={b.id} className="bal-row" data-dim onClick={() => setOpen(b.id)}>
                <span className="bal-row-main">
                  <span className="bal-row-name">{b.name}</span>
                </span>
                <span className="bal-row-right">
                  <span className="bal-row-amt num" data-clear>
                    {formatMoney(balanceOf(b), db.settings)}
                  </span>
                </span>
              </button>
            ))}
        </div>
      )}

      <Fab onClick={() => setEditing('new')} />

      {current && <BalanceDetail balance={current} onClose={() => setOpen(null)} onEdit={() => {
        setEditing(current)
        setOpen(null)
      }} />}

      {editing && (
        <BalanceEditor
          balance={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/* ------------------------------ one person ------------------------------ */

function BalanceDetail({
  balance,
  onClose,
  onEdit,
}: {
  balance: Balance
  onClose: () => void
  onEdit: () => void
}) {
  const { db, removeBalanceEntry, archiveBalance, restoreBalance } = useStore()
  const [adding, setAdding] = useState<'took' | 'paid' | null>(null)

  const due = balanceOf(balance)
  const since = owingSince(balance)
  const lines = [...balance.entries].sort((a, b) => (a.date < b.date ? 1 : -1))

  /** Opens WhatsApp with the reminder already written. Deliberately stops
   *  there — you pick the chat and press send, the app never messages anyone
   *  on your behalf. */
  const remind = () => {
    const amount = formatMoney(due, db.settings)
    const text = since
      ? `${amount} pending since ${dayLabel(since)}`
      : `${amount} pending`
    const to = balance.phone ? balance.phone.replace(/[^\d]/g, '') : ''
    window.open(
      `https://wa.me/${to}?text=${encodeURIComponent(text)}`,
      '_blank',
    )
  }

  return (
    <Sheet open onClose={onClose} title={balance.name} full>
      <div className="p-4 space-y-4">
        <div className="bal-detail-head">
          <div>
            <div className="bal-detail-amt num" data-clear={due <= 0 || undefined}>
              {due > 0 ? formatMoney(due, db.settings) : due < 0 ? `+${formatMoney(-due, db.settings)}` : 'Settled'}
            </div>
            <div className="bal-detail-sub">
              {due > 0 && since
                ? `pending ${agingLabel(since)}`
                : due < 0
                  ? 'you owe them this'
                  : 'nothing outstanding'}
            </div>
          </div>
          <button className="bal-edit" onClick={onEdit}>
            Edit
          </button>
        </div>

        {balance.note && (
          <div className="text-[13.5px]" style={{ color: 'var(--muted)' }}>
            {balance.note}
          </div>
        )}

        <div className="flex gap-2">
          <button className="bal-act" data-took onClick={() => setAdding('took')}>
            + Took
          </button>
          <button className="bal-act" data-paid onClick={() => setAdding('paid')}>
            + Paid
          </button>
          {due > 0 && (
            <button className="bal-act" onClick={remind}>
              Remind
            </button>
          )}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--muted)' }}>
            History
          </div>
          {lines.length === 0 && (
            <div className="text-[13px]" style={{ color: 'var(--muted)' }}>
              Nothing recorded yet — start with what they took.
            </div>
          )}
          <div className="bal-lines">
            {lines.map((e) => (
              <div key={e.id} className="bal-line" data-kind={e.kind}>
                <span className="bal-line-main">
                  <span className="bal-line-date">{dayLabel(e.date)}</span>
                  {e.note && <span className="bal-line-note">{e.note}</span>}
                </span>
                <span className="bal-line-right">
                  <span className="bal-line-amt num">
                    {e.kind === 'took' ? '+' : '−'}
                    {formatMoney(e.amount, db.settings)}
                  </span>
                  {/* A settlement in goods is marked as such — counting it as
                      cash would overstate what came through the till. */}
                  {e.inKind && <span className="bal-line-kind">in kind</span>}
                </span>
                <HoldConfirm
                  label="Delete line"
                  onConfirm={() => removeBalanceEntry(balance.id, e.id)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {balance.archived ? 'put away' : 'hold to put away — history is kept'}
          </span>
          <span className="flex-1" />
          {balance.archived ? (
            <button
              className="text-[13px]"
              style={{ color: 'var(--accent)' }}
              onClick={() => restoreBalance(balance.id)}
            >
              Put back
            </button>
          ) : (
            <HoldConfirm
              label="Put away"
              color="var(--muted)"
              onConfirm={() => {
                archiveBalance(balance.id)
                onClose()
              }}
            />
          )}
        </div>
      </div>

      {adding && (
        <EntryEditor
          balanceId={balance.id}
          kind={adding}
          onClose={() => setAdding(null)}
        />
      )}
    </Sheet>
  )
}

/* ------------------------------ add a line ------------------------------ */

function EntryEditor({
  balanceId,
  kind,
  onClose,
}: {
  balanceId: string
  kind: 'took' | 'paid'
  onClose: () => void
}) {
  const { addBalanceEntry } = useStore()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayKey())
  const [inKind, setInKind] = useState(false)

  const save = () => {
    const paise = toPaise(amount || '0')
    if (paise <= 0) return
    hapticLight()
    addBalanceEntry(balanceId, {
      date,
      kind,
      amount: paise,
      note: note.trim() || undefined,
      inKind: kind === 'paid' && inKind ? true : undefined,
    })
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={kind === 'took' ? 'They took' : 'They paid'}>
      <div className="p-4 space-y-4">
        <input
          className="w-full border-b pb-2 text-[24px] num"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          placeholder="0"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />

        <input
          className="w-full border-b pb-2 text-[15px]"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          placeholder={kind === 'took' ? 'What for? (e.g. 2 bags cement)' : 'Note (optional)'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <input
          type="date"
          className="w-full border-b pb-2 text-[15px] num"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />

        {/* Only a settlement can be in kind — goods going *out* on credit is
            what "took" already means. */}
        {kind === 'paid' && (
          <div>
            <div className="text-[12px] mb-2" style={{ color: 'var(--muted)' }}>
              Paid with money, or settled with goods or work?
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold"
                style={{
                  background: !inKind ? 'var(--accent)' : 'var(--bg)',
                  color: !inKind ? '#fff' : 'var(--text-2)',
                }}
                onClick={() => setInKind(false)}
              >
                Money
              </button>
              <button
                className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold"
                style={{
                  background: inKind ? 'var(--accent)' : 'var(--bg)',
                  color: inKind ? '#fff' : 'var(--text-2)',
                }}
                onClick={() => setInKind(true)}
              >
                Goods or work
              </button>
            </div>
            {inKind && (
              <div className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
                Counts against what they owe, but stays marked as goods — so it
                never reads as cash that came in.
              </div>
            )}
          </div>
        )}

        <button
          className="w-full py-3 rounded-lg text-white text-[15px] font-semibold"
          style={{ background: 'var(--accent)' }}
          disabled={!amount.trim()}
          onClick={save}
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}

/* ------------------------------ the person ------------------------------ */

function BalanceEditor({
  balance,
  onClose,
}: {
  balance: Balance | null
  onClose: () => void
}) {
  const { addBalance, updateBalance, deleteBalance } = useStore()
  const [name, setName] = useState(balance?.name ?? '')
  const [phone, setPhone] = useState(balance?.phone ?? '')
  const [note, setNote] = useState(balance?.note ?? '')

  const save = () => {
    if (!name.trim()) return
    const payload = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      note: note.trim() || undefined,
    }
    if (balance) updateBalance({ ...balance, ...payload })
    else addBalance(payload)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={balance ? 'Edit person' : 'Add person'}>
      <div className="p-4 space-y-4">
        <input
          className="w-full border-b pb-2 text-[16px]"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <input
          className="w-full border-b pb-2 text-[15px] num"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          placeholder="Phone number"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <textarea
          className="w-full text-[14px] resize-none border-b pb-2"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          rows={3}
          placeholder="Details — which shop, whose brother, what was agreed"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="flex items-center gap-2 pt-2">
          {balance && (
            <>
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                hold to delete — the whole history goes
              </span>
              <HoldConfirm
                label="Delete person"
                onConfirm={() => {
                  deleteBalance(balance.id)
                  onClose()
                }}
              />
            </>
          )}
          <span className="flex-1" />
          <button
            className="flex-1 py-3 rounded-lg text-white text-[14px] font-semibold"
            style={{ background: 'var(--accent)' }}
            disabled={!name.trim()}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </Sheet>
  )
}
