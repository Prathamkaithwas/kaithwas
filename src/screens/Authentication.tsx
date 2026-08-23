import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DocItem,
  PasswordItem,
  PasswordItemPlain,
  VaultCategory,
  VaultItem,
  VaultItemPlain,
} from '../types'
import { useStore } from '../store'
import { useSwipe } from '../lib/useSwipe'
import {
  decryptJSON,
  decryptText,
  deriveVaultKey,
  encryptJSON,
  encryptText,
  randomSaltB64,
} from '../lib/crypto'
import { AttachmentGrid, Confirm, Empty, Fab, SectionLabel, Sheet, SuggestInput } from '../components/ui'
import { HoldConfirm } from '../components/HoldConfirm'
import { fileToAttachment, fileToPhoto, isPdfDataUrl } from '../lib/photo'
import { renderPdfPage } from '../lib/pdf'
import { sharePhotos } from '../lib/share'
import { speakCharacters, type SpeechHandle } from '../lib/speak'
import { hapticError, hapticLight, hapticMedium } from '../lib/haptics'
import { Heart, Star, Sun, Moon, Leaf, Anchor, Camera, Music2, Umbrella, type LucideIcon } from 'lucide-react'

import { CANARY, LOCK_ICON_IDS, sequenceToPassphrase, type LockIconId } from '../lib/vaultConst'
import { usePersistedFold } from '../lib/usePersistedFold'

/** Which glyph each id in LOCK_ICON_IDS (vaultConst.ts) actually draws. Kept
 *  here rather than in that shared module since it's the one thing that
 *  needs lucide-react, and fakeData.ts — the module's other consumer —
 *  never renders anything. */
const LOCK_ICON_MAP: Record<LockIconId, LucideIcon> = {
  heart: Heart,
  star: Star,
  sun: Sun,
  moon: Moon,
  leaf: Leaf,
  anchor: Anchor,
  camera: Camera,
  music: Music2,
  umbrella: Umbrella,
}

type InnerTab = 'Vault' | 'Passwords' | 'Documents'
const INNER_TABS: InnerTab[] = ['Vault', 'Passwords', 'Documents']

const CATEGORY_LABEL: Record<VaultCategory, string> = {
  bank: 'Bank Accounts',
  card: 'Cards',
  gst: 'GST / Business',
  other: 'Other',
}

/** The exact labels `CATEGORY_TEMPLATE.card` seeds a fresh entry with — the
 *  card preview reads fields by these names, so renaming a label in the
 *  generic editor is what drops a field out of the visual (it still saves
 *  as a plain field either way). */
const CARD_FIELD = {
  holder: 'Card Holder',
  number: 'Card Number',
  expiry: 'Expiry (MM/YY)',
  cvv: 'CVV',
  network: 'Card Network',
  bank: 'Bank',
  type: 'Card Type',
} as const

/**
 * What `network` and `bank` used to share: one free-text box labelled
 * "Network / Bank", typed as things like "Visa · HDFC".
 *
 * Vault items are encrypted, so this cannot be migrated in normalize.ts the
 * way the rest of the database is — nothing outside this screen can read the
 * fields at all. It is resolved on read instead (see `readCardBrand`), and
 * rewritten into the two new fields the first time a card is opened in the
 * editor. Cards saved before this change keep working either way.
 */
const LEGACY_NETWORK_FIELD = 'Network / Bank'

/** The only three networks any card in India carries. */
const CARD_NETWORKS = ['Visa', 'Mastercard', 'RuPay'] as const
type CardNetwork = (typeof CARD_NETWORKS)[number]

/** Finds a network's name anywhere in a string, however it was capitalised —
 *  "visa", "VISA · HDFC" and "Master Card" all resolve. */
function matchNetwork(raw: string): CardNetwork | '' {
  const t = raw.toLowerCase().replace(/\s+/g, '')
  if (t.includes('visa')) return 'Visa'
  if (t.includes('mastercard') || t.includes('master')) return 'Mastercard'
  if (t.includes('rupay')) return 'RuPay'
  return ''
}

/** Whatever is left of the old combined value once the network is taken out
 *  of it — "Visa · HDFC" leaves "HDFC". */
function stripNetwork(raw: string): string {
  return raw
    .replace(/visa|master\s*card|rupay/gi, '')
    .replace(/^[\s·|,/-]+|[\s·|,/-]+$/g, '')
    .trim()
}

/** The network and bank for a card, reading the new fields if they are there
 *  and falling back to the single legacy one if they are not. */
function readCardBrand(get: (label: string) => string): { network: CardNetwork | ''; bank: string } {
  const network = matchNetwork(get(CARD_FIELD.network))
  const bank = get(CARD_FIELD.bank)
  if (network || bank) return { network, bank }
  const legacy = get(LEGACY_NETWORK_FIELD)
  return { network: matchNetwork(legacy), bank: stripNetwork(legacy) }
}

const CARD_TYPES = ['Debit', 'Credit', 'Prepaid', 'Other'] as const

const CARD_TONES = 6

function toneForKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h % CARD_TONES
}

/** "5737427749252858" → "5737 4277 4925 2858", whatever separators/spaces were typed. */
function formatCardNumber(v: string): string {
  return (v.match(/\d/g) ?? []).join('').replace(/(.{4})/g, '$1 ').trim()
}

/** All but the last four digits swapped for dots, for anywhere the vault list
 *  itself is on screen rather than the one-time entry moment. */
function maskCardNumber(v: string): string {
  const digits = (v.match(/\d/g) ?? []).join('')
  if (digits.length <= 4) return formatCardNumber(digits)
  const last4 = digits.slice(-4)
  const groups = Math.ceil((digits.length - 4) / 4)
  return `${'•••• '.repeat(groups)}${last4}`
}

/** A contactless-payment wave, the other generic glass-card decoration next
 *  to the network name — again not any one network's mark. */
function ContactlessGlyph() {
  return (
    <svg className="cc-contactless" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M8.5 8.5a5 5 0 010 7" />
      <path d="M11.5 5.5a9 9 0 010 13" />
      <path d="M14.5 2.5a13 13 0 010 19" />
    </svg>
  )
}

/**
 * The network's mark, worn bottom-right the way a real card wears it.
 *
 * Simple geometric/wordmark renderings rather than traced logo artwork —
 * enough to tell three cards apart at a glance in the grid, which is the
 * entire job here. A card with no network chosen yet falls back to the
 * generic interlocking rings so the corner is never empty while typing.
 */
function CardNetworkMark({ network }: { network: CardNetwork | '' }) {
  if (network === 'Visa') {
    return (
      <span className="cc-net cc-net-visa" aria-label="Visa">
        VISA
      </span>
    )
  }
  if (network === 'Mastercard') {
    // The two overlapping circles, with the overlap painted as its own arc —
    // that band is the part that actually reads as "Mastercard" rather than
    // as any two circles.
    return (
      <svg className="cc-net" viewBox="0 0 46 28" width="46" height="28" aria-label="Mastercard">
        <circle cx="17" cy="14" r="12" fill="#eb001b" />
        <circle cx="29" cy="14" r="12" fill="#f79e1b" />
        <path
          d="M23 4.8a12 12 0 0 0 0 18.4 12 12 0 0 0 0-18.4Z"
          fill="#ff5f00"
        />
      </svg>
    )
  }
  if (network === 'RuPay') {
    return (
      <span className="cc-net cc-net-rupay" aria-label="RuPay">
        <span>Ru</span>
        <span>Pay</span>
      </span>
    )
  }
  return (
    <span className="cc-rings" aria-hidden>
      <span className="cc-ring" />
      <span className="cc-ring" />
    </span>
  )
}

function CardPreview({
  tone,
  holder,
  number,
  expiry,
  network,
  bank,
  cardType,
  cvv,
  masked,
}: {
  tone: number
  holder: string
  number: string
  expiry: string
  network: CardNetwork | ''
  bank?: string
  cardType?: string
  cvv?: string
  masked?: boolean
}) {
  return (
    <div className="cc-card" data-tone={tone}>
      <div className="cc-card-top">
        <div className="cc-brand">
          <span className="cc-brand-mark" aria-hidden />
          {/* The issuer, worn as the card's wordmark — a real card puts its
              bank here and its network's logo in the opposite corner, which
              is where CardNetworkMark goes. A card with no bank typed shows
              its type instead so the corner is never blank. */}
          <span className="cc-brand-name">{bank || cardType || 'CARD'}</span>
        </div>
        <ContactlessGlyph />
      </div>

      {/* Split into its groups so they can spread edge to edge rather than
          sitting in one clump — the reference card spaces them across the
          full width of the face. */}
      <div className="cc-number">
        {((masked ? maskCardNumber(number) : formatCardNumber(number)) || '•••• •••• •••• ••••')
          .split(' ')
          .map((group, i) => (
            <span key={i}>{group}</span>
          ))}
      </div>

      <div className="cc-card-bottom">
        <div className="cc-card-bottom-left">
          <div>
            <div className="cc-label">Expires</div>
            <div className="cc-value">{expiry || 'MM/YY'}</div>
          </div>
          <div>
            <div className="cc-label">Code</div>
            {/* Never the real CVV on the face, even revealed — a card's
                printed code lives on its back for the same reason, and the
                editor is where you go to actually read it. */}
            <div className="cc-value">{cvv ? '•••' : '—'}</div>
          </div>
          <div className="cc-card-holder">
            <div className="cc-label">Name</div>
            <div className="cc-value">{holder || 'YOUR NAME'}</div>
          </div>
        </div>
        <CardNetworkMark network={network} />
      </div>
    </div>
  )
}

/**
 * A pixel that grows from nothing to `maxSize` (or the reverse), ported from
 * the react-bits PixelCard effect. That version drives it off hover/focus;
 * there is no hover on a phone, so here it is driven by an explicit
 * grow/shrink call each frame instead, timed to a tap rather than a mouse.
 */
class RevealPixel {
  x: number
  y: number
  color: string
  size: number
  sizeStep: number
  maxSize: number
  delay: number
  counter = 0
  counterStep: number
  isIdle = false

  constructor(w: number, h: number, x: number, y: number, color: string, delay: number, startFull: boolean) {
    this.x = x
    this.y = y
    this.color = color
    // Halved again from the second pass, which still only stretched the
    // dissolve to ~1s worst-case — still read as a flash, not an effect.
    // This lands the slowest pixels (farthest from centre, smallest step)
    // around 3s, which is what was actually asked for.
    this.sizeStep = 0.03 + Math.random() * 0.06
    this.maxSize = 1 + Math.random() * 1.5
    this.delay = delay
    this.counterStep = Math.random() * 4 + (w + h) * 0.01
    this.size = startFull ? this.maxSize : 0
  }
  draw(ctx: CanvasRenderingContext2D) {
    const off = this.maxSize * 0.5 - this.size * 0.5
    ctx.fillStyle = this.color
    ctx.fillRect(this.x + off, this.y + off, this.size, this.size)
  }
  grow(ctx: CanvasRenderingContext2D) {
    this.isIdle = false
    if (this.counter <= this.delay) {
      this.counter += this.counterStep
      this.draw(ctx)
      return
    }
    this.size = Math.min(this.maxSize, this.size + this.sizeStep)
    this.draw(ctx)
  }
  shrink(ctx: CanvasRenderingContext2D) {
    if (this.counter <= this.delay) {
      this.counter += this.counterStep
      this.draw(ctx)
      return
    }
    if (this.size <= 0) {
      this.isIdle = true
      return
    }
    this.size = Math.max(0, this.size - this.sizeStep * 0.7)
    this.draw(ctx)
  }
}

/** Neutral, light — reads on top of every card tone rather than clashing
 *  with whichever gradient it's covering. */
const PIXEL_FX_COLORS = '#ffffff,#f1f5f9,#cbd5e1'

/**
 * The pixel dissolve itself: a burst covering the whole tile that either
 * shrinks away to reveal what's underneath (`mode="out"`, the true details
 * appear the instant this starts) or grows to cover it (`mode="in"`, right
 * before the caller swaps the numbers back to masked).
 */
function CardPixelFx({ mode, onDone }: { mode: 'in' | 'out'; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return
    const rect = parent.getBoundingClientRect()
    const w = Math.max(1, Math.floor(rect.width))
    const h = Math.max(1, Math.floor(rect.height))
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const palette = PIXEL_FX_COLORS.split(',')
    const gap = 4
    const startFull = mode === 'out'
    const pixels: RevealPixel[] = []
    for (let x = 0; x < w; x += gap) {
      for (let y = 0; y < h; y += gap) {
        const dx = x - w / 2
        const dy = y - h / 2
        // Scaled up alongside the slower sizeStep below — a bigger spread
        // between the centre pixels' delay and the corner pixels' means the
        // dissolve visibly sweeps outward over the full ~3s instead of
        // finishing its stagger in the first quarter-second and then just
        // sitting there shrinking uniformly.
        const delay = Math.sqrt(dx * dx + dy * dy) * 0.55
        pixels.push(new RevealPixel(w, h, x, y, palette[Math.floor(Math.random() * palette.length)], delay, startFull))
      }
    }

    let prev = performance.now()
    const start = prev
    const method = mode === 'out' ? 'shrink' : 'grow'
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      const now = performance.now()
      if (now - prev < 1000 / 60) return
      prev = now
      ctx.clearRect(0, 0, w, h)
      let allIdle = true
      for (const p of pixels) {
        p[method](ctx)
        if (!p.isIdle) allIdle = false
      }
      if (mode === 'out' && allIdle) {
        cancelAnimationFrame(rafRef.current)
        doneRef.current()
      }
      // Capped rather than left to wait for every last pixel, same reason
      // as before: covering reads as complete once the tile is visually
      // solid, and a handful of outlier pixels still finishing their grow
      // underneath same-coloured neighbours would just hold the sheet open
      // for longer with nothing left to see. Raised from 900ms in step with
      // the slower shrink so covering takes roughly as long as revealing did.
      if (mode === 'in' && now - start > 3000) {
        cancelAnimationFrame(rafRef.current)
        doneRef.current()
      }
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [mode])

  return <canvas ref={canvasRef} className="cc-pixel-fx" />
}

/**
 * One saved card. Stays masked until tapped — a tap dissolves the pixel
 * burst away to reveal the real number for a few seconds, then covers it
 * back up on its own. Tapping again while it's already revealed opens the
 * editor, since at that point a second tap can only mean "I meant this one."
 */
function CardTile({
  item,
  data,
  onEdit,
}: {
  item: VaultItem
  data: VaultItemPlain
  onEdit: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  const [fx, setFx] = useState<'in' | 'out' | null>(null)
  const hideTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  const get = (label: string) => data.fields.find((f) => f.label === label)?.value ?? ''
  const brand = readCardBrand(get)

  const hide = () => {
    setFx('in')
  }

  const onClick = () => {
    if (revealed) {
      onEdit()
      return
    }
    setRevealed(true)
    setFx('out')
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(hide, 6000)
  }

  return (
    <button className="cc-grid-item" onClick={onClick}>
      <div className="cc-tile-wrap">
        <div className="cc-liquid-wrap">
          <CardPreview
            tone={toneForKey(item.id)}
            holder={get(CARD_FIELD.holder) || data.title}
            number={get(CARD_FIELD.number)}
            expiry={get(CARD_FIELD.expiry)}
            network={brand.network}
            bank={brand.bank}
            cardType={get(CARD_FIELD.type)}
            cvv={get(CARD_FIELD.cvv)}
            masked={!revealed}
          />
        </div>
        {fx && (
          <CardPixelFx
            mode={fx}
            onDone={() => {
              if (fx === 'in') setRevealed(false)
              setFx(null)
            }}
          />
        )}
      </div>
    </button>
  )
}

const CATEGORY_TEMPLATE: Record<VaultCategory, { label: string; sensitive?: boolean }[]> = {
  bank: [
    { label: 'Account Holder' },
    { label: 'Account Number', sensitive: true },
    { label: 'IFSC Code' },
    { label: 'Bank Name' },
    { label: 'Branch' },
    { label: 'UPI ID' },
  ],
  card: [
    { label: 'Card Holder' },
    { label: 'Card Number', sensitive: true },
    { label: 'Expiry (MM/YY)' },
    { label: 'CVV', sensitive: true },
    { label: 'Network / Bank' },
  ],
  gst: [
    { label: 'Business Name' },
    { label: 'GSTIN', sensitive: true },
    { label: 'Registered Address' },
    { label: 'State Code' },
  ],
  other: [],
}

export function Authentication({
  pendingShareFiles,
  onConsumedShareFiles,
}: {
  /** Files just shared in from another app — see lib/shareIntent.ts. */
  pendingShareFiles: File[]
  onConsumedShareFiles: () => void
}) {
  const { db } = useStore()
  const [key, setKey] = useState<CryptoKey | null>(null)
  const [inner, setInner] = useState<InnerTab>('Vault')
  // Handed off from the prop into local state the moment the vault is
  // actually unlocked — the PIN gate is a hard boundary a share does not
  // get to skip, so files just sit in the prop, untouched, until then.
  // Local state from here on so DocumentsPanel can clear it once the whole
  // batch has been filed, without this component needing to hear back from
  // App.tsx per file.
  //
  // The whole array goes to the editor together and stays together — sharing
  // several photos at once used to open the editor once per file, filing
  // each as its own document, which turned one shared thing (five pages of
  // one agreement, three photos of one bill) into five or three unrelated
  // ones. One share is one document now.
  const [shareQueue, setShareQueue] = useState<File[]>([])
  useEffect(() => {
    if (!key || pendingShareFiles.length === 0) return
    setShareQueue(pendingShareFiles)
    setInner('Documents')
    onConsumedShareFiles()
    // onConsumedShareFiles is a fresh closure every render (it wraps a
    // setState call in App.tsx) — depending on it would re-run this on every
    // unrelated App.tsx render, not just when a share actually arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pendingShareFiles])
  const [plainVault, setPlainVault] = useState<Record<string, VaultItemPlain>>({})
  const [plainPw, setPlainPw] = useState<Record<string, PasswordItemPlain>>({})
  const [broken, setBroken] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!key) return
    let alive = true
    ;(async () => {
      const v: Record<string, VaultItemPlain> = {}
      const p: Record<string, PasswordItemPlain> = {}
      const brk = new Set<string>()
      for (const item of db.vaultItems) {
        try {
          v[item.id] = await decryptJSON<VaultItemPlain>(key, item.cipher)
        } catch {
          brk.add(item.id)
        }
      }
      for (const item of db.passwordItems) {
        try {
          p[item.id] = await decryptJSON<PasswordItemPlain>(key, item.cipher)
        } catch {
          brk.add(item.id)
        }
      }
      if (alive) {
        setPlainVault(v)
        setPlainPw(p)
        setBroken(brk)
      }
    })()
    return () => {
      alive = false
    }
  }, [key, db.vaultItems, db.passwordItems])

  const innerSwipe = useSwipe(
    () => {
      const i = INNER_TABS.indexOf(inner)
      if (i < INNER_TABS.length - 1) setInner(INNER_TABS[i + 1])
    },
    () => {
      const i = INNER_TABS.indexOf(inner)
      if (i > 0) setInner(INNER_TABS[i - 1])
    },
  )

  if (!key) return <VaultLock onUnlock={setKey} />

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      {...innerSwipe}
      // Swiping inside the vault moves between Vault and Passwords and stops
      // there — the stopPropagation keeps it off the shell's tab swipe, so a
      // sideways drag can never carry you out of an unlocked vault.
      //
      // It has to happen here, in the bubble phase, *after* handing the event
      // to the swipe. It used to be an onPointerDownDownCapture on this same
      // element, which killed the very gesture it was protecting: stopping
      // propagation during capture means the event never reaches the target
      // and so never bubbles back, and this element's own bubble-phase
      // onPointerDown — the swipe's — was never called. The handlers were
      // wired up correctly the whole time and simply never heard a pointer.
      onPointerDown={(e) => {
        innerSwipe.onPointerDown(e)
        e.stopPropagation()
      }}
    >
      {/* The collage itself is rendered by the shell (see VaultDreamBg in
          App.tsx), not here — it has to sit behind the app header and the
          bottom bar too, and both of those are siblings of this screen
          rather than children of it. */}

      {/* Glass rather than its own opaque bar, so the collage runs unbroken
          from the top of the screen down and bends under this strip instead
          of stopping at it. The hairline goes: a rule across a photo reads as
          a seam rather than as an edge. */}
      <div className="vault-tabbar flex items-center gap-2 px-4 py-2 shrink-0">
        {INNER_TABS.map((t) => (
          <button
            key={t}
            className="px-4 py-1.5 rounded-full text-[13px]"
            style={{
              background: inner === t ? 'var(--accent)' : 'var(--bg)',
              color: inner === t ? '#fff' : 'var(--muted)',
            }}
            onClick={() => setInner(t)}
          >
            {t}
          </button>
        ))}
        <span className="flex-1" />
        <button
          className="w-8 h-8 shrink-0 flex items-center justify-center text-[15px] rounded-full"
          style={{ color: 'var(--muted)' }}
          onClick={() => setKey(null)}
          aria-label="Lock Shafali"
        >
          🔒
        </button>
      </div>

      {inner === 'Vault' ? (
        <VaultPanel vaultKey={key} plain={plainVault} broken={broken} />
      ) : inner === 'Passwords' ? (
        <PasswordPanel vaultKey={key} plain={plainPw} broken={broken} />
      ) : (
        <DocumentsPanel
          initialFiles={shareQueue}
          onConsumedInitialFiles={() => setShareQueue([])}
        />
      )}
    </div>
  )
}

/* ------------------------------- Lock ------------------------------- */

const SEQUENCE_LEN = 4

function VaultLock({ onUnlock }: { onUnlock: (key: CryptoKey) => void }) {
  const { db, setVaultSecurity } = useStore()
  const [sequence, setSequence] = useState<LockIconId[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const heroRef = useRef<HTMLDivElement>(null)
  const keysRef = useRef<HTMLDivElement>(null)

  // First-ever visit: no lock exists yet, so this same screen doubles as
  // setup — pick four icons, in order, then tap the same four again to
  // confirm, rather than silently provisioning a lock nobody actually
  // chose. `firstSequence` holds what was tapped on the first pass while
  // the second one is entered; it is never written anywhere and means
  // nothing once setup finishes.
  //
  // There is deliberately still no "forgot it" recovery — same as before,
  // just with a real consequence now: forgetting a sequence only you chose
  // locks the vault for good, where forgetting the old fixed 6666 never
  // could.
  const setupNeeded = !db.vaultSecurity
  const [firstSequence, setFirstSequence] = useState<LockIconId[] | null>(null)
  const confirming = setupNeeded && firstSequence !== null

  const provision = async (chosen: LockIconId[]) => {
    setBusy(true)
    const salt = randomSaltB64()
    const key = await deriveVaultKey(sequenceToPassphrase(chosen), salt)
    const check = await encryptText(key, CANARY)
    setVaultSecurity({ salt, check })
    // Same as unlocking right after — no reason to make the owner tap the
    // sequence they just chose a third time.
    hapticMedium()
    onUnlock(key)
  }

  /**
   * The one place in this app that spends a real motion budget.
   *
   * Was a ~720ms anime.js timeline — the four cells confirming in turn, the
   * keypad peeling away key by key, the card opening out. That went with
   * anime.js itself when the app was stripped back for speed; the vault now
   * opens on the next frame.
   *
   * Kept as a resolving promise rather than deleted outright so the caller's
   * `await` and its ordering (haptic first, then open) stay exactly as they
   * were, and so the wrong-PIN path is still the only one that branches.
   */
  const playUnlock = () => Promise.resolve()

  const tryUnlock = async (entered: LockIconId[]) => {
    if (!db.vaultSecurity) return
    setBusy(true)
    setError('')
    try {
      const key = await deriveVaultKey(sequenceToPassphrase(entered), db.vaultSecurity.salt)
      const decoded = await decryptText(key, db.vaultSecurity.check)
      if (decoded !== CANARY) throw new Error('mismatch')
      // Only after the sequence is known good — a wrong one must still fail
      // instantly, with the shake and nothing else. Playing this first would
      // have made every mistake take three quarters of a second to be told about.
      hapticMedium()
      await playUnlock()
      onUnlock(key)
    } catch {
      // The one unambiguous failure on this screen. The card's red flash is
      // easy to miss when you are looking at the icon grid, not the card.
      hapticError()
      setError('Wrong sequence')
      setSequence([])
      setBusy(false)
    }
  }

  const onPick = (id: LockIconId) => {
    setError('')
    hapticLight()
    // Purely appends — no side effect. `tryUnlock` used to be called from
    // inside this updater, which meant it ran *twice* on every completed
    // sequence: React deliberately double-invokes state updaters in
    // development to catch exactly this kind of impurity, so the key
    // derivation and the wrong-sequence branch both fired two times over.
    // It went unnoticed while the only symptom was a doubled vibration
    // nobody could distinguish from one; it is obvious the moment a wrong
    // sequence buzzes the error pattern twice. Attempting the unlock
    // belongs in the effect below, which reacts to the sequence being
    // complete rather than doing work mid-update.
    setSequence((s) => (s.length >= SEQUENCE_LEN ? s : [...s, id]))
  }
  const onBackspace = () => setSequence((s) => s.slice(0, -1))

  // Fires once the fourth icon lands. Keyed on the sequence itself rather
  // than on a counter, so clearing it after a failure (setSequence([])
  // below) is what re-arms this for the next attempt. Branches three ways:
  // a normal unlock, the first of the two setup passes (remember it, ask
  // again), or the second (provision if it matches what was just tapped,
  // otherwise start setup over rather than silently keeping only one of
  // the two).
  useEffect(() => {
    if (sequence.length !== SEQUENCE_LEN) return
    if (!setupNeeded) {
      void tryUnlock(sequence)
      return
    }
    if (!confirming) {
      setFirstSequence(sequence)
      setSequence([])
      return
    }
    if (sequence.join() === firstSequence?.join()) {
      void provision(sequence)
    } else {
      hapticError()
      setError("Didn't match — try again")
      setFirstSequence(null)
      setSequence([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequence])

  return (
    <div className="vault-lock">
      {/* The pagoda watercolour behind the screen — shown sharp, not
          refracted; the hero card and keypad stay plain glass-free panels
          over it. */}
      <div className="vault-photo-bg" aria-hidden>
        <img src="/img/vault-pagoda.jpg" alt="" />
      </div>
      {/* The dotted ground the whole screen sits on. */}
      <div className="vault-grain" aria-hidden />

      <div className="relative flex-1 flex flex-col items-center justify-center gap-6 px-7">
        {/* The hero. A gradient card carrying the one thing that matters here
            — how much of the PIN is in — with a dotted arc under it, the way
            the reference puts its dotted curve beneath the readout. */}
        <div ref={heroRef} className="vault-hero" data-error={error ? true : undefined}>
          <div className="vault-hero-label">Shafali</div>

          {/* Blank cells, not the icons themselves — the whole point of
              picking icons instead of typing a PIN into a field in full
              view is lost if the readout then displays exactly which four
              were tapped for anyone glancing at the card instead of the
              grid. Same "count, not content" property the digit PIN's
              cells always had. */}
          <div className="vault-pin">
            {Array.from({ length: SEQUENCE_LEN }, (_, i) => (
              <span key={i} className="vault-pin-cell" data-on={i < sequence.length || undefined} />
            ))}
          </div>

          <div className="vault-hero-sub">
            {busy
              ? confirming
                ? 'Setting up…'
                : 'Unlocking…'
              : error
                ? error
                : setupNeeded
                  ? confirming
                    ? 'Tap the same four again to confirm'
                    : 'Pick 4 icons, in order'
                  : 'Locked'}
          </div>

          {/* Dotted arcs, drawn rather than an image — three concentric
              sweeps, the innermost brightening as the sequence fills so the
              card itself registers progress and not just the cells. */}
          {/* The viewBox is taller than the arcs reach, so the outermost ring
              lands inside it instead of being sliced through a row of dots at
              the card's edge. */}
          <svg className="vault-arcs" viewBox="0 0 200 62" aria-hidden>
            {[0, 1, 2].map((ring) => {
              const r = 44 + ring * 13
              const dots = 18 + ring * 5
              return Array.from({ length: dots }, (_, i) => {
                const t = i / (dots - 1)
                const a = Math.PI * (1 - t)
                const lit = ring === 0 && t <= sequence.length / SEQUENCE_LEN
                return (
                  <circle
                    key={`${ring}-${i}`}
                    cx={100 + r * Math.cos(a)}
                    cy={58 - r * Math.sin(a) * 0.6}
                    r={lit ? 1.9 : 1.2}
                    fill="#fff"
                    opacity={lit ? 0.95 : 0.26 - ring * 0.06}
                  />
                )
              })
            })}
          </svg>
        </div>

        <div ref={keysRef} className="vault-keys">
          {LOCK_ICON_IDS.map((id) => {
            const Icon = LOCK_ICON_MAP[id]
            return (
              <button
                key={id}
                className="vault-key"
                aria-label={id}
                disabled={busy}
                onClick={() => onPick(id)}
              >
                <Icon size={22} strokeWidth={2} />
              </button>
            )
          })}
          {/* Blank either side of backspace, not a disabled key — rendered
              as a button it still picked up the global disabled styling and
              sat there looking like a control you were being refused. */}
          <span aria-hidden />
          <button className="vault-key" disabled={busy} onClick={onBackspace} aria-label="Backspace">
            ⌫
          </button>
          <span aria-hidden />
        </div>
      </div>
    </div>
  )
}

/* -------------------------- shared: copy field -------------------------- */

function maskValue(v: string): string {
  if (v.length <= 4) return '••••'
  return '•'.repeat(Math.min(10, v.length - 4)) + v.slice(-4)
}

/** Opens WhatsApp with the value pre-filled in the compose box — the user
 *  still picks who to send it to and taps send themselves in WhatsApp, this
 *  only saves them retyping an account number for a bank transfer. */
function shareToWhatsApp(value: string) {
  window.open(`https://wa.me/?text=${encodeURIComponent(value)}`, '_blank')
}

function ActionBtn({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
  active?: boolean
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      className="shrink-0 text-[11px] px-2.5 py-1.5 rounded-full"
      style={{
        background: active ? 'var(--income)' : 'var(--bg)',
        color: active ? '#fff' : 'var(--accent)',
      }}
    >
      {children}
    </button>
  )
}

/**
 * The read-only row for one field: big enough to actually read at arm's
 * length, since most opens of a saved account are to look something up, not
 * to edit it. "Read aloud" spells the value out one character at a time with
 * a pause between each — built for copying an account number onto paper
 * without needing to keep glancing back at the screen.
 */
function DetailField({
  label,
  value,
  sensitive,
}: {
  label: string
  value: string
  sensitive?: boolean
}) {
  const [reveal, setReveal] = useState(!sensitive)
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  // This field's own read-out, so unmounting one field cannot silence
  // another's — the previous version cancelled speech globally on unmount,
  // and an entry renders one of these per saved field.
  const speech = useRef<SpeechHandle | null>(null)
  useEffect(() => () => speech.current?.cancel(), [])
  if (!value) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard denied — nothing sensible to do */
    }
  }

  const speak = () => {
    if (speaking) {
      speech.current?.cancel()
      return
    }
    // Reading a masked value aloud would defeat the mask — reveal it, so
    // what's being spoken is also what's on screen to check against.
    setReveal(true)
    setSpeaking(true)
    // `onEnd` fires on finish, on cancel, and when there's no engine at
    // all, so the button can never latch on "Stop" the way it did before.
    speech.current = speakCharacters(value, { onEnd: () => setSpeaking(false) })
  }

  return (
    <div className="py-2.5 border-b" style={{ borderColor: 'var(--line)' }}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      <div className="text-[21px] font-semibold tabular-nums truncate py-0.5">
        {reveal ? value : maskValue(value)}
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        {sensitive && (
          <ActionBtn onClick={() => setReveal((r) => !r)}>{reveal ? 'Hide' : 'Show'}</ActionBtn>
        )}
        <ActionBtn onClick={copy} active={copied}>
          {copied ? 'Copied' : 'Copy'}
        </ActionBtn>
        <ActionBtn onClick={speak} active={speaking}>
          {speaking ? 'Stop' : 'Read aloud'}
        </ActionBtn>
        <ActionBtn onClick={() => shareToWhatsApp(value)}>Share</ActionBtn>
      </div>
    </div>
  )
}

/**
 * Opened by tapping a saved bank/GST/other entry — reading it is the common
 * case, editing is not, so this is what shows first. The pencil in the
 * corner is the only way into VaultItemEditor now for these categories.
 */
function VaultItemDetail({
  item,
  data,
  onEdit,
  onClose,
}: {
  item: VaultItem
  data: VaultItemPlain
  onEdit: () => void
  onClose: () => void
}) {
  const [photoOpen, setPhotoOpen] = useState<number | null>(null)

  return (
    <Sheet open onClose={onClose} title={CATEGORY_LABEL[item.category]} full>
      <div className="p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-[19px] font-semibold truncate">{data.title}</div>
          <button
            className="shrink-0 text-[13px] px-3 py-1.5 rounded-full"
            style={{ background: 'var(--bg)', color: 'var(--text)' }}
            onClick={onEdit}
          >
            Edit
          </button>
        </div>

        {data.fields.map((f, i) => (
          <DetailField key={i} label={f.label} value={f.value} sensitive={f.sensitive} />
        ))}

        {!!data.photos?.length && (
          <div className="pt-3">
            <div className="text-[11px] mb-1.5" style={{ color: 'var(--muted)' }}>
              Photos
            </div>
            <div className="flex flex-wrap gap-2">
              {data.photos.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`attachment ${i + 1}`}
                  className="w-16 h-16 object-cover rounded"
                  onClick={() => setPhotoOpen(i)}
                />
              ))}
            </div>
          </div>
        )}

        {data.notes && (
          <div className="pt-3 text-[14px] whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>
            {data.notes}
          </div>
        )}
      </div>

      {photoOpen !== null && data.photos?.[photoOpen] && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.9)' }}
          onClick={() => setPhotoOpen(null)}
        >
          <img src={data.photos[photoOpen]} alt="" className="max-w-full max-h-full object-contain" />
          <button
            className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-[16px]"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
            onClick={() => setPhotoOpen(null)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      )}
    </Sheet>
  )
}

/**
 * The clipboard / clipboard-check glyphs for CopyField's button, in the
 * app's own icon language (24×24, 2.2 stroke, round caps, no fill) rather
 * than the generic pasted-in artwork the request referenced.
 *
 * Kept as two separate small components, not one that switches a `checked`
 * prop, because the pop-in animation (see `.copy-icon` in index.css) is
 * mount-triggered — CopyField swaps which of the two is rendered, and each
 * one animating in on its own insertion is what gives the "morphs into a
 * check" feel the original had. A single component toggling internally
 * would need extra state just to force the remount this already gets for
 * free from conditional rendering.
 */
function ClipboardIcon() {
  return (
    <svg
      className="copy-icon"
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="8" y="2.5" width="8" height="4" rx="1.2" />
      <path d="M8 4.5H6.5A2 2 0 0 0 4.5 6.5v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-13a2 2 0 0 0-2-2H16" />
    </svg>
  )
}
function ClipboardCheckIcon() {
  return (
    <svg
      className="copy-icon"
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="8" y="2.5" width="8" height="4" rx="1.2" />
      <path d="M8 4.5H6.5A2 2 0 0 0 4.5 6.5v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-13a2 2 0 0 0-2-2H16" />
      <path d="M9 13.5l2.2 2.2L15.5 11" />
    </svg>
  )
}

function CopyField({
  label,
  value,
  sensitive,
}: {
  label: string
  value: string
  sensitive?: boolean
}) {
  const [reveal, setReveal] = useState(!sensitive)
  const [copied, setCopied] = useState(false)
  if (!value) return null

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard denied — nothing sensible to do */
    }
  }

  return (
    <div className="flex items-center gap-2 text-[13px] py-0.5">
      <span className="shrink-0 w-[92px] truncate" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <span className="flex-1 truncate tabular-nums">{reveal ? value : maskValue(value)}</span>
      {sensitive && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setReveal((r) => !r)
          }}
          className="shrink-0 text-[11px]"
          style={{ color: 'var(--muted)' }}
        >
          {reveal ? 'Hide' : 'Show'}
        </button>
      )}
      <button
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy'}
        className="shrink-0 grid place-items-center w-6 h-6 rounded transition-colors"
        style={{
          background: copied ? 'var(--income)' : 'var(--bg)',
          color: copied ? '#fff' : 'var(--accent)',
        }}
      >
        {copied ? <ClipboardCheckIcon key="check" /> : <ClipboardIcon key="plain" />}
      </button>
    </div>
  )
}

/* -------------------------------- Vault -------------------------------- */

function VaultPanel({
  vaultKey,
  plain,
  broken,
}: {
  vaultKey: CryptoKey
  plain: Record<string, VaultItemPlain>
  broken: Set<string>
}) {
  const { db } = useStore()
  const [editing, setEditing] = useState<{ item: VaultItem; data: VaultItemPlain } | 'new' | null>(
    null,
  )
  const [viewing, setViewing] = useState<{ item: VaultItem; data: VaultItemPlain } | null>(null)

  const groups = (['bank', 'card', 'gst', 'other'] as VaultCategory[])
    .map((cat) => [cat, db.vaultItems.filter((v) => v.category === cat).sort((a, b) => a.order - b.order)] as const)
    .filter(([, items]) => items.length > 0)

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-content">
      {db.vaultItems.length === 0 && (
        <Empty text="Nothing saved yet — tap + to add a bank account, card or GST entry" />
      )}
      {groups.map(([cat, items]) => (
        <div key={cat}>
          <SectionLabel>{CATEGORY_LABEL[cat]}</SectionLabel>
          {cat === 'card' ? (
            <div className="cc-grid">
              {items.map((item) => {
                const data = plain[item.id]
                if (broken.has(item.id) || !data) return null
                return (
                  <CardTile
                    key={item.id}
                    item={item}
                    data={data}
                    onEdit={() => setEditing({ item, data })}
                  />
                )
              })}
            </div>
          ) : (
            items.map((item) => {
              const data = plain[item.id]
              const isBroken = broken.has(item.id)
              if (isBroken) {
                return (
                  <div
                    key={item.id}
                    className="px-4 py-3 border-b text-[13px]"
                    style={{ borderColor: 'var(--line)', color: 'var(--expense)' }}
                  >
                    Could not decrypt this entry
                  </div>
                )
              }
              if (!data) return null
              return (
                <VaultRow
                  key={item.id}
                  data={data}
                  onOpen={() => setViewing({ item, data })}
                />
              )
            })
          )}
        </div>
      ))}

      <Fab onClick={() => setEditing('new')} />

      {viewing && (
        <VaultItemDetail
          item={viewing.item}
          data={viewing.data}
          onEdit={() => {
            setEditing(viewing)
            setViewing(null)
          }}
          onClose={() => setViewing(null)}
        />
      )}

      {editing && (
        <VaultItemEditor
          vaultKey={vaultKey}
          item={editing === 'new' ? null : editing.item}
          initial={editing === 'new' ? undefined : editing.data}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/** One bank/GST row. */
function VaultRow({
  data,
  onOpen,
}: {
  data: VaultItemPlain
  onOpen: () => void
}) {
  const rowInner = (
    <>
      <div className="text-[15px] mb-1.5">{data.title}</div>
      <div>
        {data.fields.slice(0, 3).map((f, i) => (
          <CopyField key={i} label={f.label} value={f.value} sensitive={f.sensitive} />
        ))}
      </div>
      {!!data.photos?.length && (
        <div className="flex gap-1.5 mt-2">
          {data.photos.slice(0, 4).map((src, i) => (
            <img key={i} src={src} alt="" className="w-9 h-9 object-cover rounded" />
          ))}
          {data.photos.length > 4 && (
            <span
              className="w-9 h-9 rounded flex items-center justify-center text-[11px]"
              style={{ background: 'var(--bg)', color: 'var(--muted)' }}
            >
              +{data.photos.length - 4}
            </span>
          )}
        </div>
      )}
    </>
  )
  return (
    <div
      role="button"
      tabIndex={0}
      // Padding, radius and the lit edge all live in .vault-row — it is a
      // floating pane, not a full-bleed strip, so the old px/py and the
      // hairline underneath would only fight it. No `w-full`: that forces
      // width:100% of the parent on top of .vault-row's own 10px side
      // margins, so the pane ends up 20px wider than the space it has and
      // overflows past the right edge instead of sitting centred — a plain
      // block element already fills the remaining width around its margins
      // on its own.
      className="vault-row block text-left cursor-pointer"
      onClick={onOpen}
    >
      {rowInner}
    </div>
  )
}

function VaultItemEditor({
  vaultKey,
  item,
  initial,
  onClose,
}: {
  vaultKey: CryptoKey
  item: VaultItem | null
  initial?: VaultItemPlain
  onClose: () => void
}) {
  const { addVaultItem, updateVaultItemCipher, deleteVaultItem } = useStore()
  const [category, setCategory] = useState<VaultCategory>(item?.category ?? 'bank')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [fields, setFields] = useState(initial?.fields ?? [])
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [photos, setPhotos] = useState<string[]>(initial?.photos ?? [])
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoOpen, setPhotoOpen] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [saving, setSaving] = useState(false)

  const pickPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
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
      if (added.length) setPhotos((p) => [...p, ...added])
    } finally {
      setPhotoBusy(false)
    }
  }

  const chooseCategory = (cat: VaultCategory) => {
    setCategory(cat)
    if (fields.length === 0) {
      setFields(CATEGORY_TEMPLATE[cat].map((f) => ({ label: f.label, value: '', sensitive: f.sensitive })))
    }
  }

  // Card entries get five dedicated inputs feeding a live preview instead of
  // the generic label/value rows — those five still live in `fields`
  // underneath (same storage, same encryption), read and written by label so
  // a card saved before this existed still lines up.
  const getCard = (label: string) => fields.find((f) => f.label === label)?.value ?? ''
  const setCard = (label: string, value: string, sensitive?: boolean) =>
    setFields((fs) => {
      const idx = fs.findIndex((f) => f.label === label)
      if (idx === -1) return [...fs, { label, value, sensitive }]
      return fs.map((f, i) => (i === idx ? { ...f, value } : f))
    })
  const editorBrand = readCardBrand(getCard)
  /**
   * Rewrite a legacy "Network / Bank" card into the two fields that replaced
   * it, the first time it is opened here.
   *
   * Done on open rather than on save so the chooser below has a network to
   * show as already-selected — reading the legacy value for display but
   * leaving the field unwritten would light up no button, and the first tap
   * would look like it was setting something that was already true.
   *
   * Runs once per mount and only when there is actually a legacy field, so
   * it cannot fight the user's own edits afterwards.
   */
  useEffect(() => {
    if (category !== 'card') return
    const legacy = fields.find((f) => f.label === LEGACY_NETWORK_FIELD)
    if (!legacy) return
    const network = matchNetwork(legacy.value)
    const bank = stripNetwork(legacy.value)
    setFields((fs) => [
      ...fs.filter((f) => f.label !== LEGACY_NETWORK_FIELD),
      { label: CARD_FIELD.network, value: network },
      { label: CARD_FIELD.bank, value: bank },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cardExtraFields = fields
    .map((f, i) => [f, i] as const)
    // The legacy combined field is excluded alongside the current ones: on a
    // card that has not been through the migration above yet it is real data,
    // not a custom row the owner added, and listing it as one would invite
    // editing a field that is about to be replaced.
    .filter(
      ([f]) =>
        f.label !== LEGACY_NETWORK_FIELD &&
        !Object.values(CARD_FIELD).includes(f.label as (typeof CARD_FIELD)[keyof typeof CARD_FIELD]),
    )

  const save = async () => {
    if (!title.trim()) return
    setSaving(true)
    const plain: VaultItemPlain = {
      title: title.trim(),
      fields: fields.filter((f) => f.label.trim()),
      notes: notes.trim() || undefined,
      photos: photos.length ? photos : undefined,
    }
    const cipher = await encryptJSON(vaultKey, plain)
    if (item) updateVaultItemCipher(item.id, cipher)
    else addVaultItem(category, cipher)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={item ? 'Edit entry' : 'New entry'} full>
      <div className="p-4 space-y-4">
        {!item && (
          <div className="flex flex-wrap gap-2">
            {(['bank', 'card', 'gst', 'other'] as VaultCategory[]).map((c) => (
              <button
                key={c}
                className="px-3 py-1.5 rounded-full text-[12px]"
                style={{
                  background: c === category ? 'var(--accent)' : 'var(--bg)',
                  color: c === category ? '#fff' : 'var(--text)',
                }}
                onClick={() => chooseCategory(c)}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        )}

        <input
          className="w-full border-b pb-2 text-[16px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="Title (e.g. HDFC Savings)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />

        {category === 'card' && (
          <CardPreview
            tone={toneForKey(item?.id ?? (title || 'new'))}
            holder={getCard(CARD_FIELD.holder) || title}
            number={getCard(CARD_FIELD.number)}
            expiry={getCard(CARD_FIELD.expiry)}
            network={editorBrand.network}
            bank={editorBrand.bank}
            cardType={getCard(CARD_FIELD.type)}
            cvv={getCard(CARD_FIELD.cvv)}
          />
        )}

        {category === 'card' ? (
          <div className="space-y-3">
            <input
              className="w-full border-b pb-2 text-[15px]"
              style={{ borderColor: 'var(--line)' }}
              placeholder="Card holder"
              value={getCard(CARD_FIELD.holder)}
              onChange={(e) => setCard(CARD_FIELD.holder, e.target.value)}
            />
            <input
              className="w-full border-b pb-2 text-[15px] tabular-nums"
              style={{ borderColor: 'var(--line)' }}
              placeholder="Card number"
              inputMode="numeric"
              value={getCard(CARD_FIELD.number)}
              onChange={(e) => setCard(CARD_FIELD.number, e.target.value, true)}
            />
            <div className="flex gap-3">
              <input
                className="flex-1 border-b pb-2 text-[15px] tabular-nums"
                style={{ borderColor: 'var(--line)' }}
                placeholder="MM/YY"
                value={getCard(CARD_FIELD.expiry)}
                onChange={(e) => setCard(CARD_FIELD.expiry, e.target.value)}
              />
              <input
                className="flex-1 border-b pb-2 text-[15px] tabular-nums"
                style={{ borderColor: 'var(--line)' }}
                placeholder="CVV"
                inputMode="numeric"
                value={getCard(CARD_FIELD.cvv)}
                onChange={(e) => setCard(CARD_FIELD.cvv, e.target.value, true)}
              />
            </div>
            <input
              className="w-full border-b pb-2 text-[15px]"
              style={{ borderColor: 'var(--line)' }}
              placeholder="Bank (e.g. HDFC)"
              value={getCard(CARD_FIELD.bank)}
              onChange={(e) => setCard(CARD_FIELD.bank, e.target.value)}
            />

            {/* Three networks, not a text box. Every card in the country
                carries one of these, and typing it by hand only ever produced
                spellings the card face then had to guess at. Tapping the
                chosen one again clears it, so a card can still be saved
                without a network rather than being stuck with a wrong one. */}
            <div className="flex gap-2">
              {CARD_NETWORKS.map((n) => {
                const on = editorBrand.network === n
                return (
                  <button
                    key={n}
                    className="flex-1 py-2 rounded-[var(--r-sm)] text-[13px] font-semibold"
                    style={{
                      background: on ? 'var(--accent)' : 'var(--bg)',
                      color: on ? '#fff' : 'var(--text)',
                      border: `1.5px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                    }}
                    onClick={() => setCard(CARD_FIELD.network, on ? '' : n)}
                  >
                    {n}
                  </button>
                )
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              {CARD_TYPES.map((t) => (
                <button
                  key={t}
                  className="px-3 py-1.5 rounded-full text-[12px]"
                  style={{
                    background: getCard(CARD_FIELD.type) === t ? 'var(--accent)' : 'var(--bg)',
                    color: getCard(CARD_FIELD.type) === t ? '#fff' : 'var(--text)',
                  }}
                  onClick={() => setCard(CARD_FIELD.type, t)}
                >
                  {t}
                </button>
              ))}
            </div>

            {cardExtraFields.map(([f, i]) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="w-28 shrink-0 text-[12px]"
                  style={{ color: 'var(--muted)' }}
                  placeholder="Label"
                  value={f.label}
                  onChange={(e) =>
                    setFields((fs) => fs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <input
                  className="flex-1 border-b pb-1 text-[14px] min-w-0"
                  style={{ borderColor: 'var(--line)' }}
                  placeholder="Value"
                  value={f.value}
                  type={f.sensitive ? 'password' : 'text'}
                  onChange={(e) =>
                    setFields((fs) => fs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                  }
                />
                <button
                  className="shrink-0 text-[13px]"
                  style={{ color: 'var(--expense)' }}
                  onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2.5">
            {fields.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="w-28 shrink-0 text-[12px]"
                  style={{ color: 'var(--muted)' }}
                  placeholder="Label"
                  value={f.label}
                  onChange={(e) =>
                    setFields((fs) => fs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <input
                  className="flex-1 border-b pb-1 text-[14px] min-w-0"
                  style={{ borderColor: 'var(--line)' }}
                  placeholder="Value"
                  value={f.value}
                  type={f.sensitive ? 'password' : 'text'}
                  // Account numbers are the field this is actually for — the
                  // numeric keypad instead of a full keyboard for anything
                  // whose label says it's a number.
                  inputMode={/number/i.test(f.label) ? 'numeric' : undefined}
                  onChange={(e) =>
                    setFields((fs) => fs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                  }
                />
                <button
                  className="shrink-0 text-[10px]"
                  style={{ color: f.sensitive ? 'var(--accent)' : 'var(--muted)' }}
                  onClick={() =>
                    setFields((fs) => fs.map((x, j) => (j === i ? { ...x, sensitive: !x.sensitive } : x)))
                  }
                >
                  {f.sensitive ? 'mask' : 'plain'}
                </button>
                <button
                  className="shrink-0 text-[13px]"
                  style={{ color: 'var(--expense)' }}
                  onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          className="text-[13px]"
          style={{ color: 'var(--accent)' }}
          onClick={() => setFields((fs) => [...fs, { label: '', value: '' }])}
        >
          + Add field
        </button>

        {/* Passbook page, cheque leaf, the front of an ID — whatever's worth
            keeping a photo of alongside the typed fields. Same picker/viewer
            pattern the transaction editor and the Documents tab already use. */}
        <div>
          <div className="text-[11px] mb-1.5" style={{ color: 'var(--muted)' }}>
            Photos
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {photos.map((src, i) => (
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
                  onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                  aria-label={`Remove photo ${i + 1}`}
                >
                  ✕
                </button>
              </span>
            ))}
            <button
              className="w-14 h-14 rounded flex items-center justify-center text-[22px]"
              style={{ color: 'var(--accent)', border: '1.5px dashed var(--accent)' }}
              onClick={() => fileRef.current?.click()}
              aria-label="Attach a photo"
              disabled={photoBusy}
            >
              {photoBusy ? '…' : '+'}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={pickPhotos} />
        </div>

        <textarea
          className="w-full text-[14px] resize-none border-b pb-2"
          style={{ borderColor: 'var(--line)' }}
          rows={2}
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex gap-2 pt-2">
          {item && (
            <button
              className="flex-1 py-3 rounded-lg text-[14px]"
              style={{ background: 'var(--bg)', color: 'var(--expense)' }}
              onClick={() => setConfirmDel(true)}
            >
              Delete
            </button>
          )}
          <button
            className="flex-1 py-3 rounded-lg text-white text-[14px] font-semibold"
            style={{ background: 'var(--accent)' }}
            disabled={saving || !title.trim()}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>

      <Confirm
        open={confirmDel}
        title="Delete this entry?"
        confirmLabel="Delete"
        danger
        onClose={() => setConfirmDel(false)}
        onConfirm={() => {
          if (item) deleteVaultItem(item.id)
          onClose()
        }}
      />

      {photoOpen !== null && photos[photoOpen] && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.9)' }}
          onClick={() => setPhotoOpen(null)}
        >
          <img src={photos[photoOpen]} alt="" className="max-w-full max-h-full object-contain" />
          <button
            className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-[16px]"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
            onClick={() => setPhotoOpen(null)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      )}
    </Sheet>
  )
}

/* ------------------------------ Passwords ------------------------------ */

/**
 * The palette each entry's tile is built from — two colours per tone, mixed
 * into a gradient mesh by `.pw-bloom` in index.css. No brand-icon lookup, so
 * the initial carries the identity and the colour is what makes one entry
 * unmistakable from the next at a glance down the list.
 *
 * Seven tones, and the last one is teal deliberately: the previous version
 * of this list used a flat seven-colour array with the same hash, so keeping
 * the count and the ordering means every existing entry keeps the colour it
 * already had rather than everything reshuffling on upgrade.
 */
const PW_TONES = [
  { a: '#FF3D8B', b: '#6C5CE7' }, // magenta → violet
  { a: '#2E6BFF', b: '#00D4FF' }, // deep blue → cyan
  { a: '#FF7A1A', b: '#FFC24B' }, // ember → amber
  { a: '#17D07A', b: '#0B7F63' }, // signal green
  { a: '#A855F7', b: '#4F2ED9' }, // ultraviolet
  { a: '#FF4D5E', b: '#FF9A3D' }, // solar
  { a: '#22B8CF', b: '#1B6FA8' }, // teal → deep blue
]
/** Where the light sources sit inside the bloom. */
const PW_BLOBS = ['a', 'b', 'c', 'd'] as const
/** What's woven through the mesh. */
const PW_TEXTURES = ['grid', 'bars', 'weave', 'dots'] as const
/** How tall the bloom is — the axis that changes a card's proportion, not
 *  just its colour, which is what stops a run of them reading as rigid. */
const PW_BLOOMS = ['slim', 'mid', 'tall'] as const

/** Plain rolling hash — kept exactly as the previous flat-colour version of
 *  this list had it, and still used directly for the tone. The palette's hex
 *  values were redesigned (flat fills became gradient pairs), so hues do
 *  shift; what's preserved is the *slot* each entry lands in, so entries keep
 *  their positions relative to each other instead of the whole list
 *  reshuffling and every card looking unfamiliar at once. */
function hashTitle(title: string): number {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0
  return h
}

/**
 * murmur3's finalizer. The four axes below all bucket the *same* title, and
 * a rolling hash can't be split across them safely: taking it mod 4 only
 * consults its low two bits, which barely mix, so two axes picked with
 * different multipliers still landed on identical values for every entry —
 * measured, not theorised: blob and texture were in perfect lockstep (a/grid,
 * b/bars, c/weave) because both multipliers happened to be ≡ 1 (mod 4).
 *
 * Avalanching before the modulus makes every output bit depend on every
 * input bit, so seeding per axis actually decorrelates them and no bucket
 * count is a special case. Measured after: blob and texture now collide at
 * chance rate rather than always.
 */
function mix32(h: number): number {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

/** One axis's pick: same title + same seed always gives the same answer, so
 *  a card never changes appearance between renders. */
function pickFor<T>(title: string, seed: number, options: readonly T[]): T {
  return options[mix32((hashTitle(title) ^ seed) >>> 0) % options.length]
}

function toneForTitle(title: string): { a: string; b: string } {
  return PW_TONES[hashTitle(title) % PW_TONES.length]
}

const blobForTitle = (t: string) => pickFor(t, 0x9e37, PW_BLOBS)
const textureForTitle = (t: string) => pickFor(t, 0x51ed, PW_TEXTURES)
const bloomForTitle = (t: string) => pickFor(t, 0xc2b2, PW_BLOOMS)

function PwAvatar({ title }: { title: string }) {
  const letter = title.trim().charAt(0).toUpperCase() || '?'
  return (
    <div className="pw-avatar" aria-hidden>
      {letter}
    </div>
  )
}

function PasswordPanel({
  vaultKey,
  plain,
  broken,
}: {
  vaultKey: CryptoKey
  plain: Record<string, PasswordItemPlain>
  broken: Set<string>
}) {
  const { db } = useStore()
  const [editing, setEditing] = useState<{ item: PasswordItem; data: PasswordItemPlain } | 'new' | null>(
    null,
  )
  const items = [...db.passwordItems].sort((a, b) => a.order - b.order)

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-content px-3 pt-3 space-y-2.5">
      {items.length === 0 && <Empty text="No passwords saved yet — tap + to add one" />}
      {items.map((item) => {
        const data = plain[item.id]
        const isBroken = broken.has(item.id)
        if (isBroken) {
          return (
            <div
              key={item.id}
              className="pw-card px-4 py-3 text-[13px]"
              style={{ color: 'var(--expense)' }}
            >
              Could not decrypt this entry
            </div>
          )
        }
        if (!data) return null
        const tone = toneForTitle(data.title)
        return (
          <div
            key={item.id}
            className="pw-card"
            style={{ '--pw-a': tone.a, '--pw-b': tone.b } as React.CSSProperties}
          >
            <div
              className="pw-bloom"
              data-blob={blobForTitle(data.title)}
              data-tex={textureForTitle(data.title)}
              data-bloom={bloomForTitle(data.title)}
            >
              <div
                role="button"
                tabIndex={0}
                className="pw-bloom-row"
                onClick={() => setEditing({ item, data })}
              >
                <PwAvatar title={data.title} />
                {/* Just the title — the username/URL that used to sit under
                    it here is already the first row of `.pw-body` right
                    below, and repeating it made the bloom taller for no
                    second fact. */}
                <div className="pw-bloom-title flex-1 min-w-0 truncate">{data.title}</div>
              </div>
            </div>
            <div className="pw-body">
              {data.username && <CopyField label="Username" value={data.username} />}
              <CopyField label="Password" value={data.password} sensitive />
            </div>
          </div>
        )
      })}

      <Fab onClick={() => setEditing('new')} />

      {editing && (
        <PasswordItemEditor
          vaultKey={vaultKey}
          item={editing === 'new' ? null : editing.item}
          initial={editing === 'new' ? undefined : editing.data}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/**
 * Four bars under the password field.
 *
 * A rough score, not a security guarantee: length does most of the work,
 * with a point each for a digit and a symbol. It exists to stop a three-letter
 * password going in unnoticed, and it is honest about being an estimate — it
 * never blocks anything, it only says what it thinks.
 *
 * Nothing typed here leaves the field. The score is computed locally and the
 * value is never logged, stored unencrypted or sent anywhere.
 */
function scorePassword(v: string): number {
  if (!v) return 0
  let n = 0
  if (v.length >= 6) n++
  if (v.length >= 10) n++
  if (v.length >= 14) n++
  if (/\d/.test(v)) n++
  if (/[^\w\s]/.test(v)) n++
  return Math.max(0, Math.min(4, n))
}

const STRENGTH = [
  { label: '', color: 'var(--line-strong)' },
  { label: 'Weak', color: '#F2695C' },
  { label: 'Fair', color: '#F5C242' },
  { label: 'Good', color: '#9BD256' },
  { label: 'Strong', color: '#3FC77F' },
]

function StrengthMeter({ value }: { value: string }) {
  const score = scorePassword(value)
  const tone = STRENGTH[score]
  return (
    <div className="pw-meter" aria-hidden={!value}>
      <div className="pw-bars">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="pw-bar"
            data-on={i <= score || undefined}
            style={{
              background: i <= score ? tone.color : undefined,
              // each bar lands a beat after the one before it
              transitionDelay: `${(i - 1) * 45}ms`,
            }}
          />
        ))}
      </div>
      <span className="pw-label" style={{ color: tone.color }}>
        {value ? tone.label : ''}
      </span>
    </div>
  )
}

function PasswordItemEditor({
  vaultKey,
  item,
  initial,
  onClose,
}: {
  vaultKey: CryptoKey
  item: PasswordItem | null
  initial?: PasswordItemPlain
  onClose: () => void
}) {
  const { addPasswordItem, updatePasswordItemCipher, deletePasswordItem } = useStore()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState(initial?.password ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [showPw, setShowPw] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!title.trim() || !password) return
    setSaving(true)
    const plain: PasswordItemPlain = {
      title: title.trim(),
      username: username.trim() || undefined,
      password,
      url: url.trim() || undefined,
      notes: notes.trim() || undefined,
    }
    const cipher = await encryptJSON(vaultKey, plain)
    if (item) updatePasswordItemCipher(item.id, cipher)
    else addPasswordItem(cipher)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={item ? 'Edit password' : 'New password'} full>
      <div className="p-4 space-y-4">
        <input
          className="w-full border-b pb-2 text-[16px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="Site / app name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <input
          className="w-full border-b pb-2 text-[15px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="Username / email (optional)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: 'var(--line)' }}>
          <input
            className="flex-1 text-[15px] min-w-0"
            placeholder="Password"
            value={password}
            type={showPw ? 'text' : 'password'}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            className="text-[12px] shrink-0"
            style={{ color: 'var(--muted)' }}
            onClick={() => setShowPw((s) => !s)}
          >
            {showPw ? 'Hide' : 'Show'}
          </button>
        </div>
        <StrengthMeter value={password} />
        <input
          className="w-full border-b pb-2 text-[14px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="URL (optional)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <textarea
          className="w-full text-[14px] resize-none border-b pb-2"
          style={{ borderColor: 'var(--line)' }}
          rows={2}
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex gap-2 pt-2">
          {item && (
            <button
              className="flex-1 py-3 rounded-lg text-[14px]"
              style={{ background: 'var(--bg)', color: 'var(--expense)' }}
              onClick={() => setConfirmDel(true)}
            >
              Delete
            </button>
          )}
          <button
            className="flex-1 py-3 rounded-lg text-white text-[14px] font-semibold"
            style={{ background: 'var(--accent)' }}
            disabled={saving || !title.trim() || !password}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>

      <Confirm
        open={confirmDel}
        title="Delete this password?"
        confirmLabel="Delete"
        danger
        onClose={() => setConfirmDel(false)}
        onConfirm={() => {
          if (item) deletePasswordItem(item.id)
          onClose()
        }}
      />
    </Sheet>
  )
}

/* ------------------------------ Documents ------------------------------ */

function PdfGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M15 2v5h5" />
    </svg>
  )
}

/**
 * A PDF's first page, rasterised — see lib/pdf.ts. Shows `fallback` (the
 * plain document glyph) until the render resolves, and keeps showing it if
 * the render fails, since a broken image and an unreadable placeholder are
 * both "can't preview this," and only one of them still reads as a document.
 */
function PdfPage({
  dataUrl,
  alt,
  className,
  fallback,
  badge,
}: {
  dataUrl: string
  alt: string
  className?: string
  /** Shown while rendering, or in place of it if the render fails — passed
   *  the reason so a caller that cares (the viewer) can tell "still working
   *  on it" from "this one didn't work," rather than looking stuck forever
   *  on a genuinely broken file. */
  fallback: React.ReactNode | ((state: 'loading' | 'error') => React.ReactNode)
  /** Rendered alongside the image once it's actually loaded — not shown
   *  during `fallback`, whose own placeholder already says "PDF". */
  badge?: React.ReactNode
}) {
  const [state, setState] = useState<{ src: string | null; failed: boolean }>({
    src: null,
    failed: false,
  })

  useEffect(() => {
    let alive = true
    setState({ src: null, failed: false })
    renderPdfPage(dataUrl)
      .then((url) => {
        if (alive) setState({ src: url, failed: false })
      })
      .catch(() => {
        if (alive) setState({ src: null, failed: true })
      })
    return () => {
      alive = false
    }
  }, [dataUrl])

  if (!state.src) {
    const node = typeof fallback === 'function' ? fallback(state.failed ? 'error' : 'loading') : fallback
    return <>{node}</>
  }
  return (
    <>
      <img src={state.src} alt={alt} className={className} />
      {badge}
    </>
  )
}

/**
 * IDs and important paperwork, grouped by whoever they belong to.
 *
 * `category` is free text rather than a fixed list of relations — a
 * household's own set of people is not something the app can guess, so it
 * groups by whatever name was typed rather than offering a closed set.
 * Kept unencrypted (unlike Vault/Passwords) behind the same lock screen —
 * see the note on DocItem in types.ts for why.
 */
function DocumentsPanel({
  initialFiles,
  onConsumedInitialFiles,
}: {
  /** Files shared in from another app, all at once, ready to drop straight
   *  into the editor as one document instead of asking to be picked again. */
  initialFiles?: File[]
  onConsumedInitialFiles?: () => void
}) {
  const { db, deleteDocItem } = useStore()
  // 'new' and an actual item share one slot — only one editor is ever open,
  // and a DocItem here means "editing this one", same shape as VaultPanel's
  // own `editing` state for the same reason.
  const [editing, setEditing] = useState<DocItem | 'new' | null>(null)
  // Opens the editor the moment a share arrives — initialFiles changes
  // identity only when Authentication actually advances the share queue, so
  // this does not refire on every unrelated re-render of this panel.
  useEffect(() => {
    if (initialFiles?.length) setEditing('new')
  }, [initialFiles])
  const [viewing, setViewing] = useState<DocItem | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [shareNote, setShareNote] = useState('')
  /** Which person's group is folded shut — same "collapsed is the thing
   *  worth storing" reasoning as Kitee's own categories: a household with
   *  one or two people should look exactly as it did before this existed.
   *  Persisted across app restarts — see lib/usePersistedFold. */
  const [collapsed, toggleFold] = usePersistedFold('documents')

  const groups = useMemo(() => {
    const byCat = new Map<string, DocItem[]>()
    for (const d of [...db.docItems].sort((a, b) => a.order - b.order)) {
      const list = byCat.get(d.category) ?? []
      list.push(d)
      byCat.set(d.category, list)
    }
    return [...byCat.entries()]
  }, [db.docItems])

  const categories = useMemo(
    () => [...new Set(db.docItems.map((d) => d.category))].sort(),
    [db.docItems],
  )

  const exitSelect = () => {
    setSelectMode(false)
    setSelected(new Set())
    setShareNote('')
  }

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const shareSelected = async () => {
    const items = db.docItems.filter((d) => selected.has(d.id))
    if (!items.length) return
    setBusy(true)
    setShareNote('')
    try {
      // Every page of every selected document, not just its cover — a
      // three-page agreement selected here should hand over all three pages,
      // the same as opening it and sharing it on its own would.
      const pages = items.flatMap((d) =>
        d.photos.map((photo, i) => ({
          title: d.photos.length > 1 ? `${d.title} (${i + 1})` : d.title,
          dataUrl: photo,
        })),
      )
      const ok = await sharePhotos(pages)
      setShareNote(ok ? '' : "Sharing isn't available on this device")
      if (ok) exitSelect()
    } catch {
      setShareNote('Could not share those')
    } finally {
      setBusy(false)
    }
  }

  const deleteSelected = () => {
    for (const id of selected) deleteDocItem(id)
    exitSelect()
  }

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-content">
      {db.docItems.length === 0 && (
        <Empty text="Nothing saved yet — tap + to add a photo or PDF of an ID or document" />
      )}

      {db.docItems.length > 0 && (
        <div className="flex items-center justify-between px-4 pt-4 pb-1">
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
            {db.docItems.length} {db.docItems.length === 1 ? 'document' : 'documents'}
          </span>
          <button
            className="text-[13px]"
            style={{ color: 'var(--accent)' }}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          >
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        </div>
      )}

      {groups.map(([cat, items]) => {
        const shut = collapsed.has(cat)
        return (
        <div key={cat}>
          <button className="fold-row" onClick={() => toggleFold(cat)} aria-expanded={!shut}>
            <svg
              className="fold-chev"
              data-shut={shut || undefined}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
            <span className="flex-1 text-left">{cat}</span>
            <span className="fold-count num">{items.length}</span>
          </button>
          {!shut && (
          <div className="doc-grid">
            {items.map((item) => {
              const isSelected = selected.has(item.id)
              return (
                <button
                  key={item.id}
                  className="doc-thumb"
                  onClick={() => (selectMode ? toggle(item.id) : setViewing(item))}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {isPdfDataUrl(item.photos[0]) ? (
                    <PdfPage
                      dataUrl={item.photos[0]}
                      alt={item.title}
                      fallback={
                        <span className="doc-thumb-pdf" aria-hidden>
                          <PdfGlyph size={26} />
                          <span>PDF</span>
                        </span>
                      }
                      // Still worth flagging even once rendered — a scanned
                      // page looks like any other photo otherwise, and "this
                      // one opens a reader on Share" is real information a
                      // plain photo doesn't carry.
                      badge={<span className="doc-thumb-pdf-badge">PDF</span>}
                    />
                  ) : (
                    <img src={item.photos[0]} alt={item.title} />
                  )}
                  {/* A multi-page document reads as one thumbnail with a page
                      count, not as several tiles — the count is the one cue
                      that there's more behind the cover to open. */}
                  {item.photos.length > 1 && (
                    <span className="doc-thumb-pages">{item.photos.length}</span>
                  )}
                  <span className="doc-thumb-title">
                    <span className="relative">{item.title}</span>
                  </span>
                  {selectMode && <span className="doc-thumb-check" data-on={isSelected || undefined} />}
                </button>
              )
            })}
          </div>
          )}
        </div>
        )
      })}

      {!selectMode && <Fab onClick={() => setEditing('new')} />}

      {selectMode && selected.size > 0 && (
        <div className="doc-select-bar">
          <span className="text-[13px]">{selected.size} selected</span>
          <span className="flex-1" />
          {shareNote && (
            <span className="text-[12px]" style={{ color: 'var(--expense)' }}>
              {shareNote}
            </span>
          )}
          <button className="doc-select-action" disabled={busy} onClick={shareSelected}>
            Share
          </button>
          <button
            className="doc-select-action"
            style={{ color: 'var(--expense)' }}
            onClick={() => setConfirmDel(true)}
          >
            Delete
          </button>
        </div>
      )}

      {editing && (
        <DocItemEditor
          categories={categories}
          item={editing === 'new' ? null : editing}
          // A shared batch only ever applies to a brand-new document — this
          // panel doesn't reopen the editor mid-edit with a fresh set of
          // shared files, so an edit in progress never sees a stale batch.
          initialFiles={editing === 'new' ? initialFiles : undefined}
          onClose={() => {
            setEditing(null)
            // Advances the queue whether or not they actually hit Save —
            // closing is "I'm done with this," not "try again later," and
            // reopening the same batch on every dismiss would be a loop with
            // no way out short of unsharing it.
            if (editing === 'new' && initialFiles?.length) onConsumedInitialFiles?.()
          }}
        />
      )}
      {viewing && (
        <DocViewer
          item={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing)
            setViewing(null)
          }}
        />
      )}

      <Confirm
        open={confirmDel}
        title={`Delete ${selected.size} ${selected.size === 1 ? 'document' : 'documents'}?`}
        confirmLabel="Delete"
        danger
        onClose={() => setConfirmDel(false)}
        onConfirm={deleteSelected}
      />
    </div>
  )
}

function DocItemEditor({
  categories,
  item,
  onClose,
  initialFiles,
}: {
  categories: string[]
  /** null for a new document; an existing one to edit it in place. Same
   *  editor either way — a document being edited starts from its own saved
   *  fields instead of blank ones, and writes back with updateDocItem
   *  instead of creating a second document. */
  item: DocItem | null
  onClose: () => void
  /** Already picked, from another app's Share sheet — read through the same
   *  fileToAttachment() a manual pick would go through, just without the tap
   *  on "+ Add a photo or PDF" to start it. Several files share in as the
   *  pages of one document, not as one document each. Only ever set when
   *  `item` is null — a share cannot land mid-edit of an existing one. */
  initialFiles?: File[]
}) {
  const { addDocItem, updateDocItem } = useStore()
  const [category, setCategory] = useState(item?.category ?? '')
  // A real filename ("Aadhar_scan.pdf") is a better starting point than a
  // blank field, though it's still just a suggestion — the extension is
  // stripped since nobody titles a document by its file type. Several shared
  // files take their title from the first; the rest are pages of the same
  // document, not documents with names of their own.
  const [title, setTitle] = useState(
    item?.title ?? (initialFiles?.[0] ? initialFiles[0].name.replace(/\.[^./]+$/, '') : ''),
  )
  const [photos, setPhotos] = useState<string[]>(item?.photos ?? [])
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [busy, setBusy] = useState(!!initialFiles?.length)

  useEffect(() => {
    if (!initialFiles?.length) return
    let alive = true
    ;(async () => {
      const read: string[] = []
      for (const f of initialFiles) {
        try {
          read.push(await fileToAttachment(f))
        } catch {
          /* one unreadable file in the batch shouldn't lose the rest */
        }
      }
      if (alive) setPhotos(read)
      if (alive) setBusy(false)
    })()
    return () => {
      alive = false
    }
    // initialFiles is only ever set once per mount of this editor — a new
    // shared batch gets a whole new DocItemEditor instance (see
    // DocumentsPanel's `editing` effect), not a prop update on this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = () => {
    if (!category.trim() || !title.trim() || photos.length === 0) return
    const fields = {
      category: category.trim(),
      title: title.trim(),
      photos,
      notes: notes.trim() || undefined,
    }
    if (item) updateDocItem({ ...item, ...fields })
    else addDocItem(fields)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={item ? 'Edit document' : 'New document'} full>
      <div className="p-4 space-y-4">
        <SuggestInput
          value={category}
          onChange={setCategory}
          options={categories}
          placeholder="Who is this for? (e.g. Mom, Dad)"
          autoFocus={!item}
        />
        <input
          className="w-full border-b pb-2 text-[15px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="What is it? (e.g. Aadhar card)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {/* The same multi-file strip a vault entry or a loan's paperwork
            already uses — reused rather than a second one-photo picker built
            just for this screen. Pick again to add another page, or several
            at once; a document with pages doesn't have to pick which one is
            "the" photo. Editing an existing document starts from its real
            pages, so removing one here and saving actually drops it — this
            is the only place that was ever possible before. */}
        <AttachmentGrid files={photos} onChange={setPhotos} label="Pages" />
        {busy && (
          <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
            Reading file…
          </div>
        )}

        <textarea
          className="w-full border-b pb-2 text-[14px] resize-none"
          style={{ borderColor: 'var(--line)' }}
          placeholder="Notes (optional) — a renewal date, a reference number, anything worth remembering about this one"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <button
          className="w-full py-3 rounded-lg text-white text-[15px] font-semibold"
          style={{ background: 'var(--accent)' }}
          disabled={!category.trim() || !title.trim() || photos.length === 0}
          onClick={save}
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}

function DocViewer({
  item,
  onClose,
  onEdit,
}: {
  item: DocItem
  onClose: () => void
  onEdit: () => void
}) {
  const { deleteDocItem } = useStore()
  const [busy, setBusy] = useState(false)
  const [shareNote, setShareNote] = useState('')

  const share = async () => {
    setBusy(true)
    setShareNote('')
    try {
      const ok = await sharePhotos(
        item.photos.map((photo, i) => ({
          title: item.photos.length > 1 ? `${item.title} (${i + 1})` : item.title,
          dataUrl: photo,
        })),
      )
      if (!ok) setShareNote("Sharing isn't available on this device")
    } catch {
      setShareNote('Could not share that')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={item.title} full>
      <div className="p-4 space-y-3 flex flex-col h-full">
        <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
          {item.category}
          {item.photos.length > 1 && ` · ${item.photos.length} pages`}
        </div>
        {/* One page after another, scrolling — a document with several pages
            reads as a stack, not as a single image with the rest hidden
            somewhere. */}
        <div className="flex-1 overflow-y-auto no-scrollbar space-y-3">
          {item.photos.map((photo, i) =>
            isPdfDataUrl(photo) ? (
              <PdfPage
                key={i}
                dataUrl={photo}
                alt={`${item.title} ${i + 1}`}
                className="doc-viewer-photo"
                fallback={(state) => (
                  <div className="doc-viewer-pdf">
                    <PdfGlyph size={40} />
                    {state === 'error' ? (
                      <>
                        <span>Couldn't render this page.</span>
                        <span>Tap Share below to open it with a PDF reader.</span>
                      </>
                    ) : (
                      <span>Rendering this page…</span>
                    )}
                  </div>
                )}
              />
            ) : (
              <img key={i} src={photo} alt={`${item.title} ${i + 1}`} className="doc-viewer-photo" />
            ),
          )}
        </div>
        {item.notes && (
          <div className="doc-viewer-notes">
            <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Notes
            </div>
            <div className="text-[14px] whitespace-pre-wrap">{item.notes}</div>
          </div>
        )}
        {shareNote && (
          <div className="text-[12px] text-center" style={{ color: 'var(--expense)' }}>
            {shareNote}
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <HoldConfirm label="Delete document" onConfirm={() => { deleteDocItem(item.id); onClose() }} />
          <button
            className="flex-1 py-3 rounded-lg text-[14px]"
            style={{ background: 'var(--bg)', color: 'var(--accent)' }}
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            className="flex-1 py-3 rounded-lg text-white text-[14px] font-semibold"
            style={{ background: 'var(--accent)' }}
            disabled={busy}
            onClick={share}
          >
            Share
          </button>
        </div>
      </div>
    </Sheet>
  )
}
