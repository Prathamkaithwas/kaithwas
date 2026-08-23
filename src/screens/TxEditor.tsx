import { useEffect, useRef, useState } from 'react'
import type { Transaction, TxType } from '../types'
import { FIELD_LABEL, TYPE_LABEL } from '../types'
import { useStore } from '../store'
import { formatAmount } from '../lib/money'
import { formatDateLong, toLocalISO, parseISO } from '../lib/date'
import { accountName, categoryName } from '../lib/calc'
import { Keypad } from '../components/Keypad'
import { useBackHandler } from '../lib/back'
import {
  AccountPicker,
  CategoryPicker,
  DateTimePicker,
  SplitEditor,
} from '../components/pickers'
import { Confirm } from '../components/ui'
import { DealSlider } from '../components/DealSlider'
import { useSwipe } from '../lib/useSwipe'
import { hapticError, hapticMedium } from '../lib/haptics'
import { useToast } from '../components/Toast'
import { confetti } from '../lib/fx'
import { fileToPhoto, photosOf } from '../lib/photo'

const TYPES: TxType[] = ['income', 'expense', 'transfer']
const ACCENT: Record<TxType, string> = {
  income: 'var(--income)',
  expense: 'var(--expense)',
  transfer: 'var(--transfer)',
}

type Draft = Omit<Transaction, 'id'>

/**
 * Where an in-progress new entry is stashed — see Settings' "Keep unsaved
 * entry" toggle. `localStorage`, not React state: the whole reason this
 * exists is that plain in-memory state does not survive Android actually
 * killing the app's process for memory (which "go to another app and come
 * back" can trigger on a loaded phone, unlike just switching tabs *inside*
 * Kaithwas — TxEditor is mounted at the shell level and outlives that on
 * its own already, see App.tsx). `localStorage` is backed by the OS, so it
 * is still there after a real process restart.
 */
const DRAFT_STORAGE_KEY = 'kaithwas:txDraft'
/** Older than this, a stashed draft is more likely a stray leftover from a
 *  genuinely abandoned entry than something worth resurrecting unasked. */
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

function readStoredDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as { draft: Draft; savedAt: number }
    if (Date.now() - saved.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(DRAFT_STORAGE_KEY)
      return null
    }
    return saved.draft
  } catch {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    return null
  }
}

function clearStoredDraft() {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch {
    /* nothing to clear if storage isn't available in the first place */
  }
}

export function TxEditor({
  initial,
  editingId,
  onClose,
  onSaved,
  onManageCategories,
}: {
  initial: Partial<Draft>
  editingId?: string
  onClose: () => void
  /** fired after a successful write with the entry's date, so the shell can
   *  land you on the day that entry actually belongs to */
  onSaved?: (date: string) => void
  onManageCategories?: () => void
}) {
  const { db, addTx, updateTx, deleteTx } = useStore()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const saveBtn = useRef<HTMLButtonElement>(null)

  // Only for a genuinely blank new entry — `initial` carrying anything
  // (duplicate, a share-in, "add on this specific day") is a deliberate
  // prefill that a leftover draft from some earlier, unrelated attempt must
  // not silently overwrite.
  const eligibleForDraftPersistence = !editingId && Object.keys(initial).length === 0

  const [draft, setDraft] = useState<Draft>(() => {
    // Restored *inside* the initializer, not a useEffect that runs after
    // first paint and calls setDraft — the persist-effect below runs in that
    // same post-paint pass too, on whatever `draft` closure it captured at
    // mount (the plain blank default, since the restore's setDraft hadn't
    // landed yet), and immediately overwrote the just-restored value in
    // storage with that blank one. Restoring here means the very first
    // render already has the right value, so persist has nothing stale left
    // to clobber it with.
    if (eligibleForDraftPersistence && db.settings.keepDraftEntry) {
      const stored = readStoredDraft()
      if (stored) return stored
    }
    return {
      // A new entry starts on Income: this is a shop counter, and takings
      // are what gets logged most. Expense is one tap (or one swipe) away.
      type: initial.type ?? 'income',
      date: initial.date ?? toLocalISO(new Date()),
      amount: initial.amount ?? 0,
      profit: initial.profit ?? 0,
      deal: initial.deal,
      splits: initial.splits,
      categoryId: initial.categoryId,
      accountId: initial.accountId ?? db.accounts[0]?.id,
      fromAccountId: initial.fromAccountId ?? db.accounts[0]?.id,
      toAccountId: initial.toAccountId ?? db.accounts[1]?.id,
      fee: initial.fee ?? 0,
      note: initial.note ?? '',
      description: initial.description ?? '',
      photos: photosOf(initial),
    }
  })

  useEffect(() => {
    if (!eligibleForDraftPersistence || !db.settings.keepDraftEntry) return
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ draft, savedAt: Date.now() }))
    } catch {
      /* storage full or unavailable — the draft just won't survive, same as
         the setting being off */
    }
  }, [draft, eligibleForDraftPersistence, db.settings.keepDraftEntry])

  const [keypad, setKeypad] = useState<null | 'amount' | 'profit'>(
    !editingId && db.settings.inputOrder === 'amount' ? 'amount' : null,
  )
  // A new entry walks itself forward: keypad → category → account, then stops
  // and leaves you on the form. Editing an existing entry never chains.
  const [guided, setGuided] = useState(
    !editingId && db.settings.inputOrder === 'amount',
  )
  const [feeKeypad, setFeeKeypad] = useState(false)
  const [catPicker, setCatPicker] = useState(false)
  const [datePicker, setDatePicker] = useState(false)
  const [accPicker, setAccPicker] = useState<null | 'account' | 'from' | 'to'>(null)
  const [splitEditor, setSplitEditor] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  /** index of the photo being viewed full-screen, or null */
  const [photoOpen, setPhotoOpen] = useState<number | null>(null)
  /** true while picked files are being decoded and downscaled */
  const [photoBusy, setPhotoBusy] = useState(false)
  // Which of the three cards you are working in. Whatever you last
  // touched or typed into carries a lit outline, so on a long form it is
  // always obvious where the keyboard is pointing.
  const [activeCard, setActiveCard] = useState(0)

  const accent = ACCENT[draft.type]
  const shots = draft.photos ?? []
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  // Back closes whatever is stacked on top of the editor before the editor
  // itself — the shell registered the editor's own handler, so pressing back
  // here never quits the app mid-entry.
  useBackHandler(keypad !== null, () => setKeypad(null))
  useBackHandler(feeKeypad, () => setFeeKeypad(false))
  useBackHandler(catPicker, () => setCatPicker(false))
  useBackHandler(accPicker !== null, () => setAccPicker(null))
  useBackHandler(datePicker, () => setDatePicker(false))
  useBackHandler(splitEditor, () => setSplitEditor(false))
  useBackHandler(confirmDelete, () => setConfirmDelete(false))
  useBackHandler(photoOpen !== null, () => setPhotoOpen(null))

  // Swipe left/right anywhere on the screen to move through Income → Expense →
  // Transfer, but not while a picker/keypad/confirm sheet is open on top of it.
  const anyOverlayOpen =
    keypad !== null ||
    feeKeypad ||
    catPicker ||
    accPicker !== null ||
    datePicker ||
    splitEditor ||
    confirmDelete ||
    photoOpen !== null
  const typeSwipe = useSwipe(
    () => {
      const i = TYPES.indexOf(draft.type)
      if (i < TYPES.length - 1) set({ type: TYPES[i + 1] })
    },
    () => {
      const i = TYPES.indexOf(draft.type)
      if (i > 0) set({ type: TYPES[i - 1] })
    },
    !anyOverlayOpen,
  )

  const noteSuggestions = db.settings.autocomplete
    ? [
        ...new Set(
          db.transactions
            .map((t) => t.note)
            .filter((n) => n && n.toLowerCase().startsWith(draft.note.toLowerCase())),
        ),
      ]
        .filter((n) => n !== draft.note)
        .slice(0, 4)
    : []

  function validate(): string {
    if (draft.amount <= 0) return 'Enter an amount'
    if (draft.type === 'transfer') {
      if (!draft.fromAccountId || !draft.toAccountId) return 'Choose both accounts'
      if (draft.fromAccountId === draft.toAccountId) return 'Accounts must differ'
    } else {
      if (!draft.categoryId) return 'Choose a category'
      if (draft.splits?.length) {
        const sum = draft.splits.reduce((a, s) => a + s.amount, 0)
        if (sum !== draft.amount) return 'Split parts must add up to the amount'
      } else if (!draft.accountId) {
        return 'Choose an account'
      }
    }
    return ''
  }

  function commit() {
    const err = validate()
    if (err) {
      setError(err)
      // An error pattern for a refusal, a plain impact for a save. The editor
      // closes itself on success, so without this the only difference between
      // "saved" and "would not save" is whether the screen went away — which
      // you feel a beat later than your thumb has already moved on.
      hapticError()
      return
    }
    hapticMedium()
    const isTransfer = draft.type === 'transfer'
    const splits = !isTransfer && draft.splits?.length ? draft.splits : undefined
    const payload: Draft = {
      ...draft,
      profit: isTransfer || !draft.profit ? undefined : draft.profit,
      deal: draft.type === 'income' ? draft.deal : undefined,
      splits,
      fee: isTransfer ? draft.fee : undefined,
      categoryId: isTransfer ? undefined : draft.categoryId,
      accountId: isTransfer ? undefined : (splits?.[0]?.accountId ?? draft.accountId),
      fromAccountId: draft.type === 'transfer' ? draft.fromAccountId : undefined,
      toAccountId: draft.type === 'transfer' ? draft.toAccountId : undefined,
    }
    if (editingId) updateTx({ ...payload, id: editingId })
    else addTx(payload)
    // Only on a genuinely new entry — editing one that already existed isn't
    // the moment being marked here, the same distinction confetti above
    // already draws for income vs. everything else.
    if (!editingId) toast.success('Entry saved')
    // Filed — nothing left for a restart to resurrect.
    if (eligibleForDraftPersistence) clearStoredDraft()
    onSaved?.(payload.date)
    onClose()
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    // cleared straight away so picking the same file twice still fires
    e.target.value = ''
    if (!files.length) return
    setPhotoBusy(true)
    try {
      const added: string[] = []
      for (const f of files) {
        try {
          added.push(await fileToPhoto(f))
        } catch {
          /* one unreadable file should not lose the others */
        }
      }
      if (added.length) set({ photos: [...shots, ...added] })
    } finally {
      setPhotoBusy(false)
    }
  }

  const stepDay = (delta: number) => {
    const d = parseISO(draft.date)
    d.setDate(d.getDate() + delta)
    set({ date: toLocalISO(d) })
  }

  /**
   * Props that make a card the lit one when anything inside it is touched.
   *
   * Back to a plain card with a coloured border. The layered glass version
   * that briefly lived here is in git if it is ever wanted again; it was more
   * to look at than to use, and on a form you fill in several times a day the
   * quieter thing is the better thing.
   *
   * The only motion is a short settle on the card that just became active —
   * enough to catch the eye and confirm where the keyboard is pointing,
   * finished before you have started typing.
   */
  const cardProps = (i: number) => ({
    className: `card mb-3 focus-card${activeCard === i ? ' is-lit' : ''}`,
    style: { '--lit': accent } as React.CSSProperties,
    onPointerDownCapture: () => setActiveCard(i),
    onFocusCapture: () => setActiveCard(i),
  })

  const field = (label: string, node: React.ReactNode) => (
    <div
      className="flex items-center px-4 py-3.5 border-b last:border-b-0 gap-3"
      style={{ borderColor: 'var(--line)' }}
    >
      <span className="w-[88px] text-[13px] shrink-0" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <div className="flex-1 min-w-0 text-[14px]">{node}</div>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col animate-slide"
      {...typeSwipe}
      style={{ background: 'var(--bg)', ...typeSwipe.style }}
    >
      <div
        className="shrink-0 relative z-10"
        style={{
          background: 'var(--surface)',
          borderBottom: `2px solid ${accent}`,
          // the shorthand above resets border-color on every render, so the
          // transition has to be named explicitly to animate blue → red
          transition: 'border-color 160ms var(--ease-out)',
        }}
      >
        <div
          className="flex items-center px-2 py-3"
          style={{ paddingTop: 'calc(var(--sat) + 12px)' }}
        >
          <button
            className="px-2 text-xl leading-none"
            onClick={() => {
              // A deliberate close — unlike a backgrounding or a process
              // kill, this is the owner actually saying "not this one," so
              // it discards same as always rather than leaving something
              // for the next open to resurrect unasked.
              if (eligibleForDraftPersistence) clearStoredDraft()
              onClose()
            }}
            aria-label="Close"
          >
            ✕
          </button>
          {/* The app's name rather than "Add" — you already know what this
              screen is; the heading may as well be the thing you built. */}
          <div className="flex-1 text-center font-semibold text-[15px]">
            {editingId ? 'Edit' : 'Kaithwas'}
          </div>
          {editingId ? (
            <button
              className="px-3 text-[13px]"
              style={{ color: 'var(--expense)' }}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          ) : (
            <span className="w-10" />
          )}
        </div>
        {/* Glass toggle — a frosted pill riding in a recessed track. */}
        <div
          className="relative grid grid-cols-3 m-2.5 p-1 rounded-full"
          style={{
            background: 'color-mix(in srgb, var(--text) 7%, var(--surface))',
            border: '1.5px solid var(--line)',
            boxShadow: 'inset 0 1px 3px color-mix(in srgb, var(--text) 12%, var(--surface))',
          }}
        >
          <span
            className="absolute top-1 bottom-1 rounded-full overflow-hidden"
            style={{
              width: 'calc(33.333% - 4px)',
              left: 2,
              // a flat background-color (not a gradient) is what makes the
              // colour itself animatable; the sheen rides on top separately
              backgroundColor: accent,
              border: '1px solid rgba(255,255,255,0.35)',
              boxShadow: `0 6px 18px -6px ${accent}`,
              transform: `translateX(${TYPES.indexOf(draft.type) * 100}%)`,
              transition:
                'transform 460ms var(--ease-out), background-color 420ms var(--ease-out), box-shadow 420ms var(--ease-out)',
            }}
          >
            <span
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.06) 48%, rgba(255,255,255,0) 100%)',
              }}
            />
          </span>
          {TYPES.map((t) => {
            const active = t === draft.type
            return (
              <button
                key={t}
                className="relative z-10 py-2 text-[14px] rounded-full"
                style={{
                  color: active ? '#fff' : 'var(--muted)',
                  fontWeight: active ? 600 : 500,
                  transition: 'color 380ms var(--ease-out)',
                }}
                onClick={() => set({ type: t })}
              >
                {TYPE_LABEL[t]}
              </button>
            )
          })}
        </div>
      </div>

      {/* Fields float as grouped cards over the ambient background instead of
          running edge to edge on one flat slab. */}
      {/* The trailing --kbh is what lets a field near the bottom scroll clear
          of the on-screen keyboard. Without it the scroller has nowhere left
          to go and the field stays covered. */}
      <div
        className="flex-1 overflow-y-auto no-scrollbar px-3 pt-3 relative z-10"
        style={{ paddingBottom: 'var(--kbh)' }}
      >
        <div {...cardProps(0)}>
        <div
          className="flex items-center px-4 py-3.5 border-b gap-2"
          style={{ borderColor: 'var(--line)' }}
        >
          <span className="w-12 text-[13px] shrink-0" style={{ color: 'var(--muted)' }}>
            Date
          </span>
          <button
            className="px-1.5 text-[16px] leading-none shrink-0"
            onClick={() => stepDay(-1)}
            aria-label="Previous day"
          >
            ‹
          </button>
          <button
            className="flex-1 min-w-0 text-left text-[13.5px] whitespace-nowrap overflow-hidden text-ellipsis"
            onClick={() => setDatePicker(true)}
          >
            {formatDateLong(draft.date, db.settings)}
            {db.settings.timeInput && (
              <span style={{ color: 'var(--muted)' }}> · {draft.date.slice(11, 16)}</span>
            )}
          </button>
          <button
            className="px-1.5 text-[16px] leading-none shrink-0"
            onClick={() => stepDay(1)}
            aria-label="Next day"
          >
            ›
          </button>
        </div>

        {field(
          FIELD_LABEL.amount,
          <button
            className="w-full text-right text-[22px] font-semibold tabular-nums transition-colors duration-300"
            style={{ color: accent }}
            onClick={() => setKeypad('amount')}
          >
            {db.settings.currencySymbol} {formatAmount(draft.amount, db.settings)}
          </button>,
        )}

        {draft.type !== 'transfer' &&
          field(
            FIELD_LABEL.profit,
            <button
              className="w-full text-right text-[17px] tabular-nums"
              style={{
                color: !draft.profit
                  ? 'var(--muted)'
                  : draft.profit < 0
                    ? 'var(--expense)'
                    : 'var(--income)',
              }}
              onClick={() => setKeypad('profit')}
            >
              {db.settings.currencySymbol} {formatAmount(draft.profit ?? 0, db.settings)}
              {(draft.profit ?? 0) < 0 && (
                <span className="text-[12px] ml-1" style={{ color: 'var(--expense)' }}>
                  loss
                </span>
              )}
            </button>,
          )}
        </div>

        <div {...cardProps(1)}>
        {draft.type === 'transfer' ? (
          <>
            {field(
              'From',
              <button className="w-full text-left" onClick={() => setAccPicker('from')}>
                {accountName(db, draft.fromAccountId) || (
                  <span style={{ color: 'var(--muted)' }}>Select</span>
                )}
              </button>,
            )}
            {field(
              'To',
              <button className="w-full text-left" onClick={() => setAccPicker('to')}>
                {accountName(db, draft.toAccountId) || (
                  <span style={{ color: 'var(--muted)' }}>Select</span>
                )}
              </button>,
            )}
            {field(
              'Fee',
              <button
                className="w-full text-right tabular-nums"
                onClick={() => setFeeKeypad(true)}
              >
                {db.settings.currencySymbol} {formatAmount(draft.fee ?? 0, db.settings)}
              </button>,
            )}
          </>
        ) : (
          <>
            {field(
              'Category',
              <button className="w-full text-left" onClick={() => setCatPicker(true)}>
                {categoryName(db, draft.categoryId) || (
                  <span style={{ color: 'var(--muted)' }}>Select</span>
                )}
              </button>,
            )}
            {/* Paying with more than one method — part cash, part online — is
                routine at a counter, so "Split" is offered on the account row
                itself rather than hidden behind an already-split entry. */}
            {field(
              'Account',
              draft.splits?.length ? (
                <button className="w-full text-left" onClick={() => setSplitEditor(true)}>
                  {draft.splits.map((s) => (
                    <span key={s.accountId} className="flex items-baseline gap-2 text-[14px]">
                      <span className="font-medium">{accountName(db, s.accountId)}</span>
                      <span className="num" style={{ color: 'var(--muted)' }}>
                        {db.settings.currencySymbol} {formatAmount(s.amount, db.settings)}
                      </span>
                    </span>
                  ))}
                  <span
                    className="inline-block mt-1 text-[12px] font-semibold"
                    style={{ color: 'var(--accent)' }}
                  >
                    Split across {draft.splits.length} · edit
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    className="flex-1 text-left truncate"
                    onClick={() => setAccPicker('account')}
                  >
                    {accountName(db, draft.accountId) || (
                      <span style={{ color: 'var(--muted)' }}>Select</span>
                    )}
                  </button>
                  <button
                    className="shrink-0 px-3 py-1.5 rounded-[var(--r-sm)] text-[13px] font-semibold press"
                    style={{
                      background: 'var(--surface-2)',
                      border: '1.5px solid var(--line-strong)',
                      color: 'var(--text-2)',
                    }}
                    onClick={() => setSplitEditor(true)}
                  >
                    Split
                  </button>
                </div>
              ),
            )}

            {/* full width rather than squeezed beside a label — the slider
                needs the room to stay draggable. It draws its own heading. */}
            {draft.type === 'income' && (
              <div
                className="px-4 pt-3 pb-3.5 border-b last:border-b-0"
                style={{ borderColor: 'var(--line)' }}
              >
                <DealSlider value={draft.deal} onChange={(v) => set({ deal: v })} />
              </div>
            )}
          </>
        )}
        </div>

        <div {...cardProps(2)}>
        {field(
          'Note',
          <input
            className="w-full"
            placeholder="e.g. Sharma Traders"
            value={draft.note}
            onChange={(e) => set({ note: e.target.value })}
          />,
        )}
        {draft.note.length > 0 && noteSuggestions.length > 0 && (
          <div className="flex gap-2 px-4 py-2 overflow-x-auto no-scrollbar">
            {noteSuggestions.map((s) => (
              <button
                key={s}
                className="px-3 py-1 rounded-full text-[12px] shrink-0"
                style={{ background: 'var(--bg)', color: 'var(--muted)' }}
                onClick={() => set({ note: s })}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {field(
          FIELD_LABEL.description,
          <textarea
            className="w-full resize-none"
            rows={2}
            placeholder="Memo"
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
          />,
        )}

        <div className="flex items-start px-4 py-3 gap-3">
          <span className="w-[88px] text-[13px] shrink-0 pt-1" style={{ color: 'var(--muted)' }}>
            {shots.length > 1 ? `Photos (${shots.length})` : 'Photo'}
          </span>
          {/* A strip rather than a single slot. One receipt is rarely the
              whole story — a bill and the goods, or three pages of an
              invoice. Each thumbnail opens the viewer; the × drops just that
              one. */}
          <div className="flex-1 flex flex-wrap items-center gap-2">
            {shots.map((src, i) => (
              <span key={i} className="relative">
                <img
                  src={src}
                  alt={`attachment ${i + 1}`}
                  className="w-14 h-14 object-cover rounded"
                  onClick={() => setPhotoOpen(i)}
                />
                <button
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[11px] leading-none flex items-center justify-center"
                  style={{ background: 'var(--surface-3)', border: '1.5px solid var(--line-strong)' }}
                  onClick={() => set({ photos: shots.filter((_, j) => j !== i) })}
                  aria-label={`Remove photo ${i + 1}`}
                >
                  ✕
                </button>
              </span>
            ))}
            <button
              className="w-14 h-14 rounded flex items-center justify-center text-[22px]"
              // The editor's own type accent, not the global --accent. The
              // global one is the app's red, so an *additive* action sat
              // here in exactly the colour Remove and Delete use two rows
              // apart, while Save beside it was blue.
              style={{ color: accent, border: `1.5px dashed ${accent}` }}
              onClick={() => fileRef.current?.click()}
              aria-label="Attach a photo"
            >
              +
            </button>
            {photoBusy && (
              <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                adding…
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={pickPhoto}
            />
          </div>
        </div>
        </div>

        <div className="h-24" />
      </div>

      {/* The error moved out of the scroller and into the footer beside Save.
          It used to render after the last card, so pressing Save from the top
          of a long form put the explanation off-screen below the fold: the
          button appeared to do nothing at all. Here it cannot be missed,
          because it is attached to the control that produced it. */}
      <div
        className="shrink-0 grid grid-cols-1 gap-2 px-3 pt-2.5 border-t relative z-10"
        style={{
          borderColor: 'var(--line)',
          paddingBottom: 'calc(var(--sab) + 10px)',
        }}
      >
        {error && (
          <div
            className="px-3 py-2 rounded-[var(--r-md)] text-[13px] animate-fade"
            style={{
              color: 'var(--expense)',
              background: 'color-mix(in srgb, var(--expense) 12%, var(--surface))',
              border: '1.5px solid color-mix(in srgb, var(--expense) 26%, var(--surface))',
            }}
          >
            {error}
          </div>
        )}
        <button
          ref={saveBtn}
          className="py-3.5 rounded-[var(--r-md)] text-[15px] font-semibold text-white press fx-emit"
          style={{
            backgroundColor: accent,
            boxShadow: `0 8px 22px -8px ${accent}`,
            transition: 'background-color 380ms var(--ease-out), box-shadow 380ms var(--ease-out)',
          }}
          onClick={() => {
            /* Confetti on income only.
               Money coming in is the thing worth marking; an expense saving
               itself with a celebration would be absurd, and a transfer is
               just money moving from one pocket to another. The burst fires
               before commit(), because commit() closes this screen and the
               button would be gone before the pieces were spawned. */
            if (draft.type === 'income' && !error && saveBtn.current) {
              confetti(saveBtn.current)
            }
            commit()
          }}
        >
          Save
        </button>
      </div>

      <Keypad
        open={keypad !== null}
        accent={accent}
        fields={
          draft.type === 'transfer'
            ? [{ key: 'amount', label: FIELD_LABEL.amount, value: draft.amount }]
            : keypad === 'profit'
              ? [
                  { key: 'profit', label: FIELD_LABEL.profit, value: draft.profit ?? 0, signed: true },
                  { key: 'amount', label: FIELD_LABEL.amount, value: draft.amount },
                ]
              : [
                  { key: 'amount', label: FIELD_LABEL.amount, value: draft.amount },
                  { key: 'profit', label: FIELD_LABEL.profit, value: draft.profit ?? 0, signed: true },
                ]
        }
        // Fixed regardless of which row was tapped (see chipOrder's own
        // comment in Keypad.tsx) — Amount always reads first, Profit second.
        chipOrder={['amount', 'profit']}
        // A brand-new entry names itself on the way out of the keypad: Good
        // or Out instead of a bare Done. Transfers and edits keep Done, since
        // their type is already settled.
        actions={
          !editingId && draft.type !== 'transfer'
            ? [
                { key: 'income', label: TYPE_LABEL.income, color: 'var(--income)' },
                { key: 'expense', label: TYPE_LABEL.expense, color: 'var(--expense)' },
              ]
            : undefined
        }
        onClose={() => setKeypad(null)}
        onDone={(v, action) => {
          const type = (action as TxType | undefined) ?? draft.type
          set({
            amount: v.amount ?? draft.amount,
            profit: v.profit ?? 0,
            type,
            // the deal rating only belongs to income
            deal: type === 'income' ? draft.deal : undefined,
          })
          setError('')
          // hand straight over to the category step
          if (guided && type !== 'transfer') setCatPicker(true)
        }}
      />
      <Keypad
        open={feeKeypad}
        accent={accent}
        fields={[{ key: 'fee', label: 'Fee', value: draft.fee ?? 0 }]}
        onClose={() => setFeeKeypad(false)}
        onDone={(v) => set({ fee: v.fee })}
      />
      <CategoryPicker
        open={catPicker}
        type={draft.type === 'income' ? 'income' : 'expense'}
        current={draft.categoryId}
        onClose={() => setCatPicker(false)}
        onSelect={(id) => {
          set({ categoryId: id })
          setError('')
          // ...and on to the account, which ends the guided run
          if (guided) {
            setCatPicker(false)
            setAccPicker('account')
          }
        }}
        onManage={onManageCategories}
      />
      <AccountPicker
        open={accPicker !== null}
        title={accPicker === 'from' ? 'From account' : accPicker === 'to' ? 'To account' : 'Account'}
        onClose={() => setAccPicker(null)}
        onSplit={accPicker === 'account' ? () => setSplitEditor(true) : undefined}
        onSelect={(id) => {
          if (accPicker === 'from') set({ fromAccountId: id })
          else if (accPicker === 'to') set({ toAccountId: id })
          else set({ accountId: id, splits: undefined })
          setError('')
          // last step of the guided run — from here the form is yours
          if (guided && accPicker === 'account') setGuided(false)
        }}
      />
      <SplitEditor
        open={splitEditor}
        amount={draft.amount}
        value={draft.splits ?? []}
        onClose={() => setSplitEditor(false)}
        onDone={(splits) => {
          set({ splits: splits.length ? splits : undefined })
          setError('')
        }}
      />
      <DateTimePicker
        open={datePicker}
        value={draft.date}
        onClose={() => setDatePicker(false)}
        onSelect={(iso) => set({ date: iso })}
      />
      <Confirm
        open={confirmDelete}
        title="Delete this transaction?"
        confirmLabel="Delete"
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (editingId) deleteTx(editingId)
          onClose()
        }}
      />
      {photoOpen !== null && shots[photoOpen] && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex flex-col items-center justify-center"
          onClick={() => setPhotoOpen(null)}
        >
          <img src={shots[photoOpen]} alt="attachment" className="max-w-full max-h-[82%]" />
          {shots.length > 1 && (
            // Stops at both ends rather than wrapping: with three pages of an
            // invoice you want to know when you have reached the last one.
            <div
              className="flex items-center gap-6 pt-4 text-white"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="px-4 py-2 text-[22px] leading-none"
                style={{ opacity: photoOpen === 0 ? 0.3 : 1 }}
                disabled={photoOpen === 0}
                onClick={() => setPhotoOpen(photoOpen - 1)}
                aria-label="Previous photo"
              >
                ‹
              </button>
              <span className="text-[13px] num">
                {photoOpen + 1} / {shots.length}
              </span>
              <button
                className="px-4 py-2 text-[22px] leading-none"
                style={{ opacity: photoOpen === shots.length - 1 ? 0.3 : 1 }}
                disabled={photoOpen === shots.length - 1}
                onClick={() => setPhotoOpen(photoOpen + 1)}
                aria-label="Next photo"
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
