export type TxType = 'income' | 'expense' | 'transfer'

/**
 * What the three transaction types are called on screen.
 *
 * The stored values stay 'income' | 'expense' | 'transfer'. They are written
 * into every transaction in the live database and into every backup and CSV
 * export, so renaming the values themselves would orphan existing entries and
 * break importing an older backup. Only the wording changes.
 *
 * Everything user-facing reads from here, so renaming again is a one-line
 * change rather than a hunt through a dozen screens.
 */
export const TYPE_LABEL: Record<TxType, string> = {
  income: 'Good',
  expense: 'Out',
  transfer: 'Pite',
}

/**
 * What the two money fields are called on screen. Same rule as TYPE_LABEL:
 * the `amount` and `profit` properties on Transaction keep their names, since
 * they are what every saved entry and backup file is written with. Only the
 * wording changes.
 *
 * `loss` is the negative form of `profit` and is left as "Loss" — the whole
 * point of that label is that it reads differently when a margin goes below
 * zero.
 */
export const FIELD_LABEL = {
  amount: 'Love',
  profit: 'Wow',
  loss: 'Loss',
  description: 'Disconect',
} as const

/**
 * How the deal felt, on a five-point satisfaction scale (worst → best).
 *
 * This started as a three-way red/blue/green rating. Those values are
 * migrated forward when the database loads, and `dealLevel` still understands
 * them, so an entry saved before the change never renders a blank swatch.
 */
export const DEAL_LEVELS = ['awful', 'bad', 'okay', 'good', 'great'] as const
export type DealRating = (typeof DEAL_LEVELS)[number]

export const DEAL_COLORS: Record<DealRating, string> = {
  awful: '#F2695C',
  bad: '#F58C4E',
  okay: '#F5C242',
  good: '#9BD256',
  great: '#3FC77F',
}

export const DEAL_LABEL: Record<DealRating, string> = {
  awful: 'Bad deal',
  bad: 'Poor',
  okay: 'Okay',
  good: 'Good',
  great: 'Great deal',
}

/**
 * The vocabulary for a day's mood — deliberately not the deal rating's
 * five-point good-to-bad scale reused wholesale. A day can be productive
 * without being great, or calm without being merely "okay" in the vague
 * sense that word usually carries; a single axis from bad to good flattens
 * distinctions a mood actually has. This is words, not a ranking, so there is
 * no "index" to average two of them into a third.
 */
export const MOOD_TAGS = [
  'great',
  'successful',
  'productive',
  'calm',
  'okay',
  'tired',
  'anxious',
  'depressed',
  'stressed',
] as const
export type MoodTag = (typeof MOOD_TAGS)[number]

export const MOOD_COLORS: Record<MoodTag, string> = {
  stressed: '#F4695D',
  anxious: '#E36FB4',
  depressed: '#7E7BE8',
  tired: '#9AA0A6',
  okay: '#F5C242',
  calm: '#35C5C0',
  productive: '#4C8CF5',
  successful: '#7ED957',
  great: '#3FC77F',
}

export const MOOD_WORD: Record<MoodTag, string> = {
  stressed: 'High Blood Pressure',
  anxious: 'Anxious',
  depressed: 'Depressed',
  tired: 'Tired',
  okay: 'Okay',
  calm: 'Calm',
  productive: 'Productive',
  successful: 'Successful',
  great: 'Great',
}

/**
 * A mood the day picker can be set to — a label and a colour, nothing more.
 * `MOOD_TAGS`/`MOOD_COLORS`/`MOOD_WORD` above are the fixed vocabulary this
 * app shipped with; `db.moods` starts out as exactly those nine (see
 * `DEFAULT_MOODS`) but from here on is the owner's own list; renaming one or
 * adding another edits that list, not this fixed one. `id` is what a
 * `MoodLog.level` actually points at, so renaming a mood's label never
 * touches a single day already logged under it — only deleting the mood
 * itself orphans those.
 */
export interface MoodDef {
  id: string
  label: string
  color: string
}

export const DEFAULT_MOODS: MoodDef[] = MOOD_TAGS.map((id) => ({
  id,
  label: MOOD_WORD[id],
  color: MOOD_COLORS[id],
}))

/** A restrained set of hues to offer when adding a mood — the same family
 *  the built-in nine already draw from, so a hand-picked one doesn't clash
 *  with the rest of the grid. */
export const MOOD_COLOR_CHOICES = [
  '#3FC77F',
  '#7ED957',
  '#4C8CF5',
  '#35C5C0',
  '#F5C242',
  '#9AA0A6',
  '#E36FB4',
  '#7E7BE8',
  '#F4695D',
  '#FF9F45',
  '#5AD1E6',
  '#B784F0',
]

/**
 * The first build of mood-tracking reused the deal rating's five points
 * (awful/bad/okay/good/great) before this richer vocabulary existed. Any
 * mood already saved under those values is carried forward to its nearest
 * new tag on load, the same way `dealLevel` carries the old red/blue/green
 * ratings forward — nothing typed in a previous build goes blank.
 */
const LEGACY_MOOD: Record<string, MoodTag> = {
  awful: 'stressed',
  bad: 'tired',
  okay: 'okay',
  good: 'productive',
  great: 'great',
}

/** Normalise a mood value stored under the old five-point build to one of
 *  the default nine's ids — an owner-added mood was never in that build, so
 *  it always passes straight through unchanged. */
export function moodTag(level?: string): string {
  if (!level) return 'okay'
  return LEGACY_MOOD[level] ?? level
}

/** The original three-point ratings, mapped onto the five-point scale. */
const LEGACY_DEAL: Record<string, DealRating> = {
  red: 'awful',
  blue: 'okay',
  green: 'great',
}

/** Normalise any stored rating — current or legacy — to a level. */
export function dealLevel(d?: string): DealRating | undefined {
  if (!d) return undefined
  if ((DEAL_LEVELS as readonly string[]).includes(d)) return d as DealRating
  return LEGACY_DEAL[d]
}

export function dealColor(d?: string): string | undefined {
  const level = dealLevel(d)
  return level ? DEAL_COLORS[level] : undefined
}

/** One slice of a payment that was split across accounts. */
export interface Split {
  accountId: string
  /** integer paise */
  amount: number
}

export const ACCOUNT_GROUPS = [
  'Cash',
  'Accounts',
  'Card',
  'Debit Card',
  'Savings',
  'Investments',
  'Others',
] as const
export type AccountGroup = (typeof ACCOUNT_GROUPS)[number]

export interface Account {
  id: string
  name: string
  group: AccountGroup
  /** integer paise */
  initialBalance: number
  excludeFromTotal: boolean
  order: number
  /**
   * Floats this one to the top of the picker, above the groups.
   *
   * Most accounts here are used once in a while; two of them are used all
   * day. Sorting by group alone means those two sit wherever their group
   * happens to fall and have to be found again on every entry.
   */
  pinned?: boolean
}

export interface Category {
  id: string
  name: string
  type: 'income' | 'expense'
  parentId?: string
  icon: string
  color: string
  order: number
  /** Sorts ahead of everything else in the picker — see Account.pinned. */
  pinned?: boolean
}

export interface Transaction {
  id: string
  type: TxType
  /** local ISO: YYYY-MM-DDTHH:mm */
  date: string
  /** integer paise, always positive */
  amount: number
  /** integer paise — margin on this entry. Negative means a loss. */
  profit?: number
  /** how the customer rated / how the deal went */
  deal?: DealRating
  categoryId?: string
  /** the single account this hit; ignored when `splits` is set */
  accountId?: string
  /** one entry paid across several accounts — parts must sum to `amount` */
  splits?: Split[]
  fromAccountId?: string
  toAccountId?: string
  fee?: number
  note: string
  description: string
  /**
   * Attachments, as data URLs. Downscaled on the way in — see lib/photo.ts.
   */
  photos?: string[]
  /**
   * The single attachment entries used to carry. Kept on the type so a
   * database or backup written before multiple photos still parses; load
   * folds it into `photos` and nothing writes it any more. Read through
   * `photosOf` rather than touching either field directly.
   */
  photo?: string
  repeatId?: string
}

export interface Budget {
  id: string
  /** YYYY-MM */
  month: string
  categoryId?: string
  amount: number
}

export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface RepeatRule {
  id: string
  template: Omit<Transaction, 'id' | 'date' | 'repeatId'>
  freq: RepeatFreq
  interval: number
  startDate: string
  endDate?: string
  lastRunDate?: string
}

/** One line of a note's checklist. */
export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

/** Free-form memo pinned to a date — the "Note" tab. */
export interface Memo {
  id: string
  /** YYYY-MM-DD */
  date: string
  title: string
  body: string
  /** Starred from the list, same idea as pinning an email — surfaced visually, not sorted to the top. */
  pinned?: boolean
  /** Optional checklist under the body — a shopping list inside a note rather than a separate to-do type. */
  checklist?: ChecklistItem[]
}

/** A recurring habit / daily to-do, checked off day by day — the "Habits" tab. */
/**
 * A day's tasks, bucketed into Morning/Afternoon/Evening — the Niba tab's
 * planner, opened from its own button rather than living inside the notes
 * list itself (see PlannerSheet in screens/Planner.tsx). A separate type
 * from Memo on purpose: a task is checked off and has a time-of-day and a
 * priority, none of which a free-form note needs, and forcing the two into
 * one shape would have meant every note carrying dead planner fields.
 */
export type PlannerBlock = 'morning' | 'afternoon' | 'evening'
export type PlannerPriority = 'high' | 'medium' | 'low'

export interface PlannerTask {
  id: string
  /** YYYY-MM-DD — the day this task is planned for. */
  date: string
  title: string
  subtitle?: string
  priority: PlannerPriority
  /** Minutes — never shown on the row itself (the reference mock doesn't
   *  show it either), only read by autoPlanDay when it buckets tasks. */
  durationMin: number
  /** null until placed — by a manual drag or by Auto-plan. */
  block: PlannerBlock | null
  /**
   * True once the owner has put this task in its block by hand (a manual
   * drag, or moving it in the block picker) — Auto-plan leaves any task with
   * this set exactly where it is on every future run, rather than sweeping
   * it back into the redistribution. False for a task Auto-plan itself
   * placed, which stays eligible to be re-bucketed on the next run.
   */
  manualBlock: boolean
  done: boolean
  /** Position within its block — reordered by dragging in PlannerSheet. */
  order: number
}

export interface Habit {
  id: string
  name: string
  subtitle?: string
  icon: string
  color: string
  order: number
  archived?: boolean
  /**
   * What one day's worth looks like, for habits that are a quantity rather
   * than a yes/no — thirty minutes of meditation, twenty push-ups, ten pages.
   *
   * Both optional and both needed together: with no unit the habit is a plain
   * tick, which is what most of them are and what should stay one tap. With a
   * unit the tick becomes a number entry, and `target` is what counts as the
   * day being done.
   */
  unit?: string
  target?: number
  /**
   * Which surface treatment the card wears. Left unset the card takes one
   * from its position in the list, so a fresh set of habits is already varied
   * without anyone choosing. Purely cosmetic — an unknown name from a later
   * build simply falls back to the plain card.
   */
  surface?: string
  /**
   * Gives this habit's detail sheet the extra row of stats built for
   * Meditate — average/best session for a metered habit, longest streak and
   * last-30-days for a plain tick. Used to be inferred by testing the name
   * for "meditat", which meant the one way to turn it on was to spell the
   * habit "Meditate" specifically; left undefined it still falls back to
   * that same name check, so an existing habit that only ever relied on the
   * name keeps working without anyone having to go flip a new switch.
   */
  meditation?: boolean
}

/** One day a habit was marked done. */
export interface HabitLog {
  id: string
  habitId: string
  /** YYYY-MM-DD */
  date: string
  /**
   * How much was done, for habits that carry a unit. Absent on a plain tick,
   * which is why every existing log still reads correctly — a log with no
   * amount simply means "done".
   */
  amount?: number
}

/**
 * Something done every so often rather than every day — servicing the printer,
 * a haircut, an oil change.
 *
 * The question a habit answers is "did I do it today". The question this
 * answers is "when did I last do it, and is that too long ago", which is why
 * it is a separate list rather than a flag on Habit: a streak is meaningless
 * here, and a missed day is not a failure.
 *
 * `everyDays` is the interval you *intend*, used only to colour the card once
 * it is overdue. It is optional because plenty of jobs have no schedule and
 * you just want the date on record.
 */
export interface Chore {
  id: string
  name: string
  subtitle?: string
  color: string
  /** intended interval in days; undefined = no schedule, just a record */
  everyDays?: number
  order: number
  archived?: boolean
}

export interface ChoreLog {
  id: string
  choreId: string
  /** YYYY-MM-DD */
  date: string
  note?: string
}

/**
 * One night's sleep — the "Sleep" tab.
 *
 * `date` is the night you went to *bed*, not the morning you woke: a night
 * that runs Tuesday 23:30 → Wednesday 07:00 is filed under Tuesday, because
 * that is what anyone means by "Tuesday night".
 *
 * That phrase is ambiguous for a bedtime past midnight, though — 01:15 is
 * calendar-Wednesday but is still Tuesday night to the person who went to
 * bed. `nightKeyOf` resolves it: a bedtime before noon counts as the previous
 * day. Always go through that function rather than slicing `start`.
 *
 * How long the night was is deliberately *not* stored. It is `start` to `end`
 * and nothing else, so editing either time cannot leave a stale duration
 * behind disagreeing with the times shown next to it.
 */
/**
 * A date worth remembering — a birthday, an anniversary, a renewal.
 *
 * Two kinds, and the difference matters for how it sorts: a `yearly` date
 * comes round again every year and only its month and day are meaningful,
 * while a one-off happens once and then belongs to the past. The stored
 * `date` always carries a full year anyway, so a birthday keeps the year it
 * started from and the age can be worked out later if it is ever wanted.
 */
export interface ImportantDate {
  id: string
  title: string
  /** YYYY-MM-DD */
  date: string
  /** true = comes round every year; false = one specific day */
  yearly: boolean
  note?: string
  /** Removed from the list but kept — nothing here is destroyed. */
  archived?: boolean
}

export interface SleepLog {
  id: string
  /** YYYY-MM-DD — the night you went to bed */
  date: string
  /** local ISO: YYYY-MM-DDTHH:mm */
  start: string
  end: string
}

/**
 * One day's mood — the check-in that sits where the habit-completion ring
 * used to, at the top of the Habits tab.
 *
 * One entry per date, same as `SleepLog`: setting today's mood twice replaces
 * it rather than stacking a second reading, since the day only ever has one
 * answer and a hidden duplicate would double-count it in any average.
 */
export interface MoodLog {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** A MoodDef id — one of the default nine, or one the owner added. */
  level: string
  note?: string
}

export type VaultCategory = 'bank' | 'card' | 'gst' | 'other'

/** The plaintext shape once a VaultItem is decrypted — never stored as-is. */
export interface VaultItemPlain {
  title: string
  fields: { label: string; value: string; sensitive?: boolean }[]
  notes?: string
  /** Passbook page, cheque leaf, that sort of thing — data URLs, encrypted along with everything else here. */
  photos?: string[]
}

/** At rest, everything but bookkeeping fields is one opaque encrypted blob. */
export interface VaultItem {
  id: string
  category: VaultCategory
  order: number
  /** base64 AES-GCM ciphertext of a JSON-encoded VaultItemPlain */
  cipher: string
}

export interface PasswordItemPlain {
  title: string
  username?: string
  password: string
  url?: string
  notes?: string
}

export interface PasswordItem {
  id: string
  order: number
  /** base64 AES-GCM ciphertext of a JSON-encoded PasswordItemPlain */
  cipher: string
}

/** PBKDF2 salt + an encrypted canary, so a wrong passphrase can be detected. */
export interface VaultSecurity {
  salt: string
  check: string
}

/**
 * A photo of an ID or important document, grouped under whoever it belongs
 * to. `category` is free text rather than a fixed list — a household's set
 * of people is not something the app can predict, so it groups by whatever
 * name was typed rather than offering a closed set.
 *
 * Kept in plain storage behind the vault's lock screen rather than
 * encrypted like `VaultItem`/`PasswordItem` — the lock screen is the real
 * boundary here (a fixed PIN, not a secret only he knows), and encrypting a
 * multi-hundred-KB photo on every read added meaningful decode time for no
 * real gain over that same boundary.
 */
export interface DocItem {
  id: string
  category: string
  title: string
  /**
   * data URLs — see lib/photo.ts. Almost always one page, but not forced to
   * be: sharing several photos from the gallery at once used to file each
   * one as its own separate document, which was never what a multi-page
   * scan or a few photos of the same paperwork actually are — one thing,
   * filed once. A single shared file still becomes an array of one.
   */
  photos: string[]
  /** Free-form, optional — a reminder ("renews every March"), a reference
   *  number not worth its own page, whatever doesn't belong in the title. */
  notes?: string
  order: number
}

/**
 * A loan/EMI to track. Kept in plain text (not the encrypted vault) so a
 * reminder can fire without needing the vault unlocked first.
 */
export interface Loan {
  id: string
  lender: string
  purpose: string
  loanAccountNumber?: string
  /** integer paise */
  principal?: number
  interestRate?: string
  /** integer paise */
  emiAmount: number
  /** 1-31 */
  emiDay: number
  startDate?: string
  endDate?: string
  /**
   * Anything this particular loan happens to need — sanctioned amount, branch,
   * agent's number, sanction date. Same label+value pattern the vault and
   * stock use, for the same reason: no two loans carry the same paperwork, and
   * a fixed set of columns would be wrong for every one of them.
   */
  fields?: { label: string; value: string }[]
  reminderEnabled: boolean
  /** 0 = remind same day, 1-7 = that many days ahead too */
  reminderDaysBefore: number
  notes?: string
  /** Sanction letter, agreement, EMI schedule — data URLs, pictures or PDFs,
   *  same pipeline as a vault entry's attachments (see lib/photo.ts). */
  photos?: string[]
  order: number
  archived?: boolean
}

/**
 * One line of stock on hand. The four things the shop always records get
 * named fields; anything else lives in `fields`, the same way a vault entry
 * carries whatever labels that particular account happens to need.
 *
 * `quantity` is free text on purpose — "12", "12 kg" and "3 boxes" are all
 * things worth being able to write down.
 */
export interface StockItem {
  id: string
  name: string
  variety: string
  quantity: string
  location: string
  fields: { label: string; value: string }[]
  notes?: string
  /** ISO timestamp of the last edit — drives the "updated ..." line */
  updatedAt: string
  order: number
}

/**
 * One item and what it costs to buy — the rate book.
 *
 * Deliberately not a `StockItem`. Stock answers "what is on the shelf right
 * now", which changes every day and is worth recording for a fraction of what
 * the shop deals in. This answers "what did this cost me", which barely
 * changes and is worth recording for everything, because it is the number
 * being guessed at from memory and old diaries when a deal is being priced.
 * Same item can appear in both; they are asked at different moments and go
 * stale at completely different rates.
 *
 * `rate` is integer paise like every other amount in the app, and is the cost
 * of exactly one `unit`. `unit` is the shop's own word — "piece", "meter",
 * "kg" — free text rather than a fixed list, because the next thing bought
 * always turns out to be measured in something the list did not have.
 *
 * `category`/`subcategory` are free text for the same reason, and are not the
 * transaction categories: those file money (Food, Health), these file goods,
 * and forcing one taxonomy to do both jobs makes both worse.
 */
export interface PurchaseItem {
  id: string
  name: string
  supplier: string
  /** integer paise — what one `unit` costs to buy */
  rate: number
  unit: string
  category: string
  subcategory: string
  /** data URIs, same pipeline as Loans/Documents — pictures or PDFs */
  photos?: string[]
  notes?: string
  /**
   * Items that are the same product in every way except this row — same
   * company's bulb, different wattage — share this id. `variant` is what
   * actually differs ("9W", "12W", "Red"), shown appended to `name` the same
   * way a plain "LED bulb 12W" name already reads. Rows stay one-per-variant
   * in the list; the grouping only makes editing the shared fields (name,
   * supplier, category, subcategory, photos, notes) apply to the whole set
   * at once, from any one of them — see `updatePurchaseItem` in store.tsx.
   */
  groupId?: string
  variant?: string
  /** ISO timestamp of the last edit — drives the "updated ..." line */
  updatedAt: string
  order: number
}

export interface Settings {
  currencySymbol: string
  symbolBefore: boolean
  decimals: 0 | 2
  /** 0 = Sunday */
  firstDayOfWeek: 0 | 1
  /** 1..28 — book month start */
  monthStartDay: number
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
  carryOver: boolean
  accent: string
  darkMode: boolean
  passcode?: string
  reminderTime?: string

  /** How much of a habit's activity calendar to show at once. */
  habitGraphRange?: 'week' | 'month' | 'year'

  startScreen: 'Daily' | 'Total'
  subcategory: boolean
  showDescription: boolean
  autocomplete: boolean
  /** 'amount' = keypad opens with the editor */
  inputOrder: 'amount' | 'category'
  /** Set. A = expense red / income blue. Set. B swaps them. */
  colorSet: 'A' | 'B'
  timeInput: boolean
  quickAdd: boolean
  noteButton: boolean
  /**
   * Keeps an in-progress entry — whatever's typed into Love/Wow and every
   * other field on the sheet — if the app is backgrounded or killed before
   * Save is tapped, and puts it back exactly as it was next time the editor
   * opens. Off is the honest "nothing survives a real backgrounding" default
   * a JS app actually has without this; on writes the draft to durable
   * device storage on every change, not just React state, so it comes back
   * even after Android has fully killed the process for memory.
   */
  keepDraftEntry: boolean
  /** transfer fees counted as an expense in totals */
  transferAsExpense: boolean
  cardExpenseDisplay: 'atTheTime' | 'onPayment'
  /**
   * The order of the Train sub-tabs. Stored as plain strings rather than a
   * union so an older build that has never heard of a tab still loads the
   * setting instead of choking on it; unknown names are dropped and missing
   * ones appended when the list is read.
   */
  transTabOrder?: string[]
}

export interface DB {
  version: number
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  budgets: Budget[]
  repeats: RepeatRule[]
  memos: Memo[]
  habits: Habit[]
  habitLogs: HabitLog[]
  chores: Chore[]
  choreLogs: ChoreLog[]
  sleepLogs: SleepLog[]
  importantDates: ImportantDate[]
  moodLogs: MoodLog[]
  /** The owner's own mood vocabulary — starts out as `DEFAULT_MOODS`. */
  moods: MoodDef[]
  /**
   * Deleted entries and notes, kept rather than destroyed.
   *
   * Nothing in this app removes a record any more; delete moves it here and
   * every screen reads the live lists, so a hidden entry is gone from view
   * and gone from every total without being gone. Restoring puts it back
   * exactly as it was, which is not possible once a row is actually dropped.
   *
   * Kept as separate lists rather than a `hidden` flag on each record for one
   * reason: every existing read of `transactions` stays correct with no
   * changes, so there is no screen left to forget.
   */
  hiddenTransactions: Transaction[]
  hiddenMemos: Memo[]
  vaultItems: VaultItem[]
  passwordItems: PasswordItem[]
  docItems: DocItem[]
  vaultSecurity?: VaultSecurity
  loans: Loan[]
  stockItems: StockItem[]
  purchaseItems: PurchaseItem[]
  plannerTasks: PlannerTask[]
  settings: Settings
}
