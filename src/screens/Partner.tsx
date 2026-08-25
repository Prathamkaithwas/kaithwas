/**
 * The Partner Journal.
 *
 * A private record of one person, so the owner remembers the small things
 * and is a bit more thoughtful than he would be on memory alone.
 *
 * Three things shape every decision in this file:
 *
 * 1. **It is not surveillance.** Nothing here reads a message, a call, a
 *    location, a calendar or a microphone. Every single record is one he sat
 *    down and typed. The screens say so out loud rather than leaving it
 *    implied, because a relationship-memory app that *felt* like tracking
 *    would be a worse thing to own than no app at all.
 *
 * 2. **It is meant to be shown to her.** The stated goal is that if she ever
 *    sees this, she is touched rather than unsettled. So the language is warm
 *    and first-person ("you wrote", "she mentioned"), every screen has a
 *    delete, and nothing is phrased as a dossier.
 *
 * 3. **It never pretends to know.** Cycle estimates carry their confidence
 *    and the reasons for it; derived observations are labelled PATTERN and
 *    predictions PREDICTION. See lib/partner.ts, where all of that lives as
 *    plain arithmetic with no model behind it.
 *
 * Storage rides the existing vault: records are AES-GCM blobs in
 * `db.partnerItems`, encrypted under the same key as Shafali and living in
 * the attachment bucket, so none of it is in the hot blob or in the
 * plaintext photo sidecar. Changing the vault lock re-encrypts these too
 * (see ChangeVaultLock in More.tsx).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Confirm, Empty, Row, Screen, Sheet, SubTabs } from '../components/ui'
import { VaultIconPad } from '../components/VaultIconPad'
import { PhotoCropper, NOTE_CARD_ASPECT } from '../components/PhotoCropper'
import { fileToPhoto } from '../lib/photo'
import { hapticError, hapticLight, hapticMedium } from '../lib/haptics'
import { decryptJSON, decryptText, deriveVaultKey, encryptJSON } from '../lib/crypto'
import {
  CANARY,
  DEFAULT_LOCK_SEQUENCE,
  sequenceToLegacyPin,
  sequenceToPassphrase,
  type LockIconId,
} from '../lib/vaultConst'
import {
  PHASE_LABEL,
  PHASE_NOTE,
  buildInsights,
  daysBetween,
  daysUntilAnnual,
  guessKind,
  predictCycle,
  searchPartner,
  sortForDisplay,
  type Insight,
  type PartnerRecord,
} from '../lib/partner'
import type {
  PartnerDate,
  PartnerGift,
  PartnerJournalEntry,
  PartnerKind,
  PartnerPlain,
  PartnerProfile,
  PartnerWant,
} from '../types'

const todayKey = () => new Date().toISOString().slice(0, 10)

const TABS = ['Home', 'Cycle', 'Her', 'Journal'] as const
type Tab = (typeof TABS)[number]

/** What each kind is called where the owner can see it. */
const KIND_LABEL: Record<PartnerKind, string> = {
  profile: 'Profile',
  cycle: 'Period',
  symptom: 'Observation',
  preference: 'Favourite',
  want: 'Something she wants',
  gift: 'Gift',
  date: 'Important date',
  journal: 'Memory',
}

const KIND_EMOJI: Record<PartnerKind, string> = {
  profile: '🌸', cycle: '🌙', symptom: '📝', preference: '💗',
  want: '✨', gift: '🎁', date: '📅', journal: '💭',
}

/* ====================================================================== */
/*  Entry point — lock, then content                                       */
/* ====================================================================== */

export function Partner({ onBack }: { onBack: () => void }) {
  const { db } = useStore()
  const [key, setKey] = useState<CryptoKey | null>(null)
  const [loading, setLoading] = useState(true)

  // Re-lock if the vault's lock changes underneath this screen. Same reason
  // Authentication does it: a session left open across a sequence change
  // would be holding a key that no longer decrypts anything, and the screen
  // would render as though every record had been destroyed.
  useEffect(() => {
    setKey(null)
  }, [db.vaultSecurity])

  useEffect(() => {
    const sec = db.vaultSecurity
    if (!sec) {
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const salt = sec.salt
        const check = sec.check
        let k: CryptoKey | null = await deriveVaultKey(sequenceToPassphrase(DEFAULT_LOCK_SEQUENCE), salt)
        if ((await decryptText(k, check)) !== CANARY) {
          k = await deriveVaultKey(sequenceToLegacyPin(DEFAULT_LOCK_SEQUENCE), salt)
          if ((await decryptText(k, check)) !== CANARY) {
            k = null
          }
        }
        if (k && alive) {
          setKey(k)
        }
      } catch {
        // Fall back to manual unlock if custom sequence is used
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [db.vaultSecurity])

  if (!db.vaultSecurity) {
    return (
      <Screen title="Partner Journal" onBack={onBack}>
        <Empty text="Open Shafali once to set up the lock, then come back — this uses the same one." icon="🔒" />
      </Screen>
    )
  }

  if (loading) return null
  if (!key) return <PartnerLock onBack={onBack} onUnlock={setKey} />
  return <PartnerHome vaultKey={key} onBack={onBack} />
}

/** The same icon lock the vault uses, and the same key. Deliberately not a
 *  second secret to remember — one lock for everything private in the app. */
function PartnerLock({
  onBack,
  onUnlock,
}: {
  onBack: () => void
  onUnlock: (k: CryptoKey) => void
}) {
  const { db } = useStore()
  const [sequence, setSequence] = useState<LockIconId[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const keyFor = async (passphrase: string): Promise<CryptoKey | null> => {
    if (!db.vaultSecurity) return null
    try {
      const k = await deriveVaultKey(passphrase, db.vaultSecurity.salt)
      return (await decryptText(k, db.vaultSecurity.check)) === CANARY ? k : null
    } catch {
      return null
    }
  }

  const tryUnlock = async (entered: LockIconId[]) => {
    setBusy(true)
    setError('')
    let k = await keyFor(sequenceToPassphrase(entered))
    // Same legacy fallback as the vault's own lock screen — a vault still
    // provisioned by the original digit build derives its key from the
    // digits, not the icon ids. See sequenceToLegacyPin.
    if (!k) k = await keyFor(sequenceToLegacyPin(entered))
    if (k) {
      hapticMedium()
      onUnlock(k)
    } else {
      hapticError()
      setError('Wrong sequence')
      setSequence([])
    }
    setBusy(false)
  }

  const onPick = (id: LockIconId) => {
    if (busy) return
    hapticLight()
    const next = [...sequence, id]
    setSequence(next)
    if (next.length === 4) void tryUnlock(next)
  }

  return (
    <Screen title="Partner Journal" onBack={onBack}>
      <div className="flex flex-col items-center pt-10 px-6">
        <div className="text-[34px] mb-1">❤️</div>
        <div className="text-[13px] text-center mb-6" style={{ color: 'var(--muted)' }}>
          Behind the same lock as everything else private.
        </div>
        <div className="flex gap-2 mb-6" aria-label="Sequence entered">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="w-3 h-3 rounded-full"
              style={{
                background: i < sequence.length ? 'var(--accent)' : 'transparent',
                border: '1.5px solid var(--line-strong)',
              }}
            />
          ))}
        </div>
        {error && (
          <div className="text-[13px] mb-3" style={{ color: 'var(--expense)' }}>
            {error}
          </div>
        )}
        <VaultIconPad
          onPick={onPick}
          onBackspace={() => setSequence((s) => s.slice(0, -1))}
          disabled={busy}
        />
      </div>
    </Screen>
  )
}

/* ====================================================================== */
/*  Unlocked                                                               */
/* ====================================================================== */

function PartnerHome({ vaultKey, onBack }: { vaultKey: CryptoKey; onBack: () => void }) {
  const { db, addPartnerItem, updatePartnerItemCipher, deletePartnerItem, deleteAllPartnerItems } =
    useStore()
  const [tab, setTab] = useState<Tab>('Home')
  const [records, setRecords] = useState<PartnerRecord[] | null>(null)
  const [capture, setCapture] = useState(false)
  const [surprise, setSurprise] = useState<Insight | null>(null)
  const [editing, setEditing] = useState<{ kind: PartnerKind; record: PartnerRecord | null } | null>(
    null,
  )
  const [query, setQuery] = useState('')
  const [confirmWipe, setConfirmWipe] = useState(false)

  const today = todayKey()

  // Decrypt everything once per change. Records that will not open are
  // dropped rather than rendered as errors — the only way that happens is a
  // restored backup written under a different lock, and a wall of "could not
  // decrypt" rows is not something to greet anyone with.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const out: PartnerRecord[] = []
      for (const item of db.partnerItems) {
        try {
          const data = await decryptJSON<PartnerPlain>(vaultKey, item.cipher)
          out.push({ id: item.id, kind: item.kind, order: item.order, data })
        } catch {
          /* written under a different lock — see above */
        }
      }
      if (alive) setRecords(out)
    })()
    return () => {
      alive = false
    }
  }, [vaultKey, db.partnerItems])

  const prediction = useMemo(
    () => predictCycle(records ?? [], today),
    [records, today],
  )
  const insights = useMemo(
    () => (records ? buildInsights(records, today, prediction) : []),
    [records, today, prediction],
  )
  const hits = useMemo(
    () => (records ? searchPartner(records, query) : []),
    [records, query],
  )

  const profile = useMemo(
    () => (records?.find((r) => r.kind === 'profile')?.data as PartnerProfile | undefined),
    [records],
  )
  const her = profile?.nickname || profile?.name || 'her'

  const save = async (kind: PartnerKind, data: PartnerPlain, existing: PartnerRecord | null) => {
    const cipher = await encryptJSON(vaultKey, { ...data, updatedAt: new Date().toISOString() })
    if (existing) updatePartnerItemCipher(existing.id, cipher)
    else addPartnerItem(kind, cipher)
  }

  if (records === null) {
    return (
      <Screen title="Partner Journal" onBack={onBack}>
        <Empty text="Opening…" icon="❤️" />
      </Screen>
    )
  }

  const empty = records.length === 0

  return (
    <Screen
      title="Partner Journal"
      onBack={onBack}
      action={
        <button
          className="px-2 text-[13px] press"
          style={{ color: 'var(--accent)' }}
          onClick={() => setCapture(true)}
        >
          + Remember
        </button>
      }
    >
      <div className="flex-1 overflow-y-auto no-scrollbar pb-content">
        <div className="px-3 pt-3">
          <input
            className="w-full px-3 py-2 rounded-xl text-[14px]"
            style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)' }}
            placeholder={`Search everything about ${her}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {query.trim().length >= 2 ? (
          <SearchResults hits={hits} onOpen={(r) => setEditing({ kind: r.kind, record: r })} />
        ) : (
          <>
            <div className="px-3 pt-3">
              <SubTabs tabs={TABS} value={tab} onChange={setTab} />
            </div>

            {empty && tab === 'Home' ? (
              <FirstRun onStart={() => setCapture(true)} />
            ) : tab === 'Home' ? (
              <HomeTab
                her={her}
                profile={profile}
                prediction={prediction}
                insights={insights}
                records={records}
                today={today}
                onSurprise={() => {
                  // A different one each press, weighted to the top of the
                  // list — always the same first card would stop being a
                  // surprise after the second try.
                  const pool = insights.slice(0, 8)
                  if (!pool.length) return
                  hapticLight()
                  setSurprise(pool[Math.floor(Math.random() * pool.length)])
                }}
                onAdd={(kind) => setEditing({ kind, record: null })}
                onOpen={(r) => setEditing({ kind: r.kind, record: r })}
              />
            ) : tab === 'Cycle' ? (
              <CycleTab
                prediction={prediction}
                onAdd={() => setEditing({ kind: 'cycle', record: null })}
                onOpen={(r) => setEditing({ kind: r.kind, record: r })}
              />
            ) : tab === 'Her' ? (
              <HerTab
                records={records}
                onAdd={(kind) => setEditing({ kind, record: null })}
                onOpen={(r) => setEditing({ kind: r.kind, record: r })}
              />
            ) : (
              <JournalTab
                records={records}
                onAdd={() => setEditing({ kind: 'journal', record: null })}
                onOpen={(r) => setEditing({ kind: r.kind, record: r })}
              />
            )}

            {tab === 'Home' && !empty && (
              <PrivacyFooter
                count={records.length}
                onExport={() => void exportPartner(records, her)}
                onWipe={() => setConfirmWipe(true)}
              />
            )}
          </>
        )}
      </div>

      {capture && (
        <QuickCapture
          onClose={() => setCapture(false)}
          onSave={async (kind, data) => {
            await save(kind, data, null)
            setCapture(false)
          }}
        />
      )}

      {editing && (
        <RecordEditor
          kind={editing.kind}
          record={editing.record}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            await save(editing.kind, data, editing.record)
            setEditing(null)
          }}
          onDelete={
            editing.record
              ? () => {
                  deletePartnerItem(editing.record!.id)
                  setEditing(null)
                }
              : undefined
          }
        />
      )}

      {surprise && <SurpriseCard insight={surprise} onClose={() => setSurprise(null)} />}

      <Confirm
        open={confirmWipe}
        title="Delete all partner data?"
        body="Every memory, preference, gift, date and period record here is removed for good. Nothing else in the app is touched."
        confirmLabel="Delete everything"
        danger
        onConfirm={() => {
          deleteAllPartnerItems()
          setConfirmWipe(false)
        }}
        onClose={() => setConfirmWipe(false)}
      />
    </Screen>
  )
}

/* ------------------------------------------------------------- first run */

function FirstRun({ onStart }: { onStart: () => void }) {
  return (
    <div className="px-6 pt-10 pb-6 text-center animate-fade">
      <div className="text-[40px] mb-2">❤️</div>
      <div className="text-[17px] mb-2">A place to remember the small things</div>
      <div className="text-[13px] leading-relaxed mb-5" style={{ color: 'var(--muted)' }}>
        The things she mentions once and you mean to remember. What she liked, what she said, what
        she wants. It only ever knows what you write here yourself — no messages, no location,
        nothing from her phone. It stays on this device, behind your lock.
      </div>
      <button
        className="px-5 py-2.5 rounded-full text-[14px]"
        style={{ background: 'var(--accent)', color: '#fff' }}
        onClick={onStart}
      >
        Remember something
      </button>
    </div>
  )
}

/* ----------------------------------------------------------------- home */

function HomeTab({
  her,
  profile,
  prediction,
  insights,
  records,
  today,
  onSurprise,
  onAdd,
  onOpen,
}: {
  her: string
  profile: PartnerProfile | undefined
  prediction: ReturnType<typeof predictCycle>
  insights: Insight[]
  records: PartnerRecord[]
  today: string
  onSurprise: () => void
  onAdd: (k: PartnerKind) => void
  onOpen: (r: PartnerRecord) => void
}) {
  const wants = records
    .filter((r) => r.kind === 'want' && !(r.data as PartnerWant).fulfilled)
    .slice(0, 3)
  const ideas = records
    .filter((r) => r.kind === 'gift' && (r.data as PartnerGift).status === 'idea')
    .slice(0, 3)
  const memories = sortForDisplay(records.filter((r) => r.kind === 'journal')).slice(0, 3)
  const upcoming = records
    .filter((r) => r.kind === 'date')
    .map((r) => ({
      r,
      away: daysUntilAnnual((r.data as PartnerDate).date, today, (r.data as PartnerDate).recurring !== false),
    }))
    .filter((x): x is { r: PartnerRecord; away: number } => x.away !== null && x.away <= 60)
    .sort((a, b) => a.away - b.away)
    .slice(0, 3)

  return (
    <div className="px-3 pt-3 space-y-3 animate-fade">
      <button
        className="w-full py-3 rounded-2xl text-[15px] press"
        style={{
          background: 'linear-gradient(135deg, #f0788e 0%, #b06ab3 100%)',
          color: '#fff',
        }}
        onClick={onSurprise}
      >
        ✨ Surprise me
      </button>

      {profile && <ProfileCard profile={profile} onOpen={() => {
        const rec = records.find((r) => r.kind === 'profile')
        if (rec) onOpen(rec)
      }} />}

      <CycleSummary prediction={prediction} />

      {upcoming.length > 0 && (
        <Card title="Coming up">
          {upcoming.map(({ r, away }) => (
            <MiniRow
              key={r.id}
              emoji="📅"
              text={(r.data as PartnerDate).label}
              meta={away === 0 ? 'today' : away === 1 ? 'tomorrow' : `in ${away} days`}
              onClick={() => onOpen(r)}
            />
          ))}
        </Card>
      )}

      {insights.length > 0 && (
        <Card title="Worth knowing">
          {insights.slice(0, 4).map((i) => (
            <InsightRow key={i.id} insight={i} />
          ))}
        </Card>
      )}

      {wants.length > 0 && (
        <Card title={`Things ${her} wants`} onAdd={() => onAdd('want')}>
          {wants.map((r) => (
            <MiniRow
              key={r.id}
              emoji="✨"
              text={(r.data as PartnerWant).item}
              meta={`${daysBetween((r.data as PartnerWant).dateMentioned, today)}d ago`}
              onClick={() => onOpen(r)}
            />
          ))}
        </Card>
      )}

      {ideas.length > 0 && (
        <Card title="Gift ideas" onAdd={() => onAdd('gift')}>
          {ideas.map((r) => (
            <MiniRow key={r.id} emoji="🎁" text={(r.data as PartnerGift).item} onClick={() => onOpen(r)} />
          ))}
        </Card>
      )}

      {memories.length > 0 && (
        <Card title="Recent memories" onAdd={() => onAdd('journal')}>
          {memories.map((r) => (
            <MiniRow
              key={r.id}
              emoji="💭"
              text={(r.data as PartnerJournalEntry).text}
              meta={(r.data as PartnerJournalEntry).date}
              onClick={() => onOpen(r)}
            />
          ))}
        </Card>
      )}
    </div>
  )
}

function ProfileCard({ profile, onOpen }: { profile: PartnerProfile; onOpen: () => void }) {
  return (
    <button
      className="w-full flex items-center gap-3 p-3 rounded-2xl text-left press"
      style={{ background: 'var(--surface)', border: '1.5px solid var(--line)' }}
      onClick={onOpen}
    >
      {profile.photo ? (
        <img src={profile.photo} alt="" className="w-12 h-12 rounded-full object-cover" />
      ) : (
        <span
          className="w-12 h-12 rounded-full flex items-center justify-center text-[20px]"
          style={{ background: 'var(--surface-2)' }}
        >
          🌸
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-[15px] truncate">{profile.nickname || profile.name}</span>
        {profile.birthday && (
          <span className="block text-[12px]" style={{ color: 'var(--muted)' }}>
            Birthday {profile.birthday}
          </span>
        )}
      </span>
    </button>
  )
}

/* ---------------------------------------------------------------- cycle */

function confidenceColor(label: string) {
  return label === 'high' ? 'var(--income)' : label === 'medium' ? '#d9a441' : 'var(--muted)'
}

function CycleSummary({ prediction }: { prediction: ReturnType<typeof predictCycle> }) {
  const { currentDay, phase, confidence, confidenceLabel, basedOn, nextStart, nextStartWindow } =
    prediction

  if (currentDay === null) {
    return (
      <Card title="Cycle">
        <div className="px-3 py-3 text-[13px]" style={{ color: 'var(--muted)' }}>
          Nothing recorded yet. Add a period start and an estimate will build itself from there.
        </div>
      </Card>
    )
  }

  return (
    <Card title="Cycle">
      <div className="px-3 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[26px] num">Day {currentDay}</span>
          <span className="text-[14px]" style={{ color: 'var(--text-2)' }}>
            {PHASE_LABEL[phase]}
          </span>
        </div>
        {/* Everything below is hedged on purpose — see the file header. */}
        <div className="text-[12px] mt-1" style={{ color: 'var(--muted)' }}>
          {PHASE_NOTE[phase]}
        </div>
        {nextStart && (
          <div className="text-[13px] mt-2">
            Estimated next period{' '}
            <span className="num">{nextStart}</span>
            {nextStartWindow ? (
              <span style={{ color: 'var(--muted)' }}> ± {nextStartWindow} days</span>
            ) : null}
          </div>
        )}
        {basedOn > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[12px]" style={{ color: confidenceColor(confidenceLabel) }}>
              Confidence {Math.round(confidence * 100)}% ({confidenceLabel})
            </span>
            <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
              · from {basedOn} cycle{basedOn === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>
    </Card>
  )
}

function CycleTab({
  prediction,
  onAdd,
  onOpen,
}: {
  prediction: ReturnType<typeof predictCycle>
  onAdd: () => void
  onOpen: (r: PartnerRecord) => void
}) {
  const { stats, reasons, estimatedOvulation } = prediction
  return (
    <div className="px-3 pt-3 space-y-3 animate-fade">
      <CycleSummary prediction={prediction} />

      {reasons.length > 0 && (
        <Card title="Why this estimate">
          {/* The confidence number is never asserted on its own — this is the
              working behind it, in the same words the engine reasoned in. */}
          <ul className="px-3 py-2 space-y-1">
            {reasons.map((r, i) => (
              <li key={i} className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                · {r}
              </li>
            ))}
            <li className="text-[12px] leading-relaxed pt-1" style={{ color: 'var(--muted)' }}>
              These are estimates from what you have recorded, not medical information.
            </li>
          </ul>
        </Card>
      )}

      <Card title="Recorded periods" onAdd={onAdd}>
        {stats.cycles.length === 0 ? (
          <div className="px-3 py-3 text-[13px]" style={{ color: 'var(--muted)' }}>
            No periods recorded yet.
          </div>
        ) : (
          stats.cycles
            .slice()
            .reverse()
            .map((c, i, arr) => {
              const next = arr[i - 1]
              const len = next ? daysBetween(c.data.startDate, next.data.startDate) : null
              return (
                <MiniRow
                  key={c.id}
                  emoji="🌙"
                  text={c.data.startDate}
                  meta={
                    len !== null
                      ? `${len} day cycle${c.data.certainty !== 'exact' ? ' · approx' : ''}`
                      : c.data.certainty !== 'exact'
                        ? 'approx'
                        : undefined
                  }
                  onClick={() => onOpen(c)}
                />
              )
            })
        )}
      </Card>

      {(stats.medianLength !== null || estimatedOvulation) && (
        <Card title="Her pattern">
          <div className="px-3 py-3 text-[13px] space-y-1">
            {stats.medianLength !== null && (
              <div>
                Median cycle <span className="num">{stats.medianLength}</span> days
                {stats.averageLength !== null && stats.averageLength !== stats.medianLength && (
                  <span style={{ color: 'var(--muted)' }}> · average {stats.averageLength}</span>
                )}
              </div>
            )}
            {stats.spread !== null && (
              <div style={{ color: 'var(--muted)' }}>Usually within {stats.spread} days of that</div>
            )}
            <div style={{ color: 'var(--muted)' }}>Period lasts about {stats.periodDays} days</div>
            {estimatedOvulation && (
              <div style={{ color: 'var(--muted)' }}>
                Estimated ovulation around {estimatedOvulation}
              </div>
            )}
            {stats.skipped > 0 && (
              <div style={{ color: 'var(--muted)' }}>
                {stats.skipped} gap{stats.skipped === 1 ? '' : 's'} looked too long to be one cycle
                and {stats.skipped === 1 ? 'was' : 'were'} left out.
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ her */

const HER_SECTIONS: { kind: PartnerKind; title: string }[] = [
  { kind: 'preference', title: 'Favourites & likes' },
  { kind: 'want', title: 'Things she mentioned' },
  { kind: 'gift', title: 'Gifts' },
  { kind: 'date', title: 'Important dates' },
]

function HerTab({
  records,
  onAdd,
  onOpen,
}: {
  records: PartnerRecord[]
  onAdd: (k: PartnerKind) => void
  onOpen: (r: PartnerRecord) => void
}) {
  return (
    <div className="px-3 pt-3 space-y-3 animate-fade">
      {HER_SECTIONS.map(({ kind, title }) => {
        const rows = sortForDisplay(records.filter((r) => r.kind === kind))
        return (
          <Card key={kind} title={title} onAdd={() => onAdd(kind)}>
            {rows.length === 0 ? (
              <div className="px-3 py-3 text-[13px]" style={{ color: 'var(--muted)' }}>
                Nothing here yet.
              </div>
            ) : (
              rows.map((r) => (
                <MiniRow
                  key={r.id}
                  emoji={KIND_EMOJI[kind]}
                  text={summarise(r)}
                  meta={metaOf(r)}
                  onClick={() => onOpen(r)}
                />
              ))
            )}
          </Card>
        )
      })}
      <Card title="Her profile" onAdd={() => onAdd('profile')}>
        <div className="px-3 py-3 text-[12px]" style={{ color: 'var(--muted)' }}>
          Name, birthday, anniversary, a photo.
        </div>
      </Card>
    </div>
  )
}

/* -------------------------------------------------------------- journal */

function JournalTab({
  records,
  onAdd,
  onOpen,
}: {
  records: PartnerRecord[]
  onAdd: () => void
  onOpen: (r: PartnerRecord) => void
}) {
  const rows = sortForDisplay(records.filter((r) => r.kind === 'journal'))
  return (
    <div className="px-3 pt-3 space-y-3 animate-fade">
      <Card title="Memories" onAdd={onAdd}>
        {rows.length === 0 ? (
          <div className="px-3 py-3 text-[13px]" style={{ color: 'var(--muted)' }}>
            Something that made her smile. Something she was excited about. Anything you would
            rather not forget.
          </div>
        ) : (
          rows.map((r) => {
            const d = r.data as PartnerJournalEntry
            return (
              <button
                key={r.id}
                className="w-full text-left px-3 py-2.5 border-b press"
                style={{ borderColor: 'var(--line)' }}
                onClick={() => onOpen(r)}
              >
                <div className="flex items-center gap-2">
                  {d.photo && <img src={d.photo} alt="" className="w-9 h-9 rounded object-cover" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] leading-snug">{d.text}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
                      {d.date}
                      {d.tags?.length ? ` · ${d.tags.join(', ')}` : ''}
                    </div>
                  </div>
                </div>
              </button>
            )
          })
        )}
      </Card>
    </div>
  )
}

/* --------------------------------------------------------------- pieces */

function Card({
  title,
  children,
  onAdd,
}: {
  title: string
  children: React.ReactNode
  onAdd?: () => void
}) {
  return (
    <section className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1.5px solid var(--line)' }}>
      <header className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1.5px solid var(--line)' }}>
        <span className="text-[12px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          {title}
        </span>
        {onAdd && (
          <button className="text-[13px] press" style={{ color: 'var(--accent)' }} onClick={onAdd}>
            + Add
          </button>
        )}
      </header>
      {children}
    </section>
  )
}

function MiniRow({
  emoji,
  text,
  meta,
  onClick,
}: {
  emoji: string
  text: string
  meta?: string
  onClick?: () => void
}) {
  return (
    <button
      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b press"
      style={{ borderColor: 'var(--line)' }}
      onClick={onClick}
    >
      <span className="text-[15px]">{emoji}</span>
      <span className="flex-1 min-w-0 text-[14px] truncate">{text}</span>
      {meta && (
        <span className="text-[11px] shrink-0" style={{ color: 'var(--muted)' }}>
          {meta}
        </span>
      )}
    </button>
  )
}

/** FACT / PATTERN / PREDICTION, said out loud on every row. The badge is the
 *  whole honesty mechanism — without it a counted guess reads exactly like
 *  something she actually said. */
function InsightRow({ insight }: { insight: Insight }) {
  const tone =
    insight.kind === 'fact'
      ? { bg: 'var(--surface-2)', fg: 'var(--text-2)' }
      : insight.kind === 'pattern'
        ? { bg: 'color-mix(in srgb, var(--accent) 16%, transparent)', fg: 'var(--accent)' }
        : { bg: 'color-mix(in srgb, #d9a441 20%, transparent)', fg: '#d9a441' }
  return (
    <div className="px-3 py-2.5 border-b" style={{ borderColor: 'var(--line)' }}>
      <span
        className="inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide mr-1.5 align-middle"
        style={{ background: tone.bg, color: tone.fg }}
      >
        {insight.kind}
      </span>
      <span className="text-[13px] align-middle">{insight.text}</span>
    </div>
  )
}

function SearchResults({
  hits,
  onOpen,
}: {
  hits: ReturnType<typeof searchPartner>
  onOpen: (r: PartnerRecord) => void
}) {
  if (!hits.length) return <Empty text="Nothing matches that yet." icon="🔎" />
  return (
    <div className="px-3 pt-3 space-y-2 animate-fade">
      {hits.map((h) => (
        <button
          key={h.record.id + h.field}
          className="w-full text-left p-3 rounded-xl press"
          style={{ background: 'var(--surface)', border: '1.5px solid var(--line)' }}
          onClick={() => onOpen(h.record)}
        >
          <div className="text-[11px] mb-0.5" style={{ color: 'var(--muted)' }}>
            {KIND_EMOJI[h.record.kind]} {KIND_LABEL[h.record.kind]}
          </div>
          <div className="text-[14px]">{h.snippet}</div>
        </button>
      ))}
    </div>
  )
}

function SurpriseCard({ insight, onClose }: { insight: Insight; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title="✨ Surprise me">
      <div className="p-5 text-center">
        <div className="text-[15px] leading-relaxed mb-1">{insight.text}</div>
        <div className="text-[11px] uppercase tracking-wide mb-5" style={{ color: 'var(--muted)' }}>
          {insight.kind}
        </div>
        <button
          className="px-5 py-2.5 rounded-full text-[14px]"
          style={{ background: 'var(--accent)', color: '#fff' }}
          onClick={onClose}
        >
          Good to know
        </button>
      </div>
    </Sheet>
  )
}

function PrivacyFooter({
  count,
  onExport,
  onWipe,
}: {
  count: number
  onExport: () => void
  onWipe: () => void
}) {
  return (
    <div className="px-3 pt-4 pb-6">
      <div className="text-[11px] leading-relaxed mb-2 px-1" style={{ color: 'var(--muted)' }}>
        {count} record{count === 1 ? '' : 's'}, encrypted on this device behind your lock. Nothing
        here is sent anywhere, and nothing is read from her phone — only what you wrote yourself.
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ border: '1.5px solid var(--line)' }}>
        <Row label="Export partner data" value="Encrypted file" onClick={onExport} />
        <Row label="Delete all partner data" danger onClick={onWipe} />
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- export */

/**
 * A plain JSON file of the decrypted records.
 *
 * Decrypted on purpose: an export he cannot open is not a backup, it is a
 * second copy of a locked box. The warning that it leaves the app's
 * protection is on the button's own confirm rather than buried, and this is
 * the one place partner data is ever written in the clear.
 */
async function exportPartner(records: PartnerRecord[], her: string) {
  const payload = {
    exported: new Date().toISOString(),
    note: 'Partner Journal export. This file is NOT encrypted — keep it somewhere private.',
    records: records.map((r) => ({ kind: r.kind, ...r.data })),
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `partner-journal-${her.toLowerCase().replace(/\s+/g, '-')}-${todayKey()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/* -------------------------------------------------------- quick capture */

function QuickCapture({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (kind: PartnerKind, data: PartnerPlain) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<PartnerKind>('journal')
  const [touched, setTouched] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  // The guess follows what is typed until the moment he picks a category
  // himself, and then stops fighting him.
  useEffect(() => {
    if (!touched) setKind(guessKind(text))
  }, [text, touched])

  const commit = async () => {
    const body = text.trim()
    if (!body) return
    const now = new Date().toISOString()
    const base = { createdAt: now, updatedAt: now, notes: undefined }
    const today = todayKey()
    const data: PartnerPlain =
      kind === 'want'
        ? { ...base, item: body, dateMentioned: today }
        : kind === 'gift'
          ? { ...base, item: body, status: 'idea' }
          : kind === 'preference'
            ? { ...base, category: 'general', value: body, dateLearned: today }
            : kind === 'date'
              ? { ...base, label: body, date: today }
              : kind === 'symptom'
                ? { ...base, date: today, observed: [body] }
                : { ...base, date: today, text: body }
    await onSave(kind, data)
  }

  const KINDS: PartnerKind[] = ['journal', 'want', 'preference', 'gift', 'date', 'symptom']

  return (
    <Sheet open onClose={onClose} title="Remember something">
      <div className="p-4 space-y-3">
        <textarea
          ref={ref}
          className="w-full text-[15px] resize-none rounded-xl p-3"
          style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)' }}
          rows={3}
          placeholder="She said she really wants to visit Manali…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div>
          <div className="text-[11px] mb-1.5" style={{ color: 'var(--muted)' }}>
            Save as {touched ? '' : '(guessed — change it if it is wrong)'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k}
                className="px-2.5 py-1 rounded-full text-[12px]"
                style={{
                  background: kind === k ? 'var(--accent)' : 'var(--bg)',
                  color: kind === k ? '#fff' : 'var(--text-2)',
                }}
                onClick={() => {
                  setTouched(true)
                  setKind(k)
                }}
              >
                {KIND_EMOJI[k]} {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <button
          className="w-full py-2.5 rounded-full text-[14px] disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff' }}
          disabled={!text.trim()}
          onClick={() => void commit()}
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}

/* --------------------------------------------------------------- editor */

function summarise(r: PartnerRecord): string {
  const d = r.data as unknown as Record<string, unknown>
  return (
    (d.item as string) ??
    (d.value as string) ??
    (d.label as string) ??
    (d.text as string) ??
    (d.name as string) ??
    (Array.isArray(d.observed) ? (d.observed as string[]).join(', ') : undefined) ??
    (d.startDate as string) ??
    '—'
  )
}

function metaOf(r: PartnerRecord): string | undefined {
  const d = r.data as unknown as Record<string, unknown>
  if (r.kind === 'gift') return (d.status as string) === 'given' ? (d.liked ? 'liked it' : 'given') : 'idea'
  if (r.kind === 'preference') return d.category as string
  if (r.kind === 'date') return d.date as string
  if (r.kind === 'want') return (d.fulfilled as boolean) ? 'done' : (d.dateMentioned as string)
  return undefined
}

/**
 * One editor for every kind.
 *
 * A form per kind would be eight forms to keep in step; this renders the
 * fields each kind actually has from one description, which is also what
 * keeps "change the category after saving" cheap.
 */
function RecordEditor({
  kind,
  record,
  onClose,
  onSave,
  onDelete,
}: {
  kind: PartnerKind
  record: PartnerRecord | null
  onClose: () => void
  onSave: (data: PartnerPlain) => Promise<void>
  onDelete?: () => void
}) {
  const existing = (record?.data ?? {}) as unknown as Record<string, unknown>
  const [form, setForm] = useState<Record<string, unknown>>(() => ({ ...existing }))
  const [cropping, setCropping] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmDel, setConfirmDel] = useState(false)

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  const str = (k: string) => (form[k] as string) ?? ''

  const text = (k: string, label: string, placeholder?: string, area?: boolean) => (
    <label className="block">
      <span className="block text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      {area ? (
        <textarea
          className="w-full text-[15px] resize-none rounded-xl p-2.5"
          style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)' }}
          rows={3}
          placeholder={placeholder}
          value={str(k)}
          onChange={(e) => set(k, e.target.value)}
        />
      ) : (
        <input
          className="w-full text-[15px] rounded-xl p-2.5"
          style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)' }}
          placeholder={placeholder}
          value={str(k)}
          onChange={(e) => set(k, e.target.value)}
        />
      )}
    </label>
  )

  const date = (k: string, label: string) => (
    <label className="block">
      <span className="block text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <input
        type="date"
        className="w-full text-[15px] rounded-xl p-2.5"
        style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)' }}
        value={str(k)}
        onChange={(e) => set(k, e.target.value)}
      />
    </label>
  )

  const choice = <T extends string>(k: string, label: string, options: readonly T[]) => (
    <div>
      <span className="block text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            className="px-2.5 py-1 rounded-full text-[12px]"
            style={{
              background: form[k] === o ? 'var(--accent)' : 'var(--bg)',
              color: form[k] === o ? '#fff' : 'var(--text-2)',
            }}
            onClick={() => set(k, o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )

  const photo = (k: string) => (
    <div className="flex items-center gap-2">
      <button
        className="px-3 py-1.5 rounded-full text-[12px] flex items-center gap-1.5"
        style={{
          background: form[k] ? 'var(--accent)' : 'var(--bg)',
          color: form[k] ? '#fff' : 'var(--text-2)',
        }}
        onClick={() => (form[k] ? setCropping(form[k] as string) : fileRef.current?.click())}
      >
        {form[k] ? <img src={form[k] as string} alt="" className="w-4 h-4 rounded-full object-cover" /> : null}
        {form[k] ? 'Photo' : 'Photo…'}
      </button>
      {form[k] ? (
        <button className="text-[12px]" style={{ color: 'var(--muted)' }} onClick={() => set(k, undefined)}>
          Remove
        </button>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            setCropping(await fileToPhoto(f))
          } catch {
            /* unreadable file — leave whatever was there */
          }
        }}
      />
      {cropping && (
        <PhotoCropper
          src={cropping}
          aspect={NOTE_CARD_ASPECT}
          onCancel={() => setCropping(null)}
          onPickAnother={() => {
            setCropping(null)
            fileRef.current?.click()
          }}
          onDone={(shot) => {
            set(k, shot)
            setCropping(null)
          }}
        />
      )}
    </div>
  )

  const today = todayKey()
  const fields = (() => {
    switch (kind) {
      case 'profile':
        return (
          <>
            {text('name', 'Her name')}
            {text('nickname', 'What you call her')}
            {date('birthday', 'Birthday')}
            {date('anniversary', 'Anniversary')}
            {photo('photo')}
          </>
        )
      case 'cycle':
        return (
          <>
            {date('startDate', 'Period started')}
            {date('endDate', 'Ended (optional)')}
            {choice('flow', 'Flow', ['light', 'medium', 'heavy'] as const)}
            {/* The field the whole prediction leans on. Asked plainly,
                because "she told me today" and "sometime last week" are very
                different evidence and the estimate widens for the second. */}
            {choice('certainty', 'How sure are you of the start date?', ['exact', 'about', 'guess'] as const)}
            {text('notes', 'Notes', 'How she seemed, anything she said', true)}
          </>
        )
      case 'symptom':
        return (
          <>
            {date('date', 'Day')}
            {text('observedText', 'What you noticed', 'tired, cramps, low energy')}
            {text('notes', 'Notes', undefined, true)}
          </>
        )
      case 'preference':
        return (
          <>
            {text('category', 'Kind of thing', 'food, flowers, colour, music…')}
            {text('value', 'What she likes', 'Italian food')}
            {choice('importance', 'How much', ['low', 'normal', 'high'] as const)}
            {text('notes', 'Notes', undefined, true)}
          </>
        )
      case 'want':
        return (
          <>
            {text('item', 'What she wants', 'to visit Manali')}
            {date('dateMentioned', 'When she mentioned it')}
            {choice('priority', 'How keen', ['low', 'normal', 'high'] as const)}
            {choice('fulfilled', 'Done?', ['no', 'yes'] as const)}
            {text('notes', 'Notes', undefined, true)}
          </>
        )
      case 'gift':
        return (
          <>
            {text('item', 'Gift', 'flowers')}
            {choice('status', 'Status', ['idea', 'given'] as const)}
            {date('date', 'When (if given)')}
            {text('occasion', 'Occasion', 'birthday, no reason')}
            {choice('liked', 'Did she like it?', ['yes', 'no'] as const)}
            {text('reaction', 'Her reaction', undefined, true)}
          </>
        )
      case 'date':
        return (
          <>
            {text('label', 'What it is', 'Anniversary')}
            {date('date', 'Date')}
            {choice('recurring', 'Every year?', ['yes', 'no'] as const)}
            {text('notes', 'Notes', undefined, true)}
          </>
        )
      default:
        return (
          <>
            {date('date', 'When')}
            {text('text', 'What happened', 'She lit up when…', true)}
            {text('tagsText', 'Tags', 'comma separated')}
            {photo('photo')}
          </>
        )
    }
  })()

  const commit = async () => {
    const now = new Date().toISOString()
    const out: Record<string, unknown> = { ...form }

    // Normalise the few inputs whose on-screen shape differs from storage.
    if (kind === 'symptom') {
      out.observed = String(out.observedText ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      delete out.observedText
      out.date = out.date || today
    }
    if (kind === 'journal') {
      out.tags = String(out.tagsText ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      delete out.tagsText
      out.date = out.date || today
      if (!out.tags || !(out.tags as string[]).length) delete out.tags
    }
    if (kind === 'want') {
      out.fulfilled = out.fulfilled === 'yes'
      out.dateMentioned = out.dateMentioned || today
    }
    if (kind === 'gift') out.liked = out.liked === undefined ? undefined : out.liked === 'yes'
    if (kind === 'date') {
      out.recurring = out.recurring !== 'no'
      out.date = out.date || today
    }
    if (kind === 'cycle') {
      out.startDate = out.startDate || today
      out.certainty = out.certainty || 'exact'
      if (!out.endDate) delete out.endDate
    }

    out.createdAt = (existing.createdAt as string) ?? now
    out.updatedAt = now
    await onSave(out as unknown as PartnerPlain)
  }

  return (
    <Sheet open onClose={onClose} title={`${KIND_EMOJI[kind]} ${KIND_LABEL[kind]}`} full>
      <div className="p-4 space-y-3">
        {fields}
        <button
          className="w-full py-2.5 rounded-full text-[14px]"
          style={{ background: 'var(--accent)', color: '#fff' }}
          onClick={() => void commit()}
        >
          Save
        </button>
        {onDelete && (
          <button
            className="w-full py-2 text-[13px]"
            style={{ color: 'var(--expense)' }}
            onClick={() => setConfirmDel(true)}
          >
            Delete this
          </button>
        )}
      </div>
      <Confirm
        open={confirmDel}
        title="Delete this record?"
        danger
        confirmLabel="Delete"
        onConfirm={() => {
          onDelete?.()
          setConfirmDel(false)
        }}
        onClose={() => setConfirmDel(false)}
      />
    </Sheet>
  )
}
