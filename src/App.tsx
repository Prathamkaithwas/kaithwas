import { useEffect, useMemo, useRef, useState } from 'react'
import type { Chore, Habit, Memo, Transaction } from './types'
import { StoreProvider, useStore } from './store'
import { ToastProvider } from './components/Toast'
import {
  addDays,
  addMonths,
  dayLabel,
  daysUntilEmi,
  MONTHS_SHORT,
  todayKey,
  todayMonth,
} from './lib/date'
import { formatMoney } from './lib/money'
import { Fab, MonthPicker, PeriodStepper, Sheet, SubTabs } from './components/ui'
import { FanFab } from './components/FanFab'
import { PHOENIX_PATHS, PHOENIX_VIEWBOX } from './lib/phoenixArt'
import { Partner } from './screens/Partner'
import {
  Wallet,
  BarChart3,
  Landmark,
  HandCoins,
  Users,
  Package,
  History,
  Star,
  Heart,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react'
import { WeekPicker } from './components/WeekPicker'
import { Hidden } from './screens/Hidden'
import { TAB_THEME, TITLE_TABS, Total, Trans, orderedTransTabs, type TransTab } from './screens/Trans'
import { PlannerSheet } from './screens/Planner'
import { BalancePanel } from './screens/Balance'
import { SuppliersSheet } from './screens/Suppliers'
import { Stats, STATS_PERIODS, type StatsPeriod, type StatsRange } from './screens/Stats'
import { Accounts } from './screens/Accounts'
import { Loans } from './screens/Loans'
import { StockPanel } from './screens/Stock'
import { LastDone } from './screens/LastDone'
import { PurchasePanel } from './screens/Purchase'
import { More, MoreScreens, type DeepLink } from './screens/More'
import { Search } from './screens/Search'
import { TxEditor } from './screens/TxEditor'
import { Authentication } from './screens/Authentication'
import { categoryName } from './lib/calc'
import { CAT, LOTUS, PixelIcon, SHARK, type PixelArt } from './components/PixelIcon'
import { LotusMark } from './components/LotusMark'
import {
  offDeviceOverdue,
  runDailyBackup,
  sendBackupOffDevice,
  snoozeOffDeviceNudge,
} from './lib/backup'
import { useSwipe } from './lib/useSwipe'
import { hapticLight, hapticMedium } from './lib/haptics'
import { ripple } from './lib/fx'
import { useBackHandler, popBackHandler } from './lib/back'
import { keepFocusVisible, setSystemBarsDark, watchInsets, watchKeyboard } from './lib/insets'
import { watchSharedFiles } from './lib/shareIntent'
import { App as CapApp } from '@capacitor/app'

/**
 * Three tabs, not five. Stats, Accounts, Total, Loans, Stock and Last Done
 * are all occasional screens; they moved into More so the things used
 * constantly — the day's entries and the vault — are never more than one tap
 * away.
 */
type Tab = 'Trans.' | 'Authentication' | 'More'
const TABS: Tab[] = ['Trans.', 'Authentication', 'More']

/** Screens reached from the More menu, shown full-screen over the shell. */
export type ExtraPage =
  | 'stats'
  | 'accounts'
  | 'total'
  | 'loans'
  | 'balance'
  | 'stock'
  | 'lastDone'
  | 'kitee'
const EXTRA_TITLE: Record<ExtraPage, string> = {
  stats: 'Stats',
  accounts: 'Accounts',
  total: 'Total',
  loans: 'Loans',
  balance: 'Balance',
  stock: 'Taruna',
  lastDone: 'Muskan',
  kitee: 'Khushi',
}

/** A lotus, a shark and a cat — pixel sprites, one per tab. */
const TAB_ART: Record<Tab, PixelArt> = {
  'Trans.': LOTUS,
  Authentication: SHARK,
  More: CAT,
}

const TAB_LABEL: Record<Tab, string> = {
  'Trans.': 'Somya',
  Authentication: 'Shafali',
  More: 'More',
}

/**
 * __APP_VERSION__ is read out of android/app/build.gradle at build time (see
 * vite.config.ts), not typed here. The leading pair used to be hand-written
 * and drifted from the real Gradle versionName for at least three releases —
 * once stuck on "1.0" while the installed APK was really 1.2, later showing
 * "1.7" while no build with that number had actually been made yet. Reading
 * it from the one place version numbers are decided makes that drift
 * structurally impossible now.
 */
const APP_VERSION = `${__APP_VERSION__}.${__BUILD__}`

/** "2026-08-24" → "24 Aug". Short enough for two of them plus a dash to sit
 *  in a header button without pushing the title off the row. */
function shortDayLabel(key: string): string {
  const [, m, d] = key.split('-')
  return `${Number(d)} ${MONTHS_SHORT[Number(m) - 1]}`
}

/** Square-ish icon button used across the app bars. */
function IconButton({
  label,
  d,
  onClick,
}: {
  label: string
  d: string
  onClick: () => void
}) {
  return (
    <button
      className="relative w-9 h-9 rounded-[var(--r-sm)] flex items-center justify-center press"
      onClick={onClick}
      aria-label={label}
      style={{ color: 'var(--text)' }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  )
}

/**
 * Host for the five screens that moved into More. Each is shown full-screen
 * over the shell with its own bar, so they keep their month stepper and
 * period picker rather than being squeezed into the main header.
 */
function ExtraScreen({
  page,
  title,
  month,
  setMonth,
  statsPeriod,
  statsRange,
  onPickPeriod,
  onClose,
  onEdit,
  onAdd,
  onBudgetSetting,
  onExport,
  onJumpDaily,
  choreEditor,
  onCloseChore,
  onAddChore,
}: {
  page: ExtraPage
  title: string
  month: string
  setMonth: (m: string) => void
  statsPeriod: StatsPeriod
  statsRange: StatsRange
  onPickPeriod: () => void
  onClose: () => void
  onEdit: (tx: Transaction) => void
  onAdd: (date?: string) => void
  onBudgetSetting: () => void
  onExport: () => void
  onJumpDaily: () => void
  choreEditor: Chore | 'new' | null
  onCloseChore: () => void
  onAddChore: () => void
}) {
  // Stats and Total are month-scoped; Loans and Stock are not. Stats drops
  // its month button for the two periods the month has no say in — 'All'
  // spans the whole ledger and 'Custom' carries its own two dates — since a
  // stepper that visibly does nothing reads as broken rather than inert.
  const monthScoped =
    page === 'total' ||
    (page === 'stats' && statsPeriod !== 'All' && statsPeriod !== 'Custom')
  const monthLabelText = `${MONTHS_SHORT[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`
  const isKitee = page === 'kitee'
  // Local rather than lifted to the shell: this only ever matters while
  // Khushi itself is mounted, and ExtraScreen already unmounts entirely on
  // its own Back — same reasoning as Loans' own editor state.
  const [suppliersOpen, setSuppliersOpen] = useState(false)

  // Kitee is the one ExtraScreen page that still owns a look — the galaxy
  // photo and the pale-on-violet header it had as a Trans sub-tab, both
  // moved here rather than dropped when the tab did. Every other page here
  // shares one plain bar; special-casing just this one is the same pattern
  // Shell's own header already uses for Daily/Habits, not a new one.

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col animate-slide"
      style={{ background: 'var(--bg)' }}
    >
      <header
        className="shrink-0 border-b relative overflow-hidden"
        style={
          {
            borderColor: 'var(--line)',
            paddingTop: 'var(--sat)',
            background: isKitee
              ? 'color-mix(in srgb, #0c0620 55%, transparent)'
              : 'var(--surface)',
            ...(isKitee ? { '--tab-tint': '#d9c8ff' } : null),
          } as React.CSSProperties
        }
      >
        {isKitee && <HeaderGalaxyBg />}
        <div className="relative flex items-center px-2 bar-row gap-1">
          <IconButton label="Back" d="M15 5l-7 7 7 7" onClick={onClose} />
          <span className="t-title flex-1 truncate">{title}</span>
          {isKitee && (
            <IconButton
              label="Suppliers"
              d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"
              onClick={() => setSuppliersOpen(true)}
            />
          )}
          {monthScoped && (
            <button
              className="px-3 py-1.5 rounded-[var(--r-sm)] text-[14px] font-semibold press"
              style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)' }}
              onClick={() => setMonth(month)}
            >
              {monthLabelText}
            </button>
          )}
          {page === 'stats' && (
            <button
              className="ml-1 px-3 py-1.5 rounded-[var(--r-sm)] text-[13px] font-semibold press"
              style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)' }}
              onClick={onPickPeriod}
            >
              {/* The button says what it is actually showing, not just what
                  mode it is in — "Custom" alone left the two dates you had
                  chosen invisible from the screen they were filtering. */}
              {statsPeriod === 'Custom'
                ? `${shortDayLabel(statsRange.from)} – ${shortDayLabel(statsRange.to)}`
                : statsPeriod}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        {page === 'stats' && (
          <Stats month={month} period={statsPeriod} range={statsRange} onEdit={onEdit} />
        )}
        {page === 'accounts' && <Accounts month={month} onEdit={onEdit} />}
        {page === 'loans' && <Loans />}
        {page === 'balance' && <BalancePanel />}
        {page === 'stock' && <StockPanel />}
        {page === 'lastDone' && <LastDone editing={choreEditor} onCloseEditor={onCloseChore} />}
        {page === 'kitee' && <PurchasePanel />}
        {page === 'total' && (
          <Total
            month={month}
            setMonth={setMonth}
            onEdit={onEdit}
            onAdd={onAdd}
            onBudgetSetting={onBudgetSetting}
            onExport={onExport}
            onJumpDaily={onJumpDaily}
          />
        )}
      </main>

      {/* Last Done's chore editor is lifted to the shell, same as the habit
          and memo editors, so its add button lives up here too rather than
          inside LastDone itself. */}
      {page === 'lastDone' && <Fab onClick={onAddChore} />}

      {isKitee && <SuppliersSheet open={suppliersOpen} onClose={() => setSuppliersOpen(false)} />}
    </div>
  )
}

/**
 * The More menu, as a popover anchored to the bar rather than a whole tab.
 *
 * Modelled on the reference: a floating rounded card sitting above the bottom
 * bar with a small tail pointing down at the button that opened it, and rows
 * of icon + label. These are all occasional destinations, so they get a menu
 * you dismiss rather than a screen you have to navigate back out of.
 */
const MENU_ROWS: [string, ExtraPage | 'settings' | 'partner', LucideIcon][] = [
  ['Total', 'total', Wallet],
  ['Stats', 'stats', BarChart3],
  ['Accounts', 'accounts', Landmark],
  ['Loans', 'loans', HandCoins],
  ['Balance', 'balance', Users],
  ['Taruna', 'stock', Package],
  ['Muskan', 'lastDone', History],
  ['Khushi', 'kitee', Star],
  // A destination, not a setting. It was in the Settings grid first, which
  // buried something reached far more often than Style or PC Manager behind
  // an extra tap. Last two in the list — bottom of the hold-and-drag menu,
  // where the thumb already is.
  ['Partner Journal', 'partner', Heart],
  ['Settings', 'settings', SettingsIcon],
]


/** Fixed so the scatter doesn't reshuffle itself on every render. Spread
 *  across the whole header now that the sky covers the sub-tab row too,
 *  not just the narrow title strip it used to be sized to. */
const HEADER_STARS: [x: number, y: number, delay: number][] = [
  [8, 20, 0], [18, 55, 0.9], [26, 32, 1.6], [34, 70, 0.4],
  [42, 15, 1.2], [50, 45, 0.2], [58, 78, 1.9], [64, 25, 0.7],
  [72, 60, 1.4], [80, 38, 0.5], [88, 68, 1.1], [94, 20, 1.8],
]

/** Same shape as the ring's own dawn clouds, at header scale. */
const HEADER_CLOUDS: [x: number, y: number, scale: number, opacity: number][] = [
  [12, 78, 0.9, 0.28], [38, 25, 0.7, 0.22], [70, 82, 1, 0.3],
]

function HeaderCloud({ x, y, scale, opacity }: { x: number; y: number; scale: number; opacity: number }) {
  return (
    <svg
      className="sleep-tabhead-cloud"
      style={{ left: `${x}%`, top: `${y}%`, transform: `translate(-50%, -50%) scale(${scale})`, opacity }}
      width="34" height="16" viewBox="-10 -6 20 12" aria-hidden
    >
      <g className="sleep-cloud">
        <circle cx="-4" cy="1.2" r="3.4" />
        <circle cx="0" cy="-1.3" r="4.2" />
        <circle cx="4.4" cy="1.2" r="3.1" />
        <ellipse cx="0" cy="3.1" rx="8.2" ry="2.6" />
      </g>
    </svg>
  )
}

/**
 * Sleep's own sliver of night behind its header — a moon low over the tab
 * strip, a scatter of stars, and a few low clouds. Purely decorative, so it
 * sits behind the title and never intercepts a tap.
 */
function SleepHeaderSky() {
  return (
    <div className="sleep-tabhead-sky" aria-hidden>
      <span className="sleep-tabhead-glow" />
      {HEADER_STARS.map(([x, y, delay], i) => (
        <span
          key={i}
          className="sleep-tabhead-star"
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }}
        />
      ))}
      {HEADER_CLOUDS.map(([x, y, scale, opacity], i) => (
        <HeaderCloud key={i} x={x} y={y} scale={scale} opacity={opacity} />
      ))}
      <span className="sleep-tabhead-moon" />
    </div>
  )
}

/**
 * The phoenix behind Daily's header. A readability scrim is layered over it
 * in CSS (.header-phoenix-bg::after) — without one, white text on a bright,
 * busy crop is barely legible; that job used to be done by a blur.
 *
 * Drawn rather than photographed since the source was a pixel chart whose
 * grid lines were baked into its pixels and showed at header size. See
 * lib/phoenixArt.ts for how the trace was done. `meet`, not `slice`: with
 * the chart's black sheet gone the bird is a transparent emblem, so there is
 * no longer any reason to crop its wingtips off to fill a rectangle.
 */
function HeaderPhoenixBg() {
  return (
    <div className="header-phoenix-bg" aria-hidden>
      <svg
        className="header-phoenix-art"
        viewBox={PHOENIX_VIEWBOX}
        preserveAspectRatio="xMidYMid meet"
      >
        {PHOENIX_PATHS.map(([fill, d]) => (
          <path key={fill} fill={fill} d={d} />
        ))}
      </svg>
    </div>
  )
}

/**
 * Habits' header: the top of the same night the screen below it draws.
 *
 * This was the cross-stitch castle photo, which put a castle here and
 * another one at the foot of the screen with a gap between them — two
 * castles, and a visible seam where the photo stopped. It also carried the
 * pattern's grid lines and its watermark, both of which showed.
 *
 * So the header holds only the sky now: the same gradient, the same stars,
 * running down into the screen's own without a join. The castle belongs to
 * the horizon, and there is exactly one of it. Same reasoning as the sliver
 * of night above the Sleep tab.
 */
function HeaderCastleBg() {
  return (
    <div className="header-castle-sky" aria-hidden>
      {CASTLE_HEADER_STARS.map(([x, y, r], i) => (
        <span
          key={i}
          className="header-castle-star"
          style={{ left: `${x}%`, top: `${y}%`, width: r, height: r, animationDelay: `${(i * 0.6) % 4}s` }}
        />
      ))}
    </div>
  )
}

/** [x%, y%, px] — fixed, so the header's sky does not reshuffle every time
 *  the tab re-renders. */
const CASTLE_HEADER_STARS: [number, number, number][] = [
  [8, 22, 2], [17, 58, 1.5], [26, 30, 2.5], [35, 72, 1.5], [44, 18, 2],
  [52, 52, 1.5], [61, 26, 2.5], [69, 64, 1.5], [77, 34, 2], [85, 70, 1.5],
  [92, 20, 2.5], [12, 80, 1.5], [40, 88, 2], [66, 84, 1.5], [88, 50, 2],
]

/** Same idea again, for Kitee's (Purchase's) header — a purple cosmic swirl
 *  rather than a place, since this tab isn't set anywhere in particular. */
function HeaderGalaxyBg() {
  return (
    <div className="header-phoenix-bg header-galaxy-bg" aria-hidden>
      <img src="/img/kitee-galaxy.jpg" alt="" />
    </div>
  )
}

/** Same idea again, for Niba's header — a pastel cherry-blossom valley. */
function HeaderBlossomBg() {
  return (
    <div className="header-phoenix-bg header-blossom-bg" aria-hidden>
      <img src="/img/niba-blossom.jpg" alt="" />
    </div>
  )
}

/**
 * The unlocked vault's collage — behind the *whole* shell rather than only
 * the content area, header and bottom bar included, so the screen reads as
 * one picture with the UI floating on it.
 *
 * That is why this lives here and not inside Authentication.tsx, where the
 * other three tabs' photos would naturally go: the header and the nav are
 * siblings of the screen, not children, so nothing rendered inside the
 * screen can ever reach behind them. Shown sharp — no blur anywhere on it.
 */
function VaultDreamBg() {
  return (
    <div className="vault-bg" aria-hidden>
      <img src="/img/vault-dream.jpg" alt="" />
    </div>
  )
}

function Shell() {
  const { db, ready } = useStore()
  const [tab, setTab] = useState<Tab>('Trans.')
  // Whichever tab the owner put first is home. Lazy initial state so it is
  // read once from the saved order rather than on every render.
  const [sub, setSub] = useState<TransTab>(
    () => orderedTransTabs(db.settings.transTabOrder)[0],
  )

  // A file shared in from another app (see lib/shareIntent.ts) always ends
  // up in Documents, which lives behind the vault's PIN — that lock is a
  // hard boundary this deliberately does not try to skip. All this does is
  // bring the Vault screen to the front so the share isn't just silently
  // waiting behind whatever tab happened to be open; Authentication itself
  // holds onto the files and opens the pre-filled editor once it's actually
  // unlocked.
  const [pendingShareFiles, setPendingShareFiles] = useState<File[]>([])
  useEffect(
    () =>
      watchSharedFiles((files) => {
        setPendingShareFiles(files)
        setTab('Authentication')
      }),
    [],
  )
  // The wrapper every screen renders into. Keyed on tab+sub, so React swaps
  // the whole element on a change rather than reconciling one screen's tree
  // into another's. There is deliberately no entrance animation on it — the
  // slide+fade that used to live here was removed along with anime.js; a tab
  // tap now paints the new screen on the very next frame.
  const pageRef = useRef<HTMLDivElement>(null)

  const [month, setMonth] = useState(todayMonth())
  const [day, setDay] = useState(todayKey())
  const [dayPicker, setDayPicker] = useState(false)
  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>('Monthly')
  // The two ends of the 'Custom' period. Defaulted to the last 30 days
  // rather than left blank so picking "Custom" shows a real answer straight
  // away and the two date fields read as something to adjust rather than a
  // form to fill in before anything happens.
  const [statsRange, setStatsRange] = useState<StatsRange>(() => ({
    from: addDays(todayKey(), -29),
    to: todayKey(),
  }))
  const [periodMenu, setPeriodMenu] = useState(false)
  const [picker, setPicker] = useState(false)
  const [search, setSearch] = useState<null | 'plain' | 'filters'>(null)
  const [favorites, setFavorites] = useState(false)
  const [plannerOpen, setPlannerOpen] = useState(false)
  /**
   * The "get a copy off this phone" nudge.
   *
   * Raised once, a beat after the shell is ready, rather than watched — so
   * it can never interrupt something already in progress. It asks at most
   * once a week (see snoozeOffDeviceNudge): a prompt on every launch is one
   * you learn to dismiss without reading, which is worse than not asking.
   */
  const [offDeviceAsk, setOffDeviceAsk] = useState(false)
  const [offDeviceSending, setOffDeviceSending] = useState(false)
  const [moreRequest, setMoreRequest] = useState<DeepLink | null>(null)
  const [extraPage, setExtraPage] = useState<ExtraPage | null>(null)
  const [moreMenu, setMoreMenu] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Its own overlay rather than an ExtraPage: Partner renders a full Screen
  // with its own header and lock, so nesting it inside ExtraScreen's header
  // would stack two title bars.
  const [partnerOpen, setPartnerOpen] = useState(false)
  // Stable identity across renders — the gesture hook closes over this array
  // via a ref, but it still only needs to be rebuilt when a picker actually
  // changes, not on every keystroke elsewhere in the shell.
  const fanActions = useMemo(
    () =>
      MENU_ROWS.map(([label, target, icon]) => ({
        key: label,
        label,
        icon,
        onPick: () =>
          target === 'settings'
            ? setSettingsOpen(true)
            : target === 'partner'
              ? setPartnerOpen(true)
              : setExtraPage(target),
      })),
    [],
  )
  const [memoEditor, setMemoEditor] = useState<Memo | 'new' | null>(null)
  const [habitEditor, setHabitEditor] = useState<Habit | 'new' | null>(null)
  const [choreEditor, setChoreEditor] = useState<Chore | 'new' | null>(null)

  // The sub-tab row in the order the owner arranged it (Settings > Style).
  // Everything that walks the row — swipe, the pill, the row itself — reads
  // this rather than the declaration order, so they can never disagree.
  const subTabs = orderedTransTabs(db.settings.transTabOrder)

  /**
   * Bumped every time a sub-tab is chosen. It only feeds the title's `key`,
   * so React remounts that node and the CSS animation on it replays from the
   * start — a class toggle would not, because an animation that is already
   * finished does not restart just because the class is re-applied.
   */
  const [subVisit, setSubVisit] = useState(0)
  const goSub = (t: TransTab) => {
    // Tapping the tab you are already on is not a move. Without this it still
    // rewrote the direction (to 0) and replayed the transition, so the screen
    // flashed a fade for a tap that changed nothing.
    if (t === sub) return
    setSub(t)
    setSubVisit((n) => n + 1)
  }
  const [editor, setEditor] = useState<null | {
    initial: Partial<Omit<Transaction, 'id'>>
    editingId?: string
  }>(null)
  const [exitHint, setExitHint] = useState(false)
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const secretPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Swipe walks the Train sub-tabs — Daily, Niba, Habits — rather than the
  // bottom bar. The bar is three fixed destinations you tap; sideways is for
  // moving through the day-to-day screens. Pinly has its own swipe scoped to
  // its two sections, and the editor has one for the entry type.
  const blockTabSwipe = !!(
    editor ||
    search ||
    moreRequest ||
    extraPage ||
    moreMenu ||
    settingsOpen ||
    partnerOpen ||
    memoEditor ||
    habitEditor ||
    choreEditor ||
    favorites ||
    picker ||
    dayPicker ||
    periodMenu
  )
  const tabSwipe = useSwipe(
    () => {
      const i = subTabs.indexOf(sub)
      if (i < subTabs.length - 1) goSub(subTabs[i + 1])
    },
    () => {
      const i = subTabs.indexOf(sub)
      if (i > 0) goSub(subTabs[i - 1])
    },
    !blockTabSwipe && tab === 'Trans.',
  )

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', db.settings.accent)
    document.documentElement.classList.toggle('light', !db.settings.darkMode)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', db.settings.darkMode ? '#08090b' : '#f0f1f4')
    // The app draws under the system bars, so Android needs to be told which
    // way to tint their icons — otherwise they vanish against the background.
    setSystemBarsDark(db.settings.darkMode)
  }, [db.settings.accent, db.settings.darkMode])

  // Pull the real window insets from the Android shell, and keep the focused
  // field clear of the on-screen keyboard.
  useEffect(() => {
    const stopInsets = watchInsets()
    const stopKeyboard = watchKeyboard()
    const stopFocus = keepFocusVisible()
    return () => {
      stopInsets()
      stopKeyboard()
      stopFocus()
    }
  }, [])

  // Android back. Handlers registered by whatever is open take it first; only
  // when nothing is left does a second press within 2s actually quit.
  useEffect(() => {
    let armed = false
    let disarm: number | undefined

    const listener = CapApp.addListener('backButton', () => {
      if (popBackHandler()) {
        armed = false
        clearTimeout(disarm)
        return
      }
      if (armed) {
        void CapApp.exitApp()
        return
      }
      armed = true
      setExitHint(true)
      hapticLight()
      clearTimeout(disarm)
      disarm = setTimeout(() => {
        armed = false
        setExitHint(false)
      }, 2000) as unknown as number
    })

    return () => {
      clearTimeout(disarm)
      void listener.then((l) => l.remove())
    }
  }, [])

  // `startScreen` still exists in the data model and can say 'Total', but
  // Total is a More page now. Home is whatever sits first in the arranged
  // sub-tab order — which is what Settings > Style promises it is.
  const homeSub: TransTab = subTabs[0]


  // Daily automatic backup. Runs once the database is actually loaded —
  // snapshotting an empty pre-load db would overwrite the day's good file with
  // nothing. Re-run hourly so today's snapshot keeps up with the day's entries
  // and a phone left open overnight still rolls onto the new date.
  //
  // The live db is read through a ref rather than listed as a dependency: as a
  // dependency it would tear down and rebuild the timer on every keystroke,
  // and the hourly cadence would never actually elapse.
  const dbRef = useRef(db)
  dbRef.current = db
  useEffect(() => {
    if (!ready) return
    const run = () => void runDailyBackup(dbRef.current, todayKey())
    run()
    // Asked after the daily snapshot has had a moment to land, so the state
    // it reads is today's rather than yesterday's.
    const ask = setTimeout(() => {
      if (offDeviceOverdue(todayKey())) setOffDeviceAsk(true)
    }, 2500)
    const tick = setInterval(run, 3600_000)
    return () => {
      clearInterval(tick)
      clearTimeout(ask)
    }
  }, [ready])

  // Daily reminder — fires while the app is open; a true push needs a server.
  useEffect(() => {
    const time = db.settings.reminderTime
    if (!time || !('Notification' in window) || Notification.permission !== 'granted') return
    const tick = setInterval(() => {
      const now = new Date()
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const stamp = `${now.toDateString()}-${time}`
      if (hhmm === time && localStorage.getItem('lastReminder') !== stamp) {
        localStorage.setItem('lastReminder', stamp)
        new Notification('Kaithwas', { body: "Log today's entries" })
      }
    }, 30000)
    return () => clearInterval(tick)
  }, [db.settings.reminderTime])

  // EMI reminders — same "app must be open" limitation as the daily reminder above.
  // One notification per loan per calendar day, deduped in localStorage.
  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const check = () => {
      const now = new Date()
      const todayKey = now.toDateString()
      for (const loan of db.loans) {
        if (!loan.reminderEnabled || loan.archived) continue
        const days = daysUntilEmi(loan.emiDay, now)
        if (days > loan.reminderDaysBefore) continue
        const stamp = `${loan.id}-${todayKey}`
        if (localStorage.getItem(`emiReminder-${loan.id}`) === stamp) continue
        localStorage.setItem(`emiReminder-${loan.id}`, stamp)
        const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
        new Notification(`EMI ${when} — ${loan.lender}`, {
          body: `${loan.purpose}: ${formatMoney(loan.emiAmount, db.settings)}`,
        })
      }
    }
    check()
    const tick = setInterval(check, 60000)
    return () => clearInterval(tick)
  }, [db.loans, db.settings])

  const openEditor = (tx: Transaction) => setEditor({ initial: tx, editingId: tx.id })
  const openAdd = (date?: string) => setEditor({ initial: date ? { date } : {} })

  // Back unwinds these one at a time. They are registered outermost-first so
  // the innermost thing on screen is what closes; the editor registers its own
  // keypad and pickers on top of this, from inside TxEditor.
  useBackHandler(hiddenOpen, () => setHiddenOpen(false))
  useBackHandler(!!editor, () => setEditor(null))
  useBackHandler(!!search, () => setSearch(null))
  useBackHandler(!!moreRequest, () => setMoreRequest(null))
  useBackHandler(!!memoEditor, () => setMemoEditor(null))
  useBackHandler(!!habitEditor, () => setHabitEditor(null))
  useBackHandler(!!choreEditor, () => setChoreEditor(null))
  useBackHandler(favorites, () => setFavorites(false))
  useBackHandler(plannerOpen, () => setPlannerOpen(false))
  useBackHandler(periodMenu, () => setPeriodMenu(false))
  useBackHandler(dayPicker, () => setDayPicker(false))
  useBackHandler(picker, () => setPicker(false))
  useBackHandler(moreMenu, () => setMoreMenu(false))
  useBackHandler(settingsOpen, () => setSettingsOpen(false))
  useBackHandler(partnerOpen, () => setPartnerOpen(false))
  useBackHandler(!!extraPage, () => setExtraPage(null))
  // A non-default sub-tab within Transactions is also a level to come back from.
  useBackHandler(tab === 'Trans.' && sub !== homeSub, () => setSub(homeSub))
  useBackHandler(tab !== 'Trans.', () => setTab('Trans.'))

  /** Most-used entries, offered by the star button for one-tap re-entry. */
  const favs = useMemo(() => {
    const m = new Map<string, { count: number; tx: Transaction }>()
    for (const t of db.transactions) {
      if (t.type === 'transfer') continue
      const key = `${t.type}|${t.categoryId}|${t.accountId}|${t.note.toLowerCase()}`
      const cur = m.get(key)
      if (cur) cur.count += 1
      else m.set(key, { count: 1, tx: t })
    }
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 10)
  }, [db.transactions])

  // Same background the native splash hands off to (see styles.xml /
  // colors.xml), so there is no flash between the two — only the app's own
  // mark now sits on it, rather than a flat, blank rectangle that gives no
  // sign anything is happening. Static, not a loop: this codebase has no
  // idle/looping animation anywhere else on purpose (see the Motion section
  // in index.css), and a cold start already has enough real work to do
  // without spending any of it on decoration.
  if (!ready) {
    return (
      <div className="h-full grid place-items-center" style={{ background: 'var(--bg)' }}>
        <div
          className="w-14 h-14 rounded-[14px] grid place-items-center text-[28px] font-semibold"
          style={{ background: 'var(--accent)', color: '#fff' }}
          aria-hidden
        >
          ₹
        </div>
      </div>
    )
  }

  const monthLabelText = `${MONTHS_SHORT[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`
  const stepMonth = (delta: number) => setMonth(addMonths(month, delta))
  const stepDay = (delta: number) => setDay(addDays(day, delta))
  // The Daily tab is about one day; every other view is still month-scoped.
  const dailyView = tab === 'Trans.' && sub === 'Daily'

  return (
    /* The swipe lives on the whole screen rather than the content area, so a
       thumb anywhere — including over the summary strip and the sub-tab row —
       walks Daily → Niba → Habits. Pinly and the editor stop propagation, so
       their own gestures still win inside them. */
    <div
      className="h-full flex flex-col relative overflow-hidden"
      {...tabSwipe}
      // After the spread, and merging what it carries: useSwipe sets its own
      // `style` (touch-action), so declaring this before `{...tabSwipe}` let
      // the spread quietly drop the z-index — and with it the stacking
      // context VaultDreamBg depends on.
      //
      // z-index rather than bare `relative`: VaultDreamBg sits at z-index -1
      // and needs a stacking context here to be contained by, or it paints
      // behind this element's own background instead of behind the UI.
      style={{ ...tabSwipe.style, zIndex: 0 }}
    >
      {/* Only the vault gets a full-shell photo; every other tab's artwork is
          scoped to its header. */}
      {tab === 'Authentication' && <VaultDreamBg />}
      <header
        className="shrink-0 z-20 border-b relative tab-head"
        style={
          {
            borderColor: 'var(--line)',
            // paddingTop lives on .header-glass now, not here — see that
            // rule for why (the wrapper has to reach up over the status-bar
            // strip rather than starting below it).
            // Only the Trans. sub-tabs own a look; Vault and Settings keep the
            // plain bar, and --tab-tint left unset falls back to --text.
            // The vault runs a photo behind the entire shell, so its header
            // washes over that rather than hiding it — same treatment Daily,
            // Habits and Niba give their own header photos, just spanning the
            // whole screen here instead of the header alone.
            ...(tab === 'Authentication'
              ? {
                  backgroundColor: 'color-mix(in srgb, var(--surface) 55%, transparent)',
                  borderColor: 'transparent',
                }
              : null),
            ...(tab === 'Trans.'
              ? {
                  '--tab-tint': TAB_THEME[sub].tint,
                  // Sleep draws its own night sky. Daily, Habits and Niba sit
                  // on a photo, so their ground washes over it instead of
                  // hiding it. Every other tab has nothing behind the header
                  // worth bending, so it stays its own opaque ground like
                  // before the glass existed.
                  // Habits draws its own sky now, like Sleep — a 55% wash
                  // over it would only mute the stars it is there to show.
                  backgroundColor:
                    sub === 'Daily' || sub === 'Niba'
                      ? `color-mix(in srgb, ${TAB_THEME[sub].ground} 55%, transparent)`
                      : TAB_THEME[sub].ground,
                  // Sleep's hairline is its own tint at low strength rather
                  // than the neutral line every other tab uses — a stark grey
                  // edge cut the moonlight off hard right where it should
                  // keep bleeding into the screen below.
                  ...(sub === 'Sleep' ? { borderColor: 'rgba(151, 125, 255, 0.16)' } : null),
                  // Habits gets no hairline at all: the header's sky and the
                  // screen's are now one gradient, and a rule across it is
                  // exactly the seam this was meant to remove.
                  ...(sub === 'Habits' ? { borderColor: 'transparent' } : null),
                }
              : null),
          } as React.CSSProperties
        }
      >
        {/* Sleep's own sliver of night, sized to the whole header rather than
            just the title row — it used to sit inside the title row alone,
            which left the sub-tab strip underneath it a plain flat purple
            with nothing in it, a seam right through the middle of what
            should read as one continuous sky. A direct header child with
            inset:0 covers both rows at once. */}
        {tab === 'Trans.' && sub === 'Sleep' && <SleepHeaderSky />}
        {/* What the header's glass actually refracts, one per tab that asked
            for it. It read as a busy wallpaper everywhere else, fighting for
            attention with each tab's own look, so it's scoped down to just
            these two screens — Kitee's own galaxy photo moved to
            ExtraScreen's header along with the rest of it. */}
        {tab === 'Trans.' && sub === 'Daily' && <HeaderPhoenixBg />}
        {tab === 'Trans.' && sub === 'Habits' && <HeaderCastleBg />}
        {tab === 'Trans.' && sub === 'Niba' && <HeaderBlossomBg />}

        {/* One wrapper spanning the title row and the sub-tab strip, so the
            two read as a single bar rather than two stacked strips. It used
            to also carry a glass pane refracting the photo above it; that is
            gone with the rest of the backdrop-filters — the bar is a solid
            tone now (see .header-glass). */}
        <div className="header-glass">
          {/* Every one of these rows is exactly --bar-h tall. They used to
              carry their own padding, so Habits (a plain title) came out
              shorter than the stepper row and the whole page stepped down as
              you moved between sub-tabs. Height is fixed here so nothing
              shifts. */}
          {tab === 'Trans.' && TITLE_TABS.includes(sub) && (
            <div className="relative flex items-center px-4 bar-row">
              {/* Habits announces itself with an RGB-split tear as you arrive.
                  The two coloured copies come from `content: attr(data-text)`,
                  so the word is written once — change the tab name and both
                  layers follow. Keyed on the visit counter so the burst replays
                  on every arrival, including tapping the tab you are on. */}
              <span
                key={`${sub}-${subVisit}`}
                className={`t-title flex-1${sub === 'Habits' ? ' glitch' : ''}`}
                data-text={sub}
              >
                {sub}
              </span>
            </div>
          )}

          {tab === 'Trans.' && !TITLE_TABS.includes(sub) && (
            <div className="flex items-center px-2 bar-row">
              {dailyView ? (
                <PeriodStepper
                  key={day}
                  label={dayLabel(day)}
                  onPrev={() => stepDay(-1)}
                  onNext={() => stepDay(1)}
                  onPick={() => setDayPicker(true)}
                />
              ) : (
                <PeriodStepper
                  key={month}
                  label={monthLabelText}
                  onPrev={() => stepMonth(-1)}
                  onNext={() => stepMonth(1)}
                  onPick={() => setPicker(true)}
                />
              )}
              <span className="flex-1" />
              {sub === 'Niba' && (
                <IconButton
                  label="Today's Plan"
                  d="M13 2L3 14h7l-1 8 11-14h-8z"
                  onClick={() => setPlannerOpen(true)}
                />
              )}
              <IconButton
                label="Favorites"
                d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6L12 16.8 6.6 19.6l1.2-6L3.3 9.4l6.1-.8z"
                onClick={() => setFavorites(true)}
              />
              <IconButton
                label="Search"
                d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3"
                onClick={() => setSearch('plain')}
              />
              <IconButton
                label="Filter"
                d="M4 7h10M18 7h2M4 17h2M10 17h10M15 4v6M8 14v6"
                onClick={() => setSearch('filters')}
              />
            </div>
          )}

          {tab === 'Authentication' && (
            <div className="flex items-center px-4 bar-row">
              <span className="t-title flex-1">Shafali</span>
            </div>
          )}

          {tab === 'More' && (
            <div className="flex items-center px-4 bar-row">
              <span className="t-title flex-1">Settings</span>
              <span className="text-[12px] num" style={{ color: 'var(--muted)' }}>
                v{APP_VERSION}
              </span>
            </div>
          )}

          {tab === 'Trans.' && <SubTabs tabs={subTabs} value={sub} onChange={goSub} />}
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Keyed on the sub-tab too, so moving Daily → Habits → Sleep replays
            the entrance rather than only the top-level tab change. Costs
            nothing extra: Trans renders one screen per sub, so switching
            already unmounts the previous one. */}
        <div
          key={`${tab}-${sub}`}
          ref={pageRef}
          className="flex-1 flex flex-col overflow-hidden"
        >
          {tab === 'Trans.' && (
            <Trans
              sub={sub}
              day={day}
              onEdit={openEditor}
              editingMemo={memoEditor}
              onCloseMemo={() => setMemoEditor(null)}
              editingHabit={habitEditor}
              onCloseHabit={() => setHabitEditor(null)}
            />
          )}
          {tab === 'Authentication' && (
            <Authentication
              pendingShareFiles={pendingShareFiles}
              onConsumedShareFiles={() => setPendingShareFiles([])}
            />
          )}
        </div>
      </main>

      {/* screens reachable from several tabs (Budget Setting, Export, Categories) */}
      <MoreScreens month={month} request={moreRequest} onClose={() => setMoreRequest(null)} />

      {tab === 'Trans.' &&
        (sub === 'Niba' ? (
          <Fab onClick={() => setMemoEditor('new')} icon={<span className="text-[24px]">🗒</span>} />
        ) : sub === 'Habits' ? (
          <Fab onClick={() => setHabitEditor('new')} />
        ) : sub === 'Sleep' ? (
          // Nothing to add: the screen edits the night in front of you, and
          // falling through to the default would open the transaction editor.
          null
        ) : (
          // adding while looking at an older day should file it on that day,
          // not today; today keeps the live clock time
          <Fab onClick={() => openAdd(day === todayKey() ? undefined : `${day}T12:00`)} />
        ))}

      {/* In the layout rather than floating over it, and padded by the real
          bottom inset so it clears the gesture bar in both nav modes. Opaque
          everywhere except the vault, where it turns to glass over that
          screen's full-shell photo. */}
      <nav
        // Above the Fab (z-30, ui.tsx), not below it. The Fab is meant to
        // float just clear of this bar, but a device where the bar renders
        // even a little taller than --nav-h assumes — a bigger system font
        // scale wrapping a tab label, for one — let the Fab's circle reach
        // down over Shafali/More and silently eat their taps, since a
        // higher z-index painted it on top regardless of which one actually
        // ended up lower on screen. The nav is a permanent, load-bearing
        // control; it should never lose a tap to a screen-specific button
        // floating nearby, so it wins the stacking order outright rather
        // than relying on the geometry always landing exactly right.
        className={`shrink-0 relative grid border-t z-40${tab === 'Authentication' ? ' vault-navbar' : ''}`}
        style={{
          // Derived from the tab list rather than hard-coded: this was still
          // grid-cols-5 after the bar dropped to three, so the icons sat in
          // the first three columns with dead space to the right.
          gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
          // Left to CSS on the vault (see .vault-navbar) — an inline
          // background would win over the class and override the tone that
          // rule sets for the photo-backed screen.
          ...(tab === 'Authentication'
            ? null
            : { background: 'var(--surface)', borderColor: 'var(--line)' }),
          height: 'calc(var(--nav-h) + var(--sab))',
          paddingBottom: 'var(--sab)',
          paddingLeft: 'var(--sal)',
          paddingRight: 'var(--sar)',
        }}
      >
        {/* One solid indicator sliding to the active tab — the only motion here. */}
        <span
          className="absolute top-0 h-[2px]"
          style={{
            width: `${100 / TABS.length}%`,
            left: `${(TABS.indexOf(tab) * 100) / TABS.length}%`,
            opacity: moreMenu ? 0 : 1,
            background: 'var(--accent)',
            transition: 'left var(--dur-slow) var(--ease-out)',
          }}
          aria-hidden
        />
        {TABS.map((t) => {
          const active = t === 'More' ? moreMenu : t === tab && !moreMenu
          return (
            <button
              key={t}
              // fx-host clips the ripple to the cell and gives it something to
              // be positioned against
              className="fx-host flex flex-col items-center justify-center gap-0.5"
              style={{ color: active ? 'var(--accent)' : 'var(--muted)' }}
              // The ripple starts where the thumb actually landed, so it reads
              // as the tap spreading rather than the button blinking. On
              // pointerdown, not click — waiting for click puts it a whole
              // gesture behind the finger.
              onPointerDown={(e) => ripple(e.currentTarget, e.clientX, e.clientY)}
              onClick={() => {
                if (t === 'More') {
                  hapticLight()
                  setMoreMenu((o) => !o)
                  return
                }
                hapticLight()
                // An extra page (Kitee, Stats, Loans, ...) renders as a full
                // overlay *above* the tabs. Switching tabs underneath it used
                // to leave it mounted and painting on top, so the tap looked
                // like it did nothing while both screens stayed live. Closing
                // it here is what makes a bottom-bar tap actually go there.
                setExtraPage(null)
                setTab(t)
                // Train is home. Tapping it always lands on the start screen,
                // whether you were already on it (sitting in Niba or
                // Habits) or coming back from another tab — the same way a
                // home button works everywhere else. Home means today as well
                // as the Daily tab; browsing back to an older day and hitting
                // Train should return you to the present.
                if (t === 'Trans.') {
                  setSub(homeSub)
                  setDay(todayKey())
                }
              }}
            >
              {/* One size for every tab. The active icon used to be drawn at
                  28 against 30 for the others, so the tab you were on had the
                  smallest sprite in the bar — the opposite of what selection
                  should signal. Colour and the label below carry the state.

                  Train carries the line-art lotus — the same drawing as the
                  launcher icon — while the other two are still pixel sprites.
                  It takes its colour from the tab rather than being dimmed
                  like a sprite, because a stroked mark greyed out just looks
                  like a mistake. */}
              {t === 'Trans.' ? (
                <span
                  style={{
                    color: active ? 'var(--accent)' : 'var(--muted)',
                    opacity: active ? 1 : 0.7,
                    transition: 'color var(--dur) var(--ease-out), opacity var(--dur) var(--ease-out)',
                    display: 'flex',
                  }}
                >
                  <LotusMark size={28} />
                </span>
              ) : (
                // The More sprite turns over as its fan opens, so the tab you
                // pressed is visibly the thing that is now open — the same
                // "+ becomes ×" idea, on the icon that actually owns the menu.
                <span
                  className={t === 'More' ? 'fan-trigger' : undefined}
                  data-open={t === 'More' && moreMenu ? true : undefined}
                  style={{ display: 'flex' }}
                >
                  <PixelIcon art={TAB_ART[t]} size={28} dim={!active} />
                </span>
              )}
              {/* The name only appears on the tab you are on — the sprite is
                  the identity, and three permanent captions were noise. */}
              {active && (
                <span
                  className="text-[10px] font-semibold animate-fade"
                  style={{ color: 'var(--accent)' }}
                >
                  {TAB_LABEL[t]}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {exitHint && (
        <div
          className="fixed inset-x-0 z-[80] flex justify-center pointer-events-none"
          style={{ bottom: 'calc(var(--sab) + var(--nav-h) + 16px)' }}
        >
          <div
            className="px-4 py-2 rounded-full text-[13px]"
            style={{ background: 'var(--text)', color: 'var(--bg)' }}
          >
            Press back again to exit
          </div>
        </div>
      )}

      <MonthPicker open={picker} month={month} onClose={() => setPicker(false)} onSelect={setMonth} />

      <Sheet open={dayPicker} onClose={() => setDayPicker(false)} title="Go to day">
        <WeekPicker value={day} onPick={setDay} onClose={() => setDayPicker(false)} />
      </Sheet>

      <Sheet open={periodMenu} onClose={() => setPeriodMenu(false)} title="Period">
        {STATS_PERIODS.map((p) => (
          <button
            key={p}
            className="w-full py-4 border-b text-[15px]"
            style={{
              borderColor: 'var(--line)',
              color: p === statsPeriod ? 'var(--accent)' : 'var(--text)',
            }}
            onClick={() => {
              setStatsPeriod(p)
              // Custom is the one period that needs saying *which* custom —
              // it stays open on the two dates below rather than closing on
              // whatever range happened to be left there last time.
              if (p !== 'Custom') setPeriodMenu(false)
            }}
          >
            {p === 'Custom' ? 'Custom range…' : p}
          </button>
        ))}

        {statsPeriod === 'Custom' && (
          <div className="p-4 space-y-4">
            {/* The spans actually asked for, as one tap each. Typing two
                dates for "the last 90 days" is the sort of arithmetic this
                screen exists to remove. */}
            <div className="flex flex-wrap gap-2">
              {([
                ['Last 7 days', 6],
                ['Last 30 days', 29],
                ['Last 90 days', 89],
                ['Last year', 364],
              ] as const).map(([label, back]) => {
                const preset = { from: addDays(todayKey(), -back), to: todayKey() }
                const on = statsRange.from === preset.from && statsRange.to === preset.to
                return (
                  <button
                    key={label}
                    className="px-3 py-1.5 rounded-full text-[12px]"
                    style={{
                      background: on ? 'var(--accent)' : 'var(--bg)',
                      color: on ? '#fff' : 'var(--text)',
                    }}
                    onClick={() => setStatsRange(preset)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
                  From
                </div>
                <input
                  type="date"
                  className="w-full border-b pb-2 text-[14px] num"
                  style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
                  value={statsRange.from}
                  onChange={(e) =>
                    e.target.value && setStatsRange((r) => ({ ...r, from: e.target.value }))
                  }
                />
              </div>
              <div className="flex-1">
                <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
                  To
                </div>
                <input
                  type="date"
                  className="w-full border-b pb-2 text-[14px] num"
                  style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
                  value={statsRange.to}
                  onChange={(e) =>
                    e.target.value && setStatsRange((r) => ({ ...r, to: e.target.value }))
                  }
                />
              </div>
            </div>

            <button
              className="w-full py-3 rounded-lg text-white text-[15px] font-semibold"
              style={{ background: 'var(--accent)' }}
              onClick={() => setPeriodMenu(false)}
            >
              Show these dates
            </button>
          </div>
        )}
      </Sheet>

      <Sheet
        open={offDeviceAsk}
        onClose={() => {
          snoozeOffDeviceNudge(todayKey())
          setOffDeviceAsk(false)
        }}
        title="Keep a copy somewhere else"
      >
        <div className="p-4 space-y-4">
          <p className="text-[14.5px] leading-relaxed" style={{ color: 'var(--text)' }}>
            Your books are backed up every day — but only onto this phone. If it
            is lost, stolen or broken, those backups go with it.
          </p>
          <p className="text-[14.5px] leading-relaxed" style={{ color: 'var(--text)' }}>
            Send yourself a copy on WhatsApp, or put one in Drive. It takes a
            few seconds and it is the difference between an inconvenience and
            starting over.
          </p>
          <button
            className="w-full py-3 rounded-lg text-white text-[15px] font-semibold"
            style={{ background: 'var(--accent)' }}
            disabled={offDeviceSending}
            onClick={async () => {
              setOffDeviceSending(true)
              const r = await sendBackupOffDevice(db, todayKey())
              setOffDeviceSending(false)
              // Only closes when it actually went. A cancelled share sheet
              // leaves the prompt up, because nothing has been solved.
              if (r.ok) setOffDeviceAsk(false)
            }}
          >
            {offDeviceSending ? 'Preparing…' : 'Send a copy now'}
          </button>
          <button
            className="w-full py-2 text-[13px]"
            style={{ color: 'var(--muted)' }}
            onClick={() => {
              snoozeOffDeviceNudge(todayKey())
              setOffDeviceAsk(false)
            }}
          >
            Remind me next week
          </button>
        </div>
      </Sheet>

      <PlannerSheet open={plannerOpen} onClose={() => setPlannerOpen(false)} />

      <Sheet open={favorites} onClose={() => setFavorites(false)} title="Frequent entries">
        {favs.length === 0 && (
          <div className="py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            Entries you make often will show up here
          </div>
        )}
        {favs.map(({ tx, count }) => (
          <button
            key={tx.id}
            className="w-full flex items-center gap-3 px-4 py-3 border-b text-left"
            style={{ borderColor: 'var(--line)' }}
            onClick={() => {
              const { id: _id, date: _date, ...rest } = tx
              void _id
              void _date
              setFavorites(false)
              setEditor({ initial: rest })
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[15px] truncate">{tx.note || categoryName(db, tx.categoryId)}</div>
              <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
                {categoryName(db, tx.categoryId)} · used {count}×
              </div>
            </div>
          </button>
        ))}
      </Sheet>

      {search && (
        <Search
          openFilters={search === 'filters'}
          onBack={() => setSearch(null)}
          onEdit={openEditor}
          onOpenPage={(page) => {
            setSearch(null)
            setExtraPage(page)
          }}
          onOpenNotes={() => {
            setSearch(null)
            setTab('Trans.')
            setSub('Niba')
          }}
        />
      )}

      {/* The More tab's destinations. Tap the tab to open it, tap a row to
          go there. */}
      <FanFab open={moreMenu} actions={fanActions} onClose={() => setMoreMenu(false)} />

      {partnerOpen && <Partner onBack={() => setPartnerOpen(false)} />}

      {settingsOpen && (
        <div
          className="fixed inset-0 z-40 flex flex-col animate-slide"
          style={{ background: 'var(--bg)' }}
        >
          <header
            className="shrink-0 border-b"
            style={{ borderColor: 'var(--line)', paddingTop: 'var(--sat)', background: 'var(--surface)' }}
          >
            <div className="flex items-center px-2 bar-row gap-1">
              <IconButton label="Back" d="M15 5l-7 7 7 7" onClick={() => setSettingsOpen(false)} />
              <span className="t-title flex-1">Settings</span>
              {/* The way into Hidden. Long-press, not a menu row: deleted
                  things are meant to be out of the way, and a Recycle Bin in
                  the settings list is one more line to read past every day
                  for a screen wanted about twice a year. */}
              <button
                className="text-[12px] num pr-2"
                style={{ color: 'var(--muted)' }}
                onPointerDown={() => {
                  clearTimeout(secretPress.current)
                  secretPress.current = setTimeout(() => {
                    // The one cue that the secret hold actually worked —
                    // nothing else on screen has changed yet at this point.
                    hapticMedium()
                    setHiddenOpen(true)
                  }, 900)
                }}
                onPointerUp={() => clearTimeout(secretPress.current)}
                onPointerCancel={() => clearTimeout(secretPress.current)}
                onPointerLeave={() => clearTimeout(secretPress.current)}
              >
                v{APP_VERSION}
              </button>
            </div>
          </header>
          <main className="flex-1 flex flex-col overflow-hidden">
            <More
              month={month}
              onOpenPage={(p) => {
                setSettingsOpen(false)
                if (p === 'partner') {
                  setPartnerOpen(true)
                } else {
                  setExtraPage(p)
                }
              }}
            />
          </main>
          {hiddenOpen && <Hidden onBack={() => setHiddenOpen(false)} />}
        </div>
      )}

      {extraPage && (
        <ExtraScreen
          page={extraPage}
          title={EXTRA_TITLE[extraPage]}
          month={month}
          setMonth={setMonth}
          statsPeriod={statsPeriod}
          statsRange={statsRange}
          onPickPeriod={() => setPeriodMenu(true)}
          onClose={() => setExtraPage(null)}
          onEdit={openEditor}
          onAdd={openAdd}
          onBudgetSetting={() => setMoreRequest('budget')}
          onExport={() => setMoreRequest('export')}
          onJumpDaily={() => {
            setExtraPage(null)
            setTab('Trans.')
            setSub('Daily')
          }}
          choreEditor={choreEditor}
          onCloseChore={() => setChoreEditor(null)}
          onAddChore={() => setChoreEditor('new')}
        />
      )}

      {editor && (
        <TxEditor
          initial={editor.initial}
          editingId={editor.editingId}
          onClose={() => setEditor(null)}
          onSaved={(date) => {
            // a saved entry should land you where you can see it
            setTab('Trans.')
            setSub('Daily')
            setDay(date.slice(0, 10))
          }}
          onManageCategories={() => {
            setEditor(null)
            setTab('More')
            setMoreRequest('categories')
          }}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </StoreProvider>
  )
}
