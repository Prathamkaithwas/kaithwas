import { useMemo, useState } from 'react'
import type { Loan } from '../types'
import { useStore } from '../store'
import { daysUntilEmi, nextEmiDate, parseISO } from '../lib/date'
import { formatAmount, toPaise } from '../lib/money'
import { analyseLoan, prepaymentEffect } from '../lib/loanMath'
import { AttachmentGrid, Bar, Empty, Fab, Money, Sheet } from '../components/ui'
import { HoldConfirm } from '../components/HoldConfirm'

/**
 * How far into its tenure a loan is, in wall-clock time — not payment
 * count, since this app doesn't track individual EMI payments. Only
 * produced when both dates are actually there and make sense as a range;
 * a missing or backwards end date just means there's nothing to show.
 */
function tenureProgress(loan: Loan): { pct: number; elapsedMonths: number; remainingMonths: number } | null {
  if (!loan.startDate || !loan.endDate) return null
  const start = parseISO(loan.startDate).getTime()
  const end = parseISO(loan.endDate).getTime()
  const totalDays = (end - start) / 86400000
  if (totalDays <= 0) return null
  const elapsedDays = Math.min(totalDays, Math.max(0, (Date.now() - start) / 86400000))
  const totalMonths = Math.max(1, Math.round(totalDays / 30.44))
  const elapsedMonths = Math.min(totalMonths, Math.round(elapsedDays / 30.44))
  return { pct: (elapsedDays / totalDays) * 100, elapsedMonths, remainingMonths: totalMonths - elapsedMonths }
}

export function Loans() {
  const { db } = useStore()
  const [editing, setEditing] = useState<Loan | 'new' | null>(null)
  const [insights, setInsights] = useState<Loan | null>(null)
  const loans = [...db.loans].filter((l) => !l.archived).sort((a, b) => a.order - b.order)

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-content px-3 pt-3">
      {loans.length === 0 && <Empty text="No loans tracked yet — tap + to add one" />}
      {loans.map((loan) => (
        <LoanCard
          key={loan.id}
          loan={loan}
          onOpen={() => setEditing(loan)}
          onInsights={() => setInsights(loan)}
        />
      ))}

      <Fab onClick={() => setEditing('new')} />

      {editing && <LoanEditor loan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {insights && <LoanInsights loan={insights} onClose={() => setInsights(null)} />}
    </div>
  )
}

/**
 * The whole cost of a loan, in one sheet.
 *
 * Everything here is derived from what was already recorded — principal,
 * rate, EMI, start date — so it needs no new data entry to become useful.
 * Ordered by what a borrower actually wants to know, in order: what do I
 * still owe, what will this have cost me in total, where is this month's
 * money going, and what would paying a little extra do.
 */
function LoanInsights({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const { db } = useStore()
  const a = useMemo(() => analyseLoan(loan), [loan])
  // A round, realistic top-up rather than a slider: the question being
  // answered is "is prepaying even worth it", and one concrete example
  // answers it better than a control to fiddle with.
  const extra = 100000 // ₹1,000 in paise
  const saved = useMemo(() => prepaymentEffect(loan, extra), [loan])

  const cell = (label: string, value: React.ReactNode, hint?: string) => (
    <div className="ld-stat">
      <span className="ld-stat-v">{value}</span>
      <span className="ld-stat-l">{label}</span>
      {hint && (
        <span className="block text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>
          {hint}
        </span>
      )}
    </div>
  )

  return (
    <Sheet open onClose={onClose} title={loan.lender}>
      <div className="p-4 space-y-4">
        {!a && (
          <div className="text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            Add the principal, the interest rate and the EMI to this loan and
            this page will work the rest out — what you still owe, what the
            loan costs in total, and what paying extra would save.
          </div>
        )}

        {a && (
          <>
            {/* The headline. Not the EMI and not the principal — the number
                that actually shrinks. */}
            <div className="rounded-[var(--r-md)] p-4" style={{ background: 'var(--surface-2)' }}>
              <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
                Still owed today
              </div>
              <div className="text-[28px] num">
                <Money value={a.outstanding} kind="plain" />
              </div>
              <div className="mt-2">
                <Bar pct={a.debtPct} color="var(--accent)" />
              </div>
              <div className="flex justify-between text-[11px] mt-1" style={{ color: 'var(--muted)' }}>
                <span>
                  <Money value={a.principalPaid} kind="plain" /> cleared
                </span>
                <span>{Math.round(a.debtPct)}% of principal</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {cell('EMIs paid', String(a.emisPaid), `of ${a.totalEmis}`)}
              {cell('EMIs left', String(a.emisLeft), a.payoffDate ? `ends ${a.payoffDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : undefined)}
              {cell('rate', `${a.ratePct}%`, 'per year')}
            </div>

            {/* What the loan costs, as opposed to what it was for. */}
            <div>
              <div className="text-[11px] mb-1.5" style={{ color: 'var(--muted)' }}>
                Over the whole loan
              </div>
              <div className="grid grid-cols-2 gap-2">
                {cell(
                  'interest',
                  <Money value={a.totalInterest} kind="expense" />,
                  loan.principal
                    ? `${Math.round((a.totalInterest / loan.principal) * 100)}% of principal`
                    : undefined,
                )}
                {cell('total repaid', <Money value={a.totalRepayment} kind="plain" />, 'principal + interest')}
              </div>
            </div>

            {/* Where this month's money actually goes — the part that makes
                the two bars on the card make sense. */}
            <div>
              <div className="text-[11px] mb-1.5" style={{ color: 'var(--muted)' }}>
                Your next {db.settings.currencySymbol}
                {(loan.emiAmount / 100).toLocaleString()} EMI splits
              </div>
              <div className="grid grid-cols-2 gap-2">
                {cell('to interest', <Money value={a.nextInterest} kind="expense" />, 'the lender keeps this')}
                {cell('off the loan', <Money value={a.nextPrincipal} kind="income" />, 'this is what shrinks')}
              </div>
            </div>

            {/* The one actionable thing on the page. */}
            {saved && (
              <div
                className="rounded-[var(--r-md)] p-3.5 text-[13px] leading-relaxed"
                style={{
                  background: 'color-mix(in srgb, var(--income) 12%, var(--surface-2))',
                  border: '1px solid color-mix(in srgb, var(--income) 30%, transparent)',
                }}
              >
                Paying <Money value={extra} kind="plain" /> extra each month would
                clear this <strong>{saved.monthsSaved} month{saved.monthsSaved === 1 ? '' : 's'}</strong> sooner
                and save <Money value={saved.interestSaved} kind="income" /> in interest.
              </div>
            )}

            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              Worked out from the principal, rate and EMI recorded on this
              loan, assuming every EMI is paid on time and the rate does not
              change. A floating-rate loan will drift from this.
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

function LoanCard({
  loan,
  onOpen,
  onInsights,
}: {
  loan: Loan
  onOpen: () => void
  onInsights: () => void
}) {
  const { db } = useStore()
  const days = daysUntilEmi(loan.emiDay)
  const due = nextEmiDate(loan.emiDay)
  const urgent = days <= (loan.reminderDaysBefore || 0)
  const dueLabel =
    days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days} days`
  const extras = (loan.fields ?? []).filter((f) => f.label.trim() && f.value.trim())
  const tenure = tenureProgress(loan)
  // Null whenever the loan lacks a principal, a rate or a workable EMI —
  // every figure below is then simply not drawn, rather than guessed at.
  const analysis = useMemo(() => analyseLoan(loan), [loan])

  return (
    <button
      className="w-full text-left rounded-[var(--r-md)] p-4 mb-3"
      style={{ background: 'var(--surface)' }}
      onClick={onOpen}
    >
      <div className="flex items-start gap-3 mb-3">
        <span
          className="w-11 h-11 rounded-[var(--r-md)] flex items-center justify-center text-[18px] shrink-0"
          style={{ background: 'var(--accent)' + '26' }}
        >
          🏦
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[16px] truncate">{loan.lender}</div>
          <div className="text-[12px] truncate" style={{ color: 'var(--muted)' }}>
            {loan.purpose}
          </div>
        </div>
        <div className="text-right shrink-0">
          <Money value={loan.emiAmount} kind="plain" className="text-[15px]" />
          <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
            /month
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[12px] mb-1.5">
        <span style={{ color: urgent ? 'var(--expense)' : 'var(--muted)' }}>
          {dueLabel} · {due.getDate()}.{due.getMonth() + 1}
        </span>
        {loan.reminderEnabled && (
          <span style={{ color: 'var(--accent)' }}>🔔 {loan.reminderDaysBefore}d before</span>
        )}
      </div>
      <Bar pct={Math.max(0, 100 - (days / 30) * 100)} color={urgent ? 'var(--expense)' : 'var(--accent)'} />

      {/* Only appears once both dates are actually in — a range with
          nothing on one end has no "how far along" to show. */}
      {tenure && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
            <span>
              {tenure.remainingMonths <= 0
                ? 'Tenure complete'
                : `${tenure.elapsedMonths} mo done`}
            </span>
            {/* Named now that a second bar sits under it. Unlabelled, the two
                look like two attempts at the same number rather than the two
                different things they are. */}
            <span>{tenure.remainingMonths > 0 ? `${tenure.remainingMonths} mo left · time` : 'time'}</span>
          </div>
          <Bar pct={tenure.pct} color="var(--income)" />
        </div>
      )}

      {/* The honest one. Time and debt are not the same journey: the early
          EMIs are mostly interest, so this bar trails the one above it for
          years. Showing them stacked is the entire point — the gap between
          them is the thing a borrower is never told. */}
      {analysis && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
            <span>
              <Money value={analysis.outstanding} kind="plain" /> still owed
            </span>
            <span>{Math.round(analysis.debtPct)}% cleared · debt</span>
          </div>
          <Bar pct={analysis.debtPct} color="var(--accent)" />
        </div>
      )}

      {(loan.principal || loan.interestRate) && (
        <div className="flex items-center gap-4 mt-2.5 text-[12px]" style={{ color: 'var(--muted)' }}>
          {!!loan.principal && (
            <span>
              Principal <Money value={loan.principal} kind="plain" hideSymbol /> {db.settings.currencySymbol}
            </span>
          )}
          {loan.interestRate && <span>{loan.interestRate}</span>}
          <span className="flex-1" />
          {/* A span rather than a button: this card is itself a button and
              nesting one inside another is invalid — the same role="button"
              pattern Niba's star uses to sit inside its own card. */}
          {analysis && (
            <span
              role="button"
              tabIndex={0}
              className="loan-more"
              onClick={(e) => {
                e.stopPropagation()
                onInsights()
              }}
            >
              Details
            </span>
          )}
        </div>
      )}

      {/* Whatever else was recorded on this loan. Only rows with both halves
          filled in — a label with no value is a note to self, not a fact. */}
      {extras.length > 0 && (
        <div className="mt-2 pt-2 border-t grid grid-cols-2 gap-x-4 gap-y-1" style={{ borderColor: 'var(--line)' }}>
          {extras.map((f, i) => (
            <div key={i} className="flex gap-1.5 min-w-0 text-[12px]">
              <span className="shrink-0" style={{ color: 'var(--muted)' }}>
                {f.label}
              </span>
              <span className="truncate">{f.value}</span>
            </div>
          ))}
        </div>
      )}
    </button>
  )
}

/** One tap instead of typing the label — the paperwork most loans come with. */
const LOAN_FIELD_SUGGESTIONS = [
  'Sanctioned',
  'Branch',
  'Agent',
  'Agent phone',
  'Sanction date',
  'Tenure',
  'Processing fee',
]

function LoanEditor({ loan, onClose }: { loan: Loan | null; onClose: () => void }) {
  const { db, addLoan, updateLoan, deleteLoan } = useStore()
  const [lender, setLender] = useState(loan?.lender ?? '')
  const [purpose, setPurpose] = useState(loan?.purpose ?? '')
  const [accountNumber, setAccountNumber] = useState(loan?.loanAccountNumber ?? '')
  const [principal, setPrincipal] = useState(loan?.principal ? formatAmount(loan.principal, db.settings) : '')
  const [interestRate, setInterestRate] = useState(loan?.interestRate ?? '')
  const [emiAmount, setEmiAmount] = useState(loan?.emiAmount ? formatAmount(loan.emiAmount, db.settings) : '')
  const [emiDay, setEmiDay] = useState(loan?.emiDay ?? 5)
  const [startDate, setStartDate] = useState(loan?.startDate ?? '')
  const [endDate, setEndDate] = useState(loan?.endDate ?? '')
  const [reminderEnabled, setReminderEnabled] = useState(loan?.reminderEnabled ?? true)
  const [reminderDaysBefore, setReminderDaysBefore] = useState(loan?.reminderDaysBefore ?? 1)
  const [notes, setNotes] = useState(loan?.notes ?? '')
  const [fields, setFields] = useState(loan?.fields ?? [])
  const [photos, setPhotos] = useState<string[]>(loan?.photos ?? [])
  const [permissionHint, setPermissionHint] = useState(false)

  const save = async () => {
    if (!lender.trim() || !purpose.trim()) return
    const emi = toPaise(emiAmount.replace(/,/g, '') || '0')
    if (emi <= 0) return

    if (reminderEnabled && 'Notification' in window && Notification.permission === 'default') {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') setPermissionHint(true)
    }

    const payload = {
      lender: lender.trim(),
      purpose: purpose.trim(),
      loanAccountNumber: accountNumber.trim() || undefined,
      principal: principal ? toPaise(principal.replace(/,/g, '')) : undefined,
      interestRate: interestRate.trim() || undefined,
      emiAmount: emi,
      emiDay: Math.min(31, Math.max(1, emiDay)),
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      reminderEnabled,
      reminderDaysBefore: Math.min(7, Math.max(0, reminderDaysBefore)),
      notes: notes.trim() || undefined,
      // an unlabelled row is a row someone started and abandoned
      fields: fields.filter((f) => f.label.trim()),
      photos: photos.length ? photos : undefined,
    }
    if (loan) updateLoan({ ...loan, ...payload })
    else addLoan(payload)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={loan ? 'Edit loan' : 'New loan'} full>
      <div className="p-4 space-y-4">
        <input
          className="w-full border-b pb-2 text-[16px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="Lender / Bank (e.g. PNB)"
          value={lender}
          onChange={(e) => setLender(e.target.value)}
          autoFocus
        />
        <input
          className="w-full border-b pb-2 text-[15px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="What is it for (e.g. Home Loan)"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        />
        <input
          className="w-full border-b pb-2 text-[14px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="Loan account number (optional)"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
        />

        <div className="flex gap-3">
          <label className="flex-1 block">
            <div className="text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
              EMI amount
            </div>
            <input
              className="w-full border-b pb-2 text-[15px] tabular-nums"
              style={{ borderColor: 'var(--line)' }}
              inputMode="decimal"
              placeholder="0.00"
              value={emiAmount}
              onChange={(e) => setEmiAmount(e.target.value)}
            />
          </label>
          <label className="w-24 block">
            <div className="text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
              EMI day
            </div>
            <select
              className="w-full border-b pb-2 text-[15px]"
              style={{ borderColor: 'var(--line)' }}
              value={emiDay}
              onChange={(e) => setEmiDay(Number(e.target.value))}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-3">
          <label className="flex-1 block">
            <div className="text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
              Principal (optional)
            </div>
            <input
              className="w-full border-b pb-2 text-[14px] tabular-nums"
              style={{ borderColor: 'var(--line)' }}
              inputMode="decimal"
              placeholder="0.00"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
            />
          </label>
          <label className="flex-1 block">
            <div className="text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
              Interest rate (optional)
            </div>
            <input
              className="w-full border-b pb-2 text-[14px]"
              style={{ borderColor: 'var(--line)' }}
              placeholder="e.g. 8% p.a."
              value={interestRate}
              onChange={(e) => setInterestRate(e.target.value)}
            />
          </label>
        </div>

        <div className="flex gap-3">
          <label className="flex-1 block">
            <div className="text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
              Start date (optional)
            </div>
            <input
              type="date"
              className="w-full border-b pb-2 text-[14px]"
              style={{ borderColor: 'var(--line)' }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="flex-1 block">
            <div className="text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
              End date (optional)
            </div>
            <input
              type="date"
              className="w-full border-b pb-2 text-[14px]"
              style={{ borderColor: 'var(--line)' }}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>

        <div className="rounded-lg p-3" style={{ background: 'var(--bg)' }}>
          <button
            className="flex items-center justify-between w-full text-[14px] mb-2"
            onClick={() => setReminderEnabled((v) => !v)}
          >
            <span>EMI reminder</span>
            <span
              className="w-10 h-6 rounded-full relative transition"
              style={{ background: reminderEnabled ? 'var(--accent)' : 'var(--line)' }}
            >
              <span
                className="absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all"
                style={{ left: reminderEnabled ? 18 : 2 }}
              />
            </span>
          </button>
          {reminderEnabled && (
            <div className="flex items-center gap-2 text-[13px]">
              <span style={{ color: 'var(--muted)' }}>Remind me</span>
              <select
                value={reminderDaysBefore}
                onChange={(e) => setReminderDaysBefore(Number(e.target.value))}
              >
                {[0, 1, 2, 3, 5, 7].map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? 'on the day' : `${d} day${d > 1 ? 's' : ''} before`}
                  </option>
                ))}
              </select>
            </div>
          )}
          {permissionHint && (
            <div className="text-[12px] mt-2" style={{ color: 'var(--expense)' }}>
              Notifications are blocked for this site — enable them in your browser settings for
              the reminder to actually show.
            </div>
          )}
          <div className="text-[11px] mt-2" style={{ color: 'var(--muted)' }}>
            Reminders fire while the app is open around the due date — this is an offline app
            with no server, so it can't wake your phone in the background like a bank SMS would.
          </div>
        </div>

        {/* Whatever this loan carries that the fixed rows above do not.
            Same label+value pattern as the vault and stock, because no two
            loans come with the same paperwork. */}
        {fields.length > 0 && (
          <div className="group-list">
            {fields.map((f, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2.5">
                <input
                  className="w-[92px] shrink-0 text-[12px]"
                  style={{ color: 'var(--muted)' }}
                  placeholder="Label"
                  value={f.label}
                  onChange={(e) =>
                    setFields((fs) => fs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <input
                  className="flex-1 min-w-0 text-[15px]"
                  placeholder="Value"
                  value={f.value}
                  onChange={(e) =>
                    setFields((fs) => fs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                  }
                />
                <button
                  className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center press"
                  style={{ color: 'var(--expense)' }}
                  aria-label={`Remove ${f.label || 'field'}`}
                  onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            className="px-3.5 py-1.5 rounded-full text-[13px] font-medium press"
            style={{
              background: 'color-mix(in srgb, var(--accent) 14%, var(--surface))',
              border: '1.5px solid color-mix(in srgb, var(--accent) 30%, var(--surface))',
              color: 'var(--accent)',
            }}
            onClick={() => setFields((fs) => [...fs, { label: '', value: '' }])}
          >
            + Add field
          </button>
          {LOAN_FIELD_SUGGESTIONS.filter(
            (sug) => !fields.some((f) => f.label.toLowerCase() === sug.toLowerCase()),
          ).map((sug) => (
            <button
              key={sug}
              className="px-3 py-1.5 rounded-full text-[12px] press"
              style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)', color: 'var(--muted)' }}
              onClick={() => setFields((fs) => [...fs, { label: sug, value: '' }])}
            >
              {sug}
            </button>
          ))}
        </div>

        {/* Sanction letter, agreement, EMI schedule — a picture or a PDF,
            same picker/viewer the vault uses. */}
        <AttachmentGrid files={photos} onChange={setPhotos} label="Attachments" />

        <textarea
          className="w-full text-[14px] resize-none border-b pb-2"
          style={{ borderColor: 'var(--line)' }}
          rows={2}
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex items-center gap-2 pt-2">
          {loan && (
            <>
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                hold to delete
              </span>
              <HoldConfirm label="Delete loan" onConfirm={() => { deleteLoan(loan.id); onClose() }} />
            </>
          )}
          <span className="flex-1" />
          <button
            className="flex-1 py-3 rounded-lg text-white text-[14px] font-semibold"
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
