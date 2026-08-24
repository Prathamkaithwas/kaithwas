import { useEffect, useRef, useState } from 'react'
import type { Category, DB, ImportantDate, RepeatFreq, RepeatRule, Settings } from '../types'
import { DEFAULT_JOURNAL_PROMPTS, FIELD_LABEL, TYPE_LABEL } from '../types'
import { useStore } from '../store'
import { ACCENT_PRESETS } from '../lib/seed'
import { formatAmount } from '../lib/money'
import { accountLabel, accountName, categoryLabel, categoryName } from '../lib/calc'
import { Confirm, Empty, Money, Row, Screen, SectionLabel, Sheet } from '../components/ui'
import { dayLabel, daysUntilDate, relativeDayLabel, todayKey, toLocalISO } from '../lib/date'
import { importMmbak, type ImportReport } from '../lib/mmbak'
import {
  daysSinceOffDevice,
  readAutoBackupState,
  saveFile,
  sendBackupOffDevice,
  type SaveResult,
} from '../lib/backup'
import { looksLikeBackup, normalizeDB } from '../lib/normalize'
import { AccountEditor } from './Accounts'
import { BudgetSetting } from './Budget'
import type { ExtraPage } from '../App'
import { orderedTransTabs } from './Trans'
import {
  decryptJSON,
  decryptText,
  deriveVaultKey,
  encryptJSON,
  encryptText,
  randomSaltB64,
} from '../lib/crypto'
import {
  CANARY,
  sequenceToLegacyPin,
  sequenceToPassphrase,
  type LockIconId,
} from '../lib/vaultConst'
import { VaultIconPad, VaultPinCells } from '../components/VaultIconPad'
import { HoldConfirm } from '../components/HoldConfirm'
import { hapticError, hapticLight, hapticMedium } from '../lib/haptics'

type Page = null | 'config' | 'pc' | 'backup' | 'style' | 'help' | 'feedback'

const CURRENCY_CODE: Record<string, string> = {
  '₹': 'INR', '₨': 'PKR', $: 'USD', '€': 'EUR',
  '£': 'GBP', '¥': 'JPY', '₦': 'NGN', AED: 'AED',
}

const TILES: [string, Page, string][] = [
  ['Configuration', 'config', 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5v.2a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z'],
  ['PC Manager', 'pc', 'M3 5h18v11H3zM8 20h8M12 16v4'],
  ['Backup', 'backup', 'M4 4v6h6M4 10a8 8 0 1 0 2.3-5.7L4 6.6'],
  ['Style', 'style', 'M12 3a9 9 0 100 18 2 2 0 001.7-3.1 2 2 0 011.7-3.1H18a3 3 0 003-3 9 9 0 00-9-8.8zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01'],
  ['Help', 'help', 'M12 17h.01M9.1 9a3 3 0 115.8 1c0 2-2.9 2.4-2.9 4M12 22a10 10 0 100-20 10 10 0 000 20z'],
  ['Feedback', 'feedback', 'M3 5h18v14H3zM3 5l9 7 9-7'],
]

/** Owner contact, shown on the Feedback screen. */
const INSTAGRAM = 'prathamkaihtwas'
const EMAIL = 'prathamkaithwas@gmail.com'

export type DeepLink = 'categories' | 'budget' | 'export'

/** Screens other tabs can jump straight into, without the More grid behind them. */
export function MoreScreens({
  month,
  request,
  onClose,
}: {
  month: string
  request: DeepLink | null
  onClose: () => void
}) {
  if (!request) return null
  if (request === 'categories') return <CategoryManager onBack={onClose} />
  if (request === 'budget') return <BudgetSetting month={month} onBack={onClose} />
  return <ExportCsv onBack={onClose} />
}

/** The screens that moved out of the bottom bar, in the order he uses them. */
const PAGES: [string, ExtraPage, string][] = [
  ['Total', 'total', 'M4 19h16M7 16V9M12 16V5M17 16v-4'],
  // Right after Total — same reasoning as its position in the FAB fan in
  // App.tsx (MENU_ROWS): the two get opened for the same kind of reason
  // more often than either is opened next to Stats.
  ['Khushi', 'kitee', 'M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z'],
  ['Stats', 'stats', 'M5 20V12M9.7 20V4M14.3 20v-6M19 20V8'],
  ['Accounts', 'accounts',
    'M12 4c4.4 0 8 1.1 8 2.5S16.4 9 12 9 4 7.9 4 6.5 7.6 4 12 4zM4 6.5v5C4 12.9 7.6 14 12 14s8-1.1 8-2.5v-5M4 11.5v5C4 17.9 7.6 19 12 19s8-1.1 8-2.5v-5'],
  ['Loans', 'loans', 'M3 10h18M3 10l2-5h14l2 5M5 10v9h14v-9M9 14h6'],
  ['Taruna', 'stock', 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10'],
  ['Muskan', 'lastDone',
    'M8 2v4M16 2v4M4 8h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM9 16l2 2 4-4'],
]

export function More({
  month,
  onOpenPage,
}: {
  month: string
  onOpenPage: (p: ExtraPage) => void
}) {
  const [page, setPage] = useState<Page>(null)

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-content">
      <SectionLabel>Books</SectionLabel>
      <div className="grid grid-cols-3 gap-y-7 px-4 pt-5 pb-2">
        {PAGES.map(([label, target, d]) => (
          <button
            key={label}
            className="flex flex-col items-center gap-2.5 press"
            onClick={() => onOpenPage(target)}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d={d} />
            </svg>
            <span className="text-[15px]">{label}</span>
          </button>
        ))}
      </div>

      <SectionLabel>Settings</SectionLabel>
      <div className="grid grid-cols-3 gap-y-7 px-4 pt-5">
        {TILES.map(([label, target, d]) => (
          <button
            key={label}
            className="flex flex-col items-center gap-3 press"
            onClick={() => setPage(target)}
          >
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d={d} />
            </svg>
            <span className="text-[15px]">{label}</span>
          </button>
        ))}
      </div>

      {page === 'config' && (
        <Configuration month={month} onBack={() => setPage(null)} />
      )}
      {page === 'pc' && <PcManager onBack={() => setPage(null)} />}
      {page === 'backup' && <Backup onBack={() => setPage(null)} />}
      {page === 'style' && <Style onBack={() => setPage(null)} />}
      {page === 'help' && <Help onBack={() => setPage(null)} />}
      {page === 'feedback' && <Feedback onBack={() => setPage(null)} />}
    </div>
  )
}

/* -------------------------- Important dates -------------------------- */

/** What the Settings row shows without opening anything: the next one due. */
function nextImportantLabel(dates: ImportantDate[]): string {
  const live = dates.filter((d) => !d.archived)
  if (!live.length) return 'None'
  const upcoming = live
    .map((d) => ({ d, days: daysUntilDate(d.date, d.yearly) }))
    .filter((x) => x.days >= 0)
    .sort((a, b) => a.days - b.days)[0]
  if (!upcoming) return `${live.length}`
  return `${upcoming.d.title} · ${relativeDayLabel(upcoming.days)}`
}

/**
 * Dates worth remembering, soonest first.
 *
 * Deliberately not a reminder system. He asked for a list he checks, not
 * something that buzzes — and the app can only raise a notification while it
 * is open anyway, so a promise to alert him would be one it could not keep.
 * What it can do honestly is answer "what is coming up" the moment he looks.
 *
 * One-offs that have been and gone fall to a past section rather than
 * vanishing; yearly ones never expire, they just roll to next year.
 */
/**
 * The questions the Mood sheet asks each day, as an editable list.
 *
 * How many there are is simply how many are in this list — a separate
 * "number of questions" control would either cap a list you can already see
 * the length of, or contradict it. Adding one is what makes it four; deleting
 * one is what makes it two.
 *
 * Editing happens in place, committed on blur, because the only thing a
 * question has is its text and a whole editor sheet for one line would be
 * more taps than rewriting it is worth.
 */
/** Only meaningful for a habit that carries a unit — a plain tick always
 *  shows the full year. See the `range` line in Habits.tsx's detail sheet. */
const HABIT_RANGE_LABEL: Record<'week' | 'month' | 'year', string> = {
  week: 'A week',
  month: 'A month',
  year: 'A year',
}

function nextHabitRange(r: 'week' | 'month' | 'year'): 'week' | 'month' | 'year' {
  return r === 'week' ? 'month' : r === 'month' ? 'year' : 'week'
}

function JournalPromptsSetting({ onBack }: { onBack: () => void }) {
  const {
    db,
    addJournalPrompt,
    updateJournalPrompt,
    deleteJournalPrompt,
    restoreDefaultJournalPrompts,
  } = useStore()
  const [adding, setAdding] = useState('')

  const prompts = [...db.journalPrompts].sort((a, b) => a.order - b.order)
  const missingDefaults = DEFAULT_JOURNAL_PROMPTS.some(
    (d) => !db.journalPrompts.some((p) => p.id === d.id),
  )

  const commitNew = () => {
    const q = adding.trim()
    if (!q) return
    addJournalPrompt(q)
    setAdding('')
  }

  return (
    <Screen title="Journal questions" onBack={onBack}>
      <div className="px-4 py-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
        Asked under the mood chips each day, in this order. Every answer is
        kept with that day and shows in the Journal.
      </div>

      {prompts.map((p) => (
        <div
          key={p.id}
          className="flex items-start gap-2 px-4 py-3 border-b"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
        >
          <textarea
            className="flex-1 min-w-0 text-[14.5px] leading-relaxed resize-none bg-transparent"
            // field-sizing is Chrome 123+; an older Android WebView ignores
            // it and falls back to these two rows, which fit every default
            // question and scroll for a longer one rather than clipping it.
            style={{ color: 'var(--text)', fieldSizing: 'content' } as React.CSSProperties}
            rows={2}
            defaultValue={p.question}
            onBlur={(e) => {
              const q = e.target.value.trim()
              // An emptied question is a delete by another name, but doing
              // that silently on blur would destroy a day's worth of answers
              // for a stray backspace — put the old text back instead and
              // leave deleting to the button that says so.
              if (!q) {
                e.target.value = p.question
                return
              }
              if (q !== p.question) updateJournalPrompt({ ...p, question: q })
            }}
          />
          <div className="shrink-0 pt-1">
            <HoldConfirm label={`Delete question`} onConfirm={() => deleteJournalPrompt(p.id)} />
          </div>
        </div>
      ))}

      {prompts.length === 0 && (
        <div className="px-4 py-6 text-[13px] text-center" style={{ color: 'var(--muted)' }}>
          No questions — the Mood sheet will just ask for a mood and a note.
        </div>
      )}

      <div className="p-4 space-y-3">
        <input
          className="w-full border-b pb-2 text-[14.5px]"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          placeholder="Add a question…"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitNew()
            }
          }}
          onBlur={commitNew}
        />
        <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
          Hold the ✕ beside a question to remove it. Answers already written
          stay with their day, and come back if you add the question again.
        </div>
        {missingDefaults && (
          <button
            className="text-[13px]"
            style={{ color: 'var(--accent)' }}
            onClick={restoreDefaultJournalPrompts}
          >
            Put the starting questions back
          </button>
        )}
      </div>
      <div className="h-8" />
    </Screen>
  )
}

function ImportantDates({ onBack }: { onBack: () => void }) {
  const { db, addImportantDate, updateImportantDate, archiveImportantDate, restoreImportantDate } =
    useStore()
  const [editing, setEditing] = useState<ImportantDate | 'new' | null>(null)
  const [showRemoved, setShowRemoved] = useState(false)

  const live = db.importantDates.filter((d) => !d.archived)
  const removed = db.importantDates.filter((d) => d.archived)

  const withDays = live
    .map((d) => ({ d, days: daysUntilDate(d.date, d.yearly) }))
    .sort((a, b) => a.days - b.days)
  const upcoming = withDays.filter((x) => x.days >= 0)
  const past = withDays.filter((x) => x.days < 0).reverse()

  const row = ({ d, days }: { d: ImportantDate; days: number }, dim = false) => (
    <button
      key={d.id}
      className="w-full flex items-center gap-3 px-4 py-3.5 border-b text-left"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)', opacity: dim ? 0.55 : 1 }}
      onClick={() => setEditing(d)}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[15px] truncate">
          {d.title}
          {d.yearly && (
            <span className="text-[11px] ml-2" style={{ color: 'var(--muted)' }}>
              every year
            </span>
          )}
        </div>
        <div className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
          {dayLabel(d.date)}
          {!d.yearly && ` ${d.date.slice(0, 4)}`}
          {d.note ? ` · ${d.note}` : ''}
        </div>
      </div>
      <span
        className="text-[12px] shrink-0 num"
        style={{ color: days >= 0 && days <= 7 ? 'var(--accent)' : 'var(--muted)' }}
      >
        {relativeDayLabel(days)}
      </span>
    </button>
  )

  return (
    <Screen
      title="Important dates"
      onBack={onBack}
      action={
        <button
          className="px-4 text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
          onClick={() => setEditing('new')}
        >
          Add
        </button>
      }
    >
      {live.length === 0 && (
        <Empty text="Nothing yet — add a birthday, an anniversary, a renewal" />
      )}

      {upcoming.length > 0 && <SectionLabel>Coming up</SectionLabel>}
      {upcoming.map((x) => row(x))}

      {past.length > 0 && <SectionLabel>Been and gone</SectionLabel>}
      {past.map((x) => row(x, true))}

      {removed.length > 0 && (
        <>
          <button
            className="w-full py-3 text-[13px]"
            style={{ color: 'var(--muted)' }}
            onClick={() => setShowRemoved((v) => !v)}
          >
            {showRemoved ? 'Hide' : `Show ${removed.length} removed`}
          </button>
          {showRemoved &&
            removed.map((d) => (
              <div
                key={d.id}
                className="w-full flex items-center gap-3 px-4 py-3 border-b"
                style={{ background: 'var(--surface)', borderColor: 'var(--line)', opacity: 0.6 }}
              >
                <span className="flex-1 text-[14px] truncate">{d.title}</span>
                <button
                  className="text-[13px]"
                  style={{ color: 'var(--accent)' }}
                  onClick={() => restoreImportantDate(d.id)}
                >
                  Restore
                </button>
              </div>
            ))}
        </>
      )}

      <div className="h-8" />

      {editing && (
        <ImportantDateEditor
          date={editing === 'new' ? null : editing}
          onRemove={(id) => {
            archiveImportantDate(id)
            setEditing(null)
          }}
          onSave={(d) => {
            if (editing === 'new') addImportantDate(d)
            else updateImportantDate({ ...editing, ...d })
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </Screen>
  )
}

function ImportantDateEditor({
  date,
  onSave,
  onRemove,
  onClose,
}: {
  date: ImportantDate | null
  onSave: (d: Omit<ImportantDate, 'id'>) => void
  onRemove: (id: string) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(date?.title ?? '')
  const [when, setWhen] = useState(date?.date ?? toLocalISO(new Date()).slice(0, 10))
  // Most dates worth writing down are birthdays and anniversaries, so the
  // repeating case is the default rather than the exception.
  const [yearly, setYearly] = useState(date?.yearly ?? true)
  const [note, setNote] = useState(date?.note ?? '')

  const save = () => {
    if (!title.trim()) return
    onSave({ title: title.trim(), date: when, yearly, note: note.trim() || undefined })
  }

  return (
    <Sheet open onClose={onClose} title={date ? 'Edit date' : 'New date'}>
      <div className="p-4 space-y-4">
        <input
          className="w-full border-b pb-2 text-[15px]"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          placeholder="What is it? e.g. Mummy's birthday"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />

        <input
          type="date"
          className="w-full border-b pb-2 text-[15px]"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />

        <button
          className="w-full flex items-center justify-between py-1"
          onClick={() => setYearly((v) => !v)}
        >
          <span className="text-[14px] text-left">
            Every year
            <span className="block text-[12px]" style={{ color: 'var(--muted)' }}>
              {yearly ? 'Comes round again each year' : 'Happens once, then it is past'}
            </span>
          </span>
          <span
            className="w-10 h-6 rounded-full relative shrink-0"
            style={{ background: yearly ? 'var(--accent)' : 'var(--line)' }}
          >
            <span
              className="absolute top-[2px] w-5 h-5 rounded-full bg-white transition-all"
              style={{ left: yearly ? 18 : 2 }}
            />
          </span>
        </button>

        <input
          className="w-full border-b pb-2 text-[14px]"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="flex gap-2 pt-1">
          {date && (
            <button
              className="flex-1 py-3 rounded-lg text-[14px]"
              style={{ background: 'var(--bg)', color: 'var(--expense)' }}
              onClick={() => onRemove(date.id)}
            >
              Remove
            </button>
          )}
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

/* --------------------------- Configuration --------------------------- */

function Configuration({ month, onBack }: { month: string; onBack: () => void }) {
  const { db, updateSettings } = useStore()
  const s = db.settings
  const [page, setPage] = useState<string | null>(null)
  const [sheet, setSheet] = useState<string | null>(null)
  const [pin, setPin] = useState('')

  const onOff = (v: boolean) => (v ? 'ON' : 'OFF')
  const flip = (k: keyof Settings) => updateSettings({ [k]: !s[k] } as Partial<Settings>)

  return (
    <Screen title="Configuration" onBack={onBack}>
      <SectionLabel>Accounts</SectionLabel>
      <Row label="Account Group" onClick={() => setPage('accountGroup')} />
      <Row label="Accounts Setting" onClick={() => setPage('accounts')} />
      <Row
        label="Transfer-Expense setting"
        value={onOff(s.transferAsExpense)}
        onClick={() => flip('transferAsExpense')}
      />
      <Row
        label="Card expenses display config"
        value={s.cardExpenseDisplay === 'atTheTime' ? 'A. At the time' : 'B. On payment'}
        onClick={() =>
          updateSettings({
            cardExpenseDisplay: s.cardExpenseDisplay === 'atTheTime' ? 'onPayment' : 'atTheTime',
          })
        }
      />

      <SectionLabel>Category/Repeat</SectionLabel>
      <Row label={`${TYPE_LABEL.income} Category Setting`} onClick={() => setPage('cat-income')} />
      <Row label={`${TYPE_LABEL.expense} Category Setting`} onClick={() => setPage('cat-expense')} />
      <Row label="Subcategory" value={onOff(s.subcategory)} onClick={() => flip('subcategory')} />
      <Row label="Budget Setting" onClick={() => setPage('budget')} />
      <Row label="Repeat Setting" onClick={() => setPage('repeat')} />

      <SectionLabel>Configuration</SectionLabel>
      {/* The code used to be hard-coded to INR, so picking dollars produced
          "INR ($)". It follows the symbol now. */}
      <Row
        label="Main Currency Setting"
        value={`${CURRENCY_CODE[s.currencySymbol] ?? 'Custom'} (${s.currencySymbol})`}
        onClick={() => setSheet('currency')}
      />
      {/* "Start Screen" used to pick between the Daily and Total sub-tabs.
          Total is a More page now, so Daily is always home and the row would
          have been a switch that did nothing. The setting itself stays in the
          data model so older backups still load. */}
      <Row label="Monthly Start Date" value={`Every ${s.monthStartDay}`} onClick={() => setSheet('monthStart')} />
      <Row
        label="Weekly Start Day"
        value={s.firstDayOfWeek === 0 ? 'Sunday' : 'Monday'}
        onClick={() => updateSettings({ firstDayOfWeek: s.firstDayOfWeek === 0 ? 1 : 0 })}
      />
      {/* "Carry-over Setting" is gone for the same reason as Start Screen
          above: nothing ever read `carryOver`. No total, balance or monthly
          figure in the app changes when it is flipped, so the row was a switch
          that reported a state it did not have — worse than absent, because it
          invites you to believe last month's closing balance is being brought
          forward when it is not. `carryOver` stays in the data model and in
          the .mmbak import so existing backups keep loading unchanged; only
          the control is withdrawn. Restore this row the day a calculation
          actually consumes the flag. */}
      {/* Three settings the app has always honoured but never offered a way
          to change — money.ts reads both of the first two on every amount it
          formats, and the habit graph reads the third. Unlike Start Screen
          and Carry-over above, each of these does something the moment it is
          flipped, which is the whole test for whether a row belongs here. */}
      <Row
        label="Decimals"
        value={s.decimals === 2 ? '2 (1,234.00)' : '0 (1,234)'}
        onClick={() => updateSettings({ decimals: s.decimals === 2 ? 0 : 2 })}
      />
      <Row
        label="Symbol position"
        value={s.symbolBefore ? `${s.currencySymbol}100` : `100${s.currencySymbol}`}
        onClick={() => updateSettings({ symbolBefore: !s.symbolBefore })}
      />
      <Row
        label="Habit graph range"
        value={HABIT_RANGE_LABEL[s.habitGraphRange ?? 'week']}
        onClick={() =>
          updateSettings({ habitGraphRange: nextHabitRange(s.habitGraphRange ?? 'week') })
        }
      />
      <Row
        label={`${TYPE_LABEL.income}-${TYPE_LABEL.expense} Color Setting`}
        value={`Set. ${s.colorSet}`}
        onClick={() => updateSettings({ colorSet: s.colorSet === 'A' ? 'B' : 'A' })}
      />
      <Row
        label="Time Input"
        value={s.timeInput ? 'Input Only, Desc.' : 'OFF'}
        onClick={() => flip('timeInput')}
      />
      <Row label="Show description" value={onOff(s.showDescription)} onClick={() => flip('showDescription')} />
      <Row label="Autocomplete" value={onOff(s.autocomplete)} onClick={() => flip('autocomplete')} />
      <Row
        label="Input order"
        value={s.inputOrder === 'amount' ? 'From Amount' : 'From Category'}
        onClick={() => updateSettings({ inputOrder: s.inputOrder === 'amount' ? 'category' : 'amount' })}
      />
      <Row label="Note button setting" value={onOff(s.noteButton)} onClick={() => flip('noteButton')} />
      <Row
        label="Keep unsaved entry"
        value={onOff(s.keepDraftEntry)}
        onClick={() => flip('keepDraftEntry')}
      />
      <Row label="Date format" value={s.dateFormat} onClick={() => setSheet('dateFormat')} />

      <SectionLabel>Other</SectionLabel>
      <Row
        label="Passcode"
        value={s.passcode ? 'ON' : 'OFF'}
        onClick={() => {
          if (s.passcode) updateSettings({ passcode: undefined })
          else {
            setPin('')
            setSheet('passcode')
          }
        }}
      />
      <Row
        label="Alarm Setting"
        value={s.reminderTime ?? 'OFF'}
        onClick={() => setSheet('alarm')}
      />
      <Row
        label="Important dates"
        value={nextImportantLabel(db.importantDates)}
        onClick={() => setPage('dates')}
      />
      <Row
        label="Journal questions"
        value={
          db.journalPrompts.length === 0
            ? 'None'
            : `${db.journalPrompts.length} question${db.journalPrompts.length === 1 ? '' : 's'}`
        }
        onClick={() => setPage('prompts')}
      />
      <Row label="Quick add" value={onOff(s.quickAdd)} onClick={() => flip('quickAdd')} />

      <SectionLabel>Vault</SectionLabel>
      <Row label="Vault lock" value="Change sequence" onClick={() => setSheet('vaultLock')} />
      <div className="h-8" />

      {page === 'accountGroup' && <AccountGroups onBack={() => setPage(null)} />}
      {page === 'accounts' && <AccountsSetting onBack={() => setPage(null)} />}
      {page === 'cat-income' && <CategoryManager fixedType="income" onBack={() => setPage(null)} />}
      {page === 'cat-expense' && <CategoryManager fixedType="expense" onBack={() => setPage(null)} />}
      {page === 'budget' && <BudgetSetting month={month} onBack={() => setPage(null)} />}
      {page === 'repeat' && <RepeatManager onBack={() => setPage(null)} />}
      {page === 'dates' && <ImportantDates onBack={() => setPage(null)} />}
      {page === 'prompts' && <JournalPromptsSetting onBack={() => setPage(null)} />}

      <Sheet open={sheet === 'currency'} onClose={() => setSheet(null)} title="Main currency">
        <div className="grid grid-cols-4 gap-2 p-4">
          {/* '@' used to head this list, which is the same encoding casualty
              that put an at-sign in DEFAULT_SETTINGS. Rupee leads now. */}
          {['₹', '₨', '$', '€', '£', '¥', '₦', 'AED'].map((c) => (
            <button
              key={c}
              className="py-3 rounded-lg text-[16px]"
              style={{
                background: c === s.currencySymbol ? 'var(--accent)' : 'var(--bg)',
                color: c === s.currencySymbol ? '#fff' : 'var(--text)',
              }}
              onClick={() => {
                updateSettings({ currencySymbol: c })
                setSheet(null)
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === 'monthStart'} onClose={() => setSheet(null)} title="Monthly start date">
        <div className="grid grid-cols-7 gap-1 p-4">
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <button
              key={d}
              className="py-2.5 rounded text-[13px]"
              style={{
                background: d === s.monthStartDay ? 'var(--accent)' : 'var(--bg)',
                color: d === s.monthStartDay ? '#fff' : 'var(--text)',
              }}
              onClick={() => {
                updateSettings({ monthStartDay: d })
                setSheet(null)
              }}
            >
              {d}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === 'dateFormat'} onClose={() => setSheet(null)} title="Date format">
        {(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const).map((f) => (
          <button
            key={f}
            className="w-full py-3.5 border-b text-[15px]"
            style={{ borderColor: 'var(--line)' }}
            onClick={() => {
              updateSettings({ dateFormat: f })
              setSheet(null)
            }}
          >
            {f}
          </button>
        ))}
      </Sheet>

      <Sheet open={sheet === 'alarm'} onClose={() => setSheet(null)} title="Alarm setting">
        <div className="p-4 space-y-4">
          <input
            type="time"
            className="w-full border-b pb-2 text-[18px]"
            style={{ borderColor: 'var(--line)' }}
            value={s.reminderTime ?? '21:00'}
            onChange={(e) => updateSettings({ reminderTime: e.target.value })}
          />
          <button
            className="w-full py-3 rounded-lg text-white text-[15px] font-semibold"
            style={{ background: 'var(--accent)' }}
            onClick={async () => {
              if ('Notification' in window) await Notification.requestPermission()
              setSheet(null)
            }}
          >
            Enable notifications
          </button>
          <button
            className="w-full py-3 rounded-lg text-[15px]"
            style={{ background: 'var(--bg)', color: 'var(--expense)' }}
            onClick={() => {
              updateSettings({ reminderTime: undefined })
              setSheet(null)
            }}
          >
            Turn off
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'passcode'} onClose={() => setSheet(null)} title="Set 4-digit passcode">
        <div className="p-6">
          <input
            className="w-full text-center text-[28px] tracking-[0.5em] border-b pb-2"
            style={{ borderColor: 'var(--line)' }}
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
          <button
            className="w-full mt-6 py-3 rounded-lg text-white font-semibold"
            style={{ background: 'var(--accent)' }}
            disabled={pin.length !== 4}
            onClick={() => {
              updateSettings({ passcode: pin })
              setSheet(null)
            }}
          >
            Set passcode
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'vaultLock'} onClose={() => setSheet(null)} title="Vault lock">
        <ChangeVaultLock onClose={() => setSheet(null)} />
      </Sheet>
    </Screen>
  )
}

/**
 * Change what unlocks Shafali — enter the current sequence, then pick and
 * confirm a new one, all inside one sheet rather than sending the owner
 * back out to the lock screen and in again. Every fresh install opens with
 * DEFAULT_LOCK_SEQUENCE (vaultConst.ts); this is how it gets changed to
 * something only the owner knows.
 */
function ChangeVaultLock({ onClose }: { onClose: () => void }) {
  const { db, setVaultSecurity, updateVaultItemCipher, updatePasswordItemCipher } = useStore()
  const [step, setStep] = useState<'verify' | 'choose' | 'confirm'>('verify')
  /** The key the current sequence derives, kept from the verify step so
   *  the confirm step can re-encrypt the vault with it. */
  const oldKey = useRef<CryptoKey | null>(null)
  const [sequence, setSequence] = useState<LockIconId[]>([])
  const [firstNew, setFirstNew] = useState<LockIconId[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const SEQUENCE_LEN = 4

  const onPick = (id: LockIconId) => {
    setError('')
    hapticLight()
    setSequence((s) => (s.length >= SEQUENCE_LEN ? s : [...s, id]))
  }
  const onBackspace = () => setSequence((s) => s.slice(0, -1))

  useEffect(() => {
    if (sequence.length !== SEQUENCE_LEN) return
    ;(async () => {
      if (step === 'verify') {
        if (!db.vaultSecurity) return
        setBusy(true)
        try {
          // Same legacy fallback as the lock screen — a vault still
          // provisioned by the digit build has to be able to get in here to
          // migrate itself off it. See sequenceToLegacyPin in vaultConst.ts.
          const salt = db.vaultSecurity.salt
          let key = await tryKey(sequenceToPassphrase(sequence), salt, db.vaultSecurity.check)
          if (!key) key = await tryKey(sequenceToLegacyPin(sequence), salt, db.vaultSecurity.check)
          if (!key) throw new Error('mismatch')
          // Held so the confirm step can decrypt every saved entry with it
          // and re-encrypt them under the new sequence.
          oldKey.current = key
          hapticMedium()
          setSequence([])
          setStep('choose')
          setBusy(false)
        } catch {
          hapticError()
          setError('Wrong sequence')
          setSequence([])
          setBusy(false)
        }
        return
      }
      if (step === 'choose') {
        setFirstNew(sequence)
        setSequence([])
        setStep('confirm')
        return
      }
      // step === 'confirm'
      if (sequence.join() === firstNew?.join()) {
        setBusy(true)
        const salt = randomSaltB64()
        const key = await deriveVaultKey(sequenceToPassphrase(sequence), salt)

        /**
         * Re-encrypt everything under the new key *before* swapping the
         * lock.
         *
         * This used to write the new salt and canary and nothing else, which
         * silently destroyed the vault: every item stays encrypted under the
         * key derived from the old sequence, and once the canary only
         * answers to the new one there is nothing left that can decrypt
         * them. Changing your lock emptied your vault, and the failure only
         * showed up later as a list of "Could not decrypt this entry".
         *
         * Built in full first and committed in one go, so a failure part way
         * through leaves the old lock and the old ciphers untouched rather
         * than half a vault under each key.
         */
        const prev = oldKey.current
        if (!prev) {
          setError('Something went wrong — start again')
          setStep('verify')
          setSequence([])
          setBusy(false)
          return
        }
        try {
          const vaultNext: { id: string; cipher: string }[] = []
          for (const item of db.vaultItems) {
            const plain = await decryptJSON<unknown>(prev, item.cipher)
            vaultNext.push({ id: item.id, cipher: await encryptJSON(key, plain) })
          }
          const pwNext: { id: string; cipher: string }[] = []
          for (const item of db.passwordItems) {
            const plain = await decryptJSON<unknown>(prev, item.cipher)
            pwNext.push({ id: item.id, cipher: await encryptJSON(key, plain) })
          }

          const check = await encryptText(key, CANARY)
          for (const v of vaultNext) updateVaultItemCipher(v.id, v.cipher)
          for (const v of pwNext) updatePasswordItemCipher(v.id, v.cipher)
          setVaultSecurity({ salt, check })
          hapticMedium()
          setBusy(false)
          onClose()
        } catch {
          // One unreadable item means the whole vault cannot be carried
          // across, and swapping the lock anyway would strand the rest.
          hapticError()
          setError('Could not move every entry across — lock unchanged')
          setStep('verify')
          setSequence([])
          setFirstNew(null)
          setBusy(false)
        }
      } else {
        hapticError()
        setError("Didn't match — try again from the new sequence")
        setFirstNew(null)
        setSequence([])
        setStep('choose')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequence])

  const label =
    step === 'verify' ? 'Enter the current sequence' : step === 'choose' ? 'Pick a new sequence' : 'Tap it again to confirm'

  return (
    <div className="p-4 flex flex-col items-center gap-4">
      {/* A plain dark card rather than the vault-hero's own styling — this
          sheet follows the app's light/dark setting like everything else
          in Settings, and vault-key/vault-pin-cell are hand-tuned for the
          lock screen's own permanent dark photo backdrop, not either
          theme. Wrapping them in one keeps the icons readable regardless
          of which theme is active. */}
      <div
        className="w-full rounded-2xl flex flex-col items-center gap-4 py-6"
        style={{ background: '#182234' }}
      >
        <div className="text-[13px] font-semibold" style={{ color: error ? 'var(--expense)' : 'rgba(255,255,255,0.75)' }}>
          {busy ? 'Checking…' : error || label}
        </div>
        <VaultPinCells length={SEQUENCE_LEN} filled={sequence.length} />
        <VaultIconPad onPick={onPick} onBackspace={onBackspace} disabled={busy} />
      </div>
    </div>
  )
}

function AccountGroups({ onBack }: { onBack: () => void }) {
  const { db } = useStore()
  const counts = new Map<string, number>()
  for (const a of db.accounts) counts.set(a.group, (counts.get(a.group) ?? 0) + 1)
  return (
    <Screen title="Account Group" onBack={onBack}>
      {[...counts.entries()].map(([g, n]) => (
        <Row key={g} label={g} value={`${n} account${n === 1 ? '' : 's'}`} />
      ))}
    </Screen>
  )
}

function AccountsSetting({ onBack }: { onBack: () => void }) {
  const { db, reorderAccounts } = useStore()
  const [editing, setEditing] = useState<(typeof db.accounts)[number] | 'new' | null>(null)
  const ordered = [...db.accounts].sort((a, b) => a.order - b.order)

  const move = (id: string, dir: -1 | 1) => {
    const ids = ordered.map((a) => a.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorderAccounts(ids)
  }

  return (
    <Screen
      title="Accounts Setting"
      onBack={onBack}
      action={
        <button className="px-4 text-[15px] font-semibold" style={{ color: 'var(--accent)' }} onClick={() => setEditing('new')}>
          Add
        </button>
      }
    >
      {ordered.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-2 px-4 py-3.5 border-b"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
        >
          <button className="flex-1 text-left text-[16px]" onClick={() => setEditing(a)}>
            {a.name}
            <span className="text-[12px] ml-2" style={{ color: 'var(--muted)' }}>
              {a.group}
            </span>
          </button>
          <button className="px-2" onClick={() => move(a.id, -1)}>
            ▲
          </button>
          <button className="px-2" onClick={() => move(a.id, 1)}>
            ▼
          </button>
        </div>
      ))}
      {editing && (
        <AccountEditor account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Screen>
  )
}

/* ---------------------------- Categories ---------------------------- */

const COLORS = [
  '#F4695D','#F58C4E','#F5C242','#C8DC4B','#7ED957','#3FC77F',
  '#35C5C0','#4C8CF5','#7E7BE8','#B476E5','#E36FB4','#9AA0A6',
]

export function CategoryManager({
  onBack,
  fixedType,
}: {
  onBack: () => void
  fixedType?: 'income' | 'expense'
}) {
  const { db, deleteCategory, reorderCategories } = useStore()
  const [type, setType] = useState<'expense' | 'income'>(fixedType ?? 'expense')
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const [subOf, setSubOf] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<Category | null>(null)

  const tops = db.categories
    .filter((c) => c.type === type && !c.parentId)
    .sort((a, b) => a.order - b.order)

  const move = (id: string, dir: -1 | 1) => {
    const ids = tops.map((c) => c.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorderCategories(ids)
  }

  /**
   * Same move, scoped to one parent's children rather than the top-level
   * list — Adarsh only trades places with his own siblings under Family, not
   * with Mummy's counterpart under some other category entirely.
   *
   * `reorderCategories` only touches ids it's handed, so renumbering these
   * siblings 0, 1, 2… doesn't disturb `order` on the top-level categories or
   * on any other parent's children, even though the numbers land on the same
   * field and start from the same zero.
   */
  const moveSub = (parentId: string, id: string, dir: -1 | 1) => {
    const siblings = db.categories
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.order - b.order)
    const ids = siblings.map((c) => c.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorderCategories(ids)
  }

  return (
    <Screen
      title={fixedType ? `${TYPE_LABEL[fixedType]} Category` : 'Categories'}
      onBack={onBack}
      action={
        <button className="px-4 text-[15px] font-semibold" style={{ color: 'var(--accent)' }} onClick={() => setEditing('new')}>
          Add
        </button>
      }
    >
      {!fixedType && (
        <div className="flex gap-2 p-3" style={{ background: 'var(--surface)' }}>
          {(['expense', 'income'] as const).map((t) => (
            <button
              key={t}
              className="flex-1 py-2 rounded-full text-[13px]"
              style={{
                background: t === type ? 'var(--accent)' : 'var(--bg)',
                color: t === type ? '#fff' : 'var(--muted)',
              }}
              onClick={() => setType(t)}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      {tops.map((c) => {
        const subs = db.categories
          .filter((x) => x.parentId === c.id)
          .sort((a, b) => a.order - b.order)
        return (
          <div key={c.id}>
            <div
              className="flex items-center gap-2 px-3 py-3 border-b"
              style={{
                background: 'var(--surface)',
                borderColor: 'var(--line)',
                borderLeft: `3px solid ${c.color}`,
              }}
            >
              <button className="flex-1 text-left text-[15px]" onClick={() => setEditing(c)}>
                {categoryLabel(c)}
              </button>
              <button className="px-1.5 text-[13px]" style={{ color: 'var(--muted)' }} onClick={() => setSubOf(c.id)}>
                +sub
              </button>
              <button className="px-1.5" onClick={() => move(c.id, -1)}>
                ▲
              </button>
              <button className="px-1.5" onClick={() => move(c.id, 1)}>
                ▼
              </button>
              <button className="px-1.5 text-[13px]" style={{ color: 'var(--expense)' }} onClick={() => setConfirmDel(c)}>
                ✕
              </button>
            </div>
            {subs.map((sc) => (
              <div
                key={sc.id}
                className="flex items-center gap-2 pl-10 pr-3 py-2.5 border-b"
                style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
              >
                <button className="flex-1 text-left text-[14px]" onClick={() => setEditing(sc)}>
                  {categoryLabel(sc)}
                </button>
                <button className="px-1.5" onClick={() => moveSub(c.id, sc.id, -1)}>
                  ▲
                </button>
                <button className="px-1.5" onClick={() => moveSub(c.id, sc.id, 1)}>
                  ▼
                </button>
                <button className="px-1.5 text-[13px]" style={{ color: 'var(--expense)' }} onClick={() => setConfirmDel(sc)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )
      })}

      {(editing || subOf) && (
        <CategoryEditor
          category={editing && editing !== 'new' ? editing : null}
          type={type}
          parentId={subOf ?? undefined}
          onClose={() => {
            setEditing(null)
            setSubOf(null)
          }}
        />
      )}

      <Confirm
        open={!!confirmDel}
        title={`Delete "${confirmDel?.name}"?`}
        body="Transactions in this category will be deleted."
        confirmLabel="Delete"
        danger
        onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && deleteCategory(confirmDel.id)}
      />
    </Screen>
  )
}

function CategoryEditor({
  category,
  type,
  parentId,
  onClose,
}: {
  category: Category | null
  type: 'expense' | 'income'
  parentId?: string
  onClose: () => void
}) {
  const { addCategory, updateCategory } = useStore()
  // categories are plain text — the name carries an emoji only if one is typed
  const [name, setName] = useState(categoryLabel(category ?? undefined))
  const [color, setColor] = useState(category?.color ?? COLORS[0])

  const save = () => {
    if (!name.trim()) return
    if (category) updateCategory({ ...category, name: name.trim(), icon: '', color })
    else addCategory({ name: name.trim(), type, icon: '', color, parentId })
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={category ? 'Edit category' : 'New category'}>
      <div className="p-4 space-y-4">
        <div>
          <input
            className="w-full border-b pb-2 text-[15px]"
            style={{ borderColor: 'var(--line)' }}
            placeholder="Category name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <div className="text-[12px] mt-1.5" style={{ color: 'var(--muted)' }}>
            Type an emoji into the name if you want one — e.g. "🔌 Switch".
          </div>
        </div>
        <div>
          <div className="text-[12px] mb-2" style={{ color: 'var(--muted)' }}>
            Color
          </div>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                className="w-8 h-8 rounded-full"
                style={{
                  background: c,
                  outline: c === color ? '2px solid var(--text)' : 'none',
                  outlineOffset: 2,
                }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <button
          className="w-full py-3 rounded-lg text-white font-semibold text-[15px]"
          style={{ background: 'var(--accent)' }}
          onClick={save}
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}

/* ------------------------------ Repeats ------------------------------ */

const FREQS: RepeatFreq[] = ['daily', 'weekly', 'monthly', 'yearly']

function RepeatManager({ onBack }: { onBack: () => void }) {
  const { db, deleteRepeat } = useStore()
  const [adding, setAdding] = useState(false)

  return (
    <Screen
      title="Repeat Setting"
      onBack={onBack}
      action={
        <button className="px-4 text-[15px] font-semibold" style={{ color: 'var(--accent)' }} onClick={() => setAdding(true)}>
          Add
        </button>
      }
    >
      {db.repeats.length === 0 && <Empty text="No repeating transactions" />}
      {db.repeats.map((r) => (
        <div
          key={r.id}
          className="px-4 py-3 border-b flex items-center gap-3"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[15px] truncate">
              {TYPE_LABEL[r.template.type]} ·{' '}
              {categoryName(db, r.template.categoryId) || '—'}
            </div>
            <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
              every {r.interval} {r.freq.replace('ly', r.interval > 1 ? 's' : '')} ·{' '}
              {accountName(db, r.template.accountId)}
              {r.lastRunDate ? ` · last ${r.lastRunDate.slice(0, 10)}` : ''}
            </div>
          </div>
          <Money
            value={r.template.amount}
            kind={r.template.type === 'income' ? 'income' : 'expense'}
            className="text-[15px]"
          />
          <button className="px-2 text-[13px]" style={{ color: 'var(--expense)' }} onClick={() => deleteRepeat(r.id)}>
            ✕
          </button>
        </div>
      ))}
      {adding && <RepeatEditor onClose={() => setAdding(false)} />}
    </Screen>
  )
}

function RepeatEditor({ onClose }: { onClose: () => void }) {
  const { db, addRepeat } = useStore()
  const [type, setType] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState(db.categories.find((c) => c.type === 'expense')?.id ?? '')
  const [accountId, setAccountId] = useState(db.accounts[0]?.id ?? '')
  const [note, setNote] = useState('')
  const [freq, setFreq] = useState<RepeatFreq>('monthly')
  const [interval, setInterval] = useState('1')
  const [startDate, setStartDate] = useState(toLocalISO(new Date()).slice(0, 10))

  const cats = db.categories.filter((c) => c.type === type && !c.parentId)

  const save = () => {
    const paise = Math.round(parseFloat(amount || '0') * 100)
    if (!paise || !categoryId || !accountId) return
    const rule: Omit<RepeatRule, 'id'> = {
      template: { type, amount: paise, categoryId, accountId, note, description: '' },
      freq,
      interval: Math.max(1, parseInt(interval || '1', 10)),
      startDate: `${startDate}T12:00`,
    }
    addRepeat(rule)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title="New repeating transaction">
      <div className="p-4 space-y-4">
        <div className="flex gap-2">
          {(['expense', 'income'] as const).map((t) => (
            <button
              key={t}
              className="flex-1 py-2 rounded-full text-[13px]"
              style={{
                background: t === type ? (t === 'expense' ? 'var(--expense)' : 'var(--income)') : 'var(--bg)',
                color: t === type ? '#fff' : 'var(--muted)',
              }}
              onClick={() => {
                setType(t)
                setCategoryId(db.categories.find((c) => c.type === t)?.id ?? '')
              }}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <input
          className="w-full border-b pb-2 text-[15px] tabular-nums"
          style={{ borderColor: 'var(--line)' }}
          inputMode="decimal"
          placeholder={FIELD_LABEL.amount}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <select
          className="w-full border-b pb-2 text-[15px]"
          style={{ borderColor: 'var(--line)' }}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          className="w-full border-b pb-2 text-[15px]"
          style={{ borderColor: 'var(--line)' }}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {db.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <input
          className="w-full border-b pb-2 text-[15px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="flex gap-3 items-center">
          <span className="text-[13px]" style={{ color: 'var(--muted)' }}>
            Every
          </span>
          <input
            className="w-14 border-b pb-1 text-center"
            style={{ borderColor: 'var(--line)' }}
            inputMode="numeric"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          />
          <select
            className="flex-1 border-b pb-1"
            style={{ borderColor: 'var(--line)' }}
            value={freq}
            onChange={(e) => setFreq(e.target.value as RepeatFreq)}
          >
            {FREQS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center justify-between text-[14px]">
          <span>Start date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>

        <button
          className="w-full py-3 rounded-lg text-white font-semibold text-[15px]"
          style={{ background: 'var(--accent)' }}
          onClick={save}
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}

/* -------------------------- Backup / Export -------------------------- */

function Backup({ onBack }: { onBack: () => void }) {
  const { db, replaceAll, mergeIn, reset } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const mmbakRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<DB | null>(null)
  const [imported, setImported] = useState<{ db: DB; report: ImportReport } | null>(null)
  const [importError, setImportError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [exportState, setExportState] = useState<SaveResult | 'saving' | null>(null)
  // Read once on open. It is written by the background job, not by this
  // screen, so there is nothing here to keep in sync.
  const [auto, setAuto] = useState(() => readAutoBackupState())
  const [sending, setSending] = useState<SaveResult | 'sending' | null>(null)
  const offDays = daysSinceOffDevice(todayKey())

  const sendOff = async () => {
    setSending('sending')
    const r = await sendBackupOffDevice(db, todayKey())
    setSending(r)
    setAuto(readAutoBackupState())
  }

  const doExport = async () => {
    setExportState('saving')
    const stamp = new Date().toISOString().slice(0, 10)
    setExportState(
      await saveFile(
        `pratham-ledger-${stamp}.json`,
        JSON.stringify(db),
        'application/json',
      ),
    )
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result))
        if (!looksLikeBackup(parsed)) throw new Error('bad file')
        setPending(normalizeDB(parsed))
      } catch {
        setImportError('That file is not a valid backup.')
      }
    }
    reader.readAsText(f)
    e.target.value = ''
  }

  const onMmbak = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setImportError('')
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      setImported(importMmbak(bytes))
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Could not read that backup file.',
      )
    }
  }

  return (
    <Screen title="Backup" onBack={onBack}>
      <div className="h-2" />
      <Row
        label="Backup to file · send to Drive"
        sub={
          exportState === 'saving'
            ? 'Saving…'
            : exportState && exportState.ok
              ? `Saved to ${exportState.where} — pick Drive in the share sheet to put a copy off the phone`
              : `${db.transactions.length} transactions · ${db.vaultItems.length + db.passwordItems.length} vault entries`
        }
        onClick={() => {
          void doExport()
        }}
      />
      {/* The share sheet has always opened after a manual backup, but nothing
          said so, so the one action that gets a copy off the phone was
          invisible. No Google sign-in involved: Drive is just one of the apps
          Android offers, alongside Telegram or anything else. */}
      <div className="px-4 py-2.5 text-[12px]" style={{ color: 'var(--text-2)' }}>
        Writes the file to the phone, then opens Android's share sheet. Choose
        <b> Save to Drive</b> there and the backup is off the device too — the
        only copy that survives losing the phone.
      </div>
      {exportState && exportState !== 'saving' && !exportState.ok && (
        <div className="px-4 py-3 text-[13px]" style={{ color: 'var(--expense)' }}>
          Backup failed — {exportState.where}. Nothing was written; do not
          reinstall until a backup succeeds.
        </div>
      )}
      <Row label="Restore from file" onClick={() => fileRef.current?.click()} />

      {/* The automatic backup is silent by design, which means the only way to
          know it is alive is to say so here. A row that said nothing would be
          indistinguishable from one that had been failing for months.

          Written out rather than passed to <Row>: Row disables itself when it
          has no onClick, and a disabled button greys its own text — this is a
          status line, not a dead control. */}
      <div
        className="w-full px-4 py-3.5 border-b text-[15px]"
        style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
      >
        Daily automatic backup
        <span className="block text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
          {auto?.error
            ? `Last attempt failed — ${auto.error}`
            : auto?.lastDate
              ? `Last saved ${auto.lastDate} to ${auto.where}`
              : 'Runs once a day when you open the app'}
        </span>
      </div>
      {auto?.error && (
        <div className="px-4 pb-3 text-[13px]" style={{ color: 'var(--expense)' }}>
          Automatic backups are not working. Use “Backup to file” above and keep
          that copy somewhere off the phone.
        </div>
      )}

      {/* The daily snapshot proves the books are written down. This is the
          separate question of whether they exist anywhere the phone's own
          bad luck cannot reach — a drawer of daily snapshots on a stolen
          phone is not a backup. Given its own block, and coloured by how
          long it has been, because it is the one that actually loses data. */}
      <div className="offdev" data-late={offDays === undefined || offDays >= 7 || undefined}>
        <div className="offdev-head">
          <span className="offdev-title">A copy off this phone</span>
          <span className="offdev-age">
            {offDays === undefined
              ? 'never sent'
              : offDays === 0
                ? 'sent today'
                : offDays === 1
                  ? 'sent yesterday'
                  : `${offDays} days ago`}
          </span>
        </div>
        <p className="offdev-body">
          {offDays === undefined || offDays >= 7
            ? 'Everything is on this one phone. If it is lost, stolen or broken, the daily backups go with it.'
            : 'Send one whenever you like — WhatsApp to yourself is enough.'}
        </p>
        <button className="offdev-btn" disabled={sending === 'sending'} onClick={sendOff}>
          {sending === 'sending' ? 'Preparing…' : 'Send a copy now'}
        </button>
        {sending && sending !== 'sending' && (
          <p className="offdev-result" data-bad={!sending.ok || undefined}>
            {sending.ok ? `Sent — also saved to ${sending.where}` : `Could not send — ${sending.where}`}
          </p>
        )}
      </div>

      <div className="h-2" />
      <Row
        label="Import Money Manager backup"
        sub="Reads a .mmbak file straight from the phone app"
        onClick={() => mmbakRef.current?.click()}
      />
      {importError && (
        <div className="px-4 py-3 text-[13px]" style={{ color: 'var(--expense)' }}>
          {importError}
        </div>
      )}
      <div className="h-2" />
      <Row label="Delete all data" danger onClick={() => setConfirmReset(true)} />
      <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onFile} />
      <input ref={mmbakRef} type="file" accept=".mmbak,application/octet-stream" className="hidden" onChange={onMmbak} />

      {imported && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50" onClick={() => setImported(null)} />
          <div className="relative w-full max-w-[340px] rounded-[var(--r-md)] p-5" style={{ background: 'var(--surface)' }}>
            <div className="font-semibold text-[16px] mb-3">Money Manager backup</div>
            <div className="text-[13px] space-y-1 mb-4" style={{ color: 'var(--muted)' }}>
              <div>{imported.report.transactions} transactions · {imported.report.range}</div>
              <div>{imported.report.accounts} accounts · {imported.report.categories} categories</div>
              <div>{imported.report.memos} notes</div>
              {imported.report.skipped > 0 && <div>{imported.report.skipped} rows skipped</div>}
              {imported.report.photosDropped > 0 && (
                <div style={{ color: 'var(--expense)' }}>
                  {imported.report.photosDropped} photos can't come across — the .mmbak stores
                  only their file names, not the images.
                </div>
              )}
            </div>
            <button
              className="w-full py-3 rounded-lg mb-2 text-[14px] text-white"
              style={{ background: 'var(--accent)' }}
              onClick={() => {
                replaceAll(imported.db)
                setImported(null)
                onBack()
              }}
            >
              Replace everything with this
            </button>
            <button
              className="w-full py-3 rounded-lg text-[14px]"
              style={{ background: 'var(--bg)' }}
              onClick={() => {
                mergeIn(imported.db)
                setImported(null)
                onBack()
              }}
            >
              Merge into current data
            </button>
            <button className="w-full py-3 text-[14px]" style={{ color: 'var(--muted)' }} onClick={() => setImported(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {pending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-8">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPending(null)} />
          <div className="relative w-full max-w-[320px] rounded-[var(--r-md)] p-5" style={{ background: 'var(--surface)' }}>
            <div className="font-semibold mb-1">Restore backup</div>
            <div className="text-[13px] mb-4" style={{ color: 'var(--muted)' }}>
              {pending.transactions.length} transactions in this file.
            </div>
            <button
              className="w-full py-3 rounded-lg mb-2 text-[14px]"
              style={{ background: 'var(--bg)' }}
              onClick={() => {
                mergeIn(pending)
                setPending(null)
                onBack()
              }}
            >
              Merge with current data
            </button>
            <button
              className="w-full py-3 rounded-lg text-[14px] text-white"
              style={{ background: 'var(--expense)' }}
              onClick={() => {
                replaceAll(pending)
                setPending(null)
                onBack()
              }}
            >
              Replace everything
            </button>
            <button className="w-full py-3 text-[14px]" style={{ color: 'var(--muted)' }} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <Confirm
        open={confirmReset}
        title="Delete all data?"
        body="This cannot be undone. Back up first."
        confirmLabel="Delete everything"
        danger
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          reset()
          onBack()
        }}
      />
    </Screen>
  )
}

export function ExportCsv({ onBack }: { onBack: () => void }) {
  const { db } = useStore()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [accountId, setAccountId] = useState('')
  const [state, setState] = useState<SaveResult | 'saving' | null>(null)

  const rows = db.transactions
    .filter((t) => (!from || t.date.slice(0, 10) >= from) && (!to || t.date.slice(0, 10) <= to))
    .filter(
      (t) =>
        !accountId ||
        t.accountId === accountId ||
        t.fromAccountId === accountId ||
        t.toAccountId === accountId,
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const doExport = async () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const header = ['Date','Time','Type','Category','Account','From','To',FIELD_LABEL.amount, FIELD_LABEL.profit, 'Deal','Fee','Note',FIELD_LABEL.description].join(',')
    const body = rows.map((t) =>
      [
        t.date.slice(0, 10),
        t.date.slice(11, 16),
        t.type,
        categoryName(db, t.categoryId),
        t.type === 'transfer' ? '' : accountLabel(db, t),
        accountName(db, t.fromAccountId),
        accountName(db, t.toAccountId),
        formatAmount(t.amount, { decimals: 2 }).replace(/,/g, ''),
        t.profit ? formatAmount(t.profit, { decimals: 2 }).replace(/,/g, '') : '',
        t.deal ?? '',
        t.fee ? formatAmount(t.fee, { decimals: 2 }).replace(/,/g, '') : '',
        t.note,
        t.description,
      ]
        .map((v) => esc(String(v ?? '')))
        .join(','),
    )
    setState('saving')
    // BOM so Excel reads ₹ and UTF-8 correctly
    setState(
      await saveFile(
        `pratham-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
        '﻿' + [header, ...body].join('\r\n'),
        'text/csv;charset=utf-8',
      ),
    )
  }

  return (
    <Screen title="Export data to Excel" onBack={onBack}>
      <div className="p-4 space-y-4" style={{ background: 'var(--surface)' }}>
        <label className="flex items-center justify-between text-[15px]">
          <span>From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center justify-between text-[15px]">
          <span>To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex items-center justify-between text-[15px]">
          <span>Account</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All accounts</option>
            {db.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="p-4">
        <button
          className="w-full py-3.5 rounded-lg text-white font-semibold text-[15px]"
          style={{ background: 'var(--accent)' }}
          onClick={() => {
            void doExport()
          }}
        >
          {state === 'saving' ? 'Saving…' : `Export ${rows.length} rows`}
        </button>
        {state && state !== 'saving' && (
          <div
            className="pt-3 text-[13px]"
            style={{ color: state.ok ? 'var(--muted)' : 'var(--expense)' }}
          >
            {state.ok ? `Saved to ${state.where}` : `Export failed — ${state.where}`}
          </div>
        )}
      </div>
    </Screen>
  )
}

function PcManager({ onBack }: { onBack: () => void }) {
  const [csv, setCsv] = useState(false)
  return (
    <Screen title="PC Manager" onBack={onBack}>
      <div className="p-4 text-[14px] leading-relaxed" style={{ color: 'var(--muted)' }}>
        Move data between this device and a computer. Everything stays on your device — nothing
        is uploaded anywhere.
      </div>
      <Row label="Export data to Excel (CSV)" onClick={() => setCsv(true)} />
      <Row label="Backup / Restore file" sub="Use the Backup tile on the More screen" />
      {csv && <ExportCsv onBack={() => setCsv(false)} />}
    </Screen>
  )
}

function Style({ onBack }: { onBack: () => void }) {
  const { db, updateSettings } = useStore()
  const s = db.settings
  const subTabs = orderedTransTabs(s.transTabOrder)

  /** Move one sub-tab up or down and save the whole arrangement. */
  const moveTab = (i: number, delta: number) => {
    const next = [...subTabs]
    const j = i + delta
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    updateSettings({ transTabOrder: next })
  }

  return (
    <Screen title="Style" onBack={onBack}>
      <div className="h-2" />

      {/* Which of Daily / Niba / Habits / Sleep comes first. The one at
          the top is what the app opens on and what Train returns you to, so
          this is really "which screen is home". */}
      <div
        className="px-4 py-3.5 border-b"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div className="text-[15px]">Tab order</div>
        <div className="text-[12px] mt-0.5 mb-2.5" style={{ color: 'var(--muted)' }}>
          The first one is where the app opens
        </div>
        {subTabs.map((t, i) => (
          <div
            key={t}
            className="flex items-center gap-2 py-1.5 border-t"
            style={{ borderColor: i ? 'var(--line)' : 'transparent' }}
          >
            <span className="text-[13px] num w-4" style={{ color: 'var(--muted)' }}>
              {i + 1}
            </span>
            <span className="flex-1 text-[14px]">{t}</span>
            <button
              className="w-9 h-9 rounded-[var(--r-sm)] text-[15px]"
              style={{ background: 'var(--bg)', opacity: i === 0 ? 0.35 : 1 }}
              disabled={i === 0}
              onClick={() => moveTab(i, -1)}
              aria-label={`Move ${t} up`}
            >
              ↑
            </button>
            <button
              className="w-9 h-9 rounded-[var(--r-sm)] text-[15px]"
              style={{ background: 'var(--bg)', opacity: i === subTabs.length - 1 ? 0.35 : 1 }}
              disabled={i === subTabs.length - 1}
              onClick={() => moveTab(i, 1)}
              aria-label={`Move ${t} down`}
            >
              ↓
            </button>
          </div>
        ))}
        {s.transTabOrder && (
          <button
            className="mt-2 text-[13px]"
            style={{ color: 'var(--muted)' }}
            onClick={() => updateSettings({ transTabOrder: undefined })}
          >
            Reset to default
          </button>
        )}
      </div>

      <Row
        label="Dark mode"
        right={
          <span
            className="w-10 h-6 rounded-full relative transition"
            style={{ background: s.darkMode ? 'var(--accent)' : 'var(--line)' }}
            onClick={() => updateSettings({ darkMode: !s.darkMode })}
          >
            <span
              className="absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all"
              style={{ left: s.darkMode ? 18 : 2 }}
            />
          </span>
        }
      />
      <div className="px-4 py-4 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
        <div className="text-[15px] mb-3">Accent color</div>
        <div className="flex gap-3">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              className="w-9 h-9 rounded-full"
              style={{
                background: c,
                outline: c === s.accent ? '2px solid var(--text)' : 'none',
                outlineOffset: 2,
              }}
              onClick={() => updateSettings({ accent: c })}
            />
          ))}
        </div>
      </div>
      <Row
        label="Income-Expenses Color"
        value={`Set. ${s.colorSet}`}
        onClick={() => updateSettings({ colorSet: s.colorSet === 'A' ? 'B' : 'A' })}
      />
    </Screen>
  )
}

function Help({ onBack }: { onBack: () => void }) {
  const items: [string, string][] = [
    ['Adding an entry', 'Tap +, choose Income / Expense / Transfer, tap the amount to open the calculator keypad, then Save. Continue saves and keeps the form open for the next entry.'],
    ['Monthly start date', 'Configuration → Monthly Start Date. Set it to your billing cycle day and every screen follows that cycle instead of the calendar month.'],
    ['Subcategories', 'Configuration → Expenses Category Setting → +sub on any category. Daily rows show the parent on top and the subcategory beneath.'],
    ['Notes', 'The Note tab holds free-form memos pinned to a date — loan details, reminders, account numbers.'],
    ['Backup', 'More → Backup writes a .json file you can keep anywhere. Restore lets you merge it with current data or replace everything.'],
    ['Where is my data?', 'Only on this device, in the browser storage. Nothing is sent to a server.'],
  ]
  return (
    <Screen title="Help" onBack={onBack}>
      {items.map(([q, a]) => (
        <div key={q} className="px-4 py-4 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
          <div className="text-[15px] mb-1">{q}</div>
          <div className="text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            {a}
          </div>
        </div>
      ))}
    </Screen>
  )
}

function Feedback({ onBack }: { onBack: () => void }) {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)
  return (
    <Screen title="Feedback" onBack={onBack}>
      <div className="p-4">
        <div className="text-[13px] mb-3" style={{ color: 'var(--muted)' }}>
          Notes to yourself about what to change next. Saved on this device.
        </div>
        <textarea
          className="w-full h-48 p-3 rounded-lg text-[15px] resize-none"
          style={{ background: 'var(--surface)' }}
          placeholder="What should this app do differently?"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setSaved(false)
          }}
        />
        <button
          className="w-full mt-4 py-3.5 rounded-lg text-white font-semibold text-[15px]"
          style={{ background: 'var(--accent)' }}
          onClick={() => {
            localStorage.setItem('feedback', text)
            setSaved(true)
          }}
        >
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>

      <SectionLabel>Contact</SectionLabel>
      {/* Opened through the system, so they hand off to the Instagram app and
          the mail app rather than trying to render anything in the WebView. */}
      <Row
        label="Instagram"
        value={`@${INSTAGRAM}`}
        onClick={() => window.open(`https://instagram.com/${INSTAGRAM}`, '_blank')}
      />
      <Row
        label="Email"
        value={EMAIL}
        onClick={() => window.open(`mailto:${EMAIL}`, '_blank')}
      />
    </Screen>
  )
}

/** Derives a key from `passphrase` and returns it only if it decrypts the
 *  stored canary — the one way to tell a right sequence from a wrong one
 *  without the passphrase ever being written down. */
async function tryKey(
  passphrase: string,
  salt: string,
  check: string,
): Promise<CryptoKey | null> {
  try {
    const key = await deriveVaultKey(passphrase, salt)
    return (await decryptText(key, check)) === CANARY ? key : null
  } catch {
    return null
  }
}
