import type {
  Chore,
  ChoreLog,
  DB,
  DocItem,
  Habit,
  HabitLog,
  ImportantDate,
  Loan,
  Memo,
  MoodLog,
  PasswordItem,
  PurchaseItem,
  SleepLog,
  StockItem,
  Transaction,
  VaultItem,
} from '../types'
import { MOOD_TAGS } from '../types'
import { addDays, todayKey } from './date'
import { CHART_COLORS, uid } from './seed'
import { deriveVaultKey, encryptJSON, encryptText, randomSaltB64 } from './crypto'
import { CANARY, sequenceToPassphrase } from './vaultConst'

/** Dev preview only — real installs have the owner pick their own four-icon
 *  sequence in VaultLock (Authentication.tsx). Fixed here purely so the
 *  fake vault entries this file seeds are unlockable without going through
 *  that setup: heart, star, sun, moon, tapped in the same grid VaultLock
 *  itself renders. */
const DEV_DEMO_SEQUENCE = ['heart', 'star', 'sun', 'moon']
const DEV_DEMO_PASSPHRASE = sequenceToPassphrase(DEV_DEMO_SEQUENCE)

/**
 * Dev-only sample data — every screen has something real to look at instead
 * of an empty state, so a change can be checked in the preview without
 * hand-typing a week of transactions first. Never runs in a production
 * build (gated on `import.meta.env.DEV` at the call site) and never
 * overwrites a database that already has something in it.
 */

const NOTES: [string, string][] = [
  ['Meeting', 'Meet with clients for the requirements'],
  ['Morning Walk', 'Jogging and morning walk in park'],
  ['Go to the market', 'Shopping for all the grocery items of household'],
  ['Planting', 'Water the plants and check the soil'],
  ['Supplier call', 'Follow up on the delayed cable delivery'],
  ['Bank visit', 'Ask about the loan statement and update KYC'],
]

const TX_NOTES: [string, string][] = [
  ['Tea and snacks', 'Tea'],
  ['Lunch', 'Lunch'],
  ['Petrol', 'Petrol'],
  ['Mobile sale', 'Accessory'],
  ['Screen guard', 'Repair'],
  ['Misc income', 'Other'],
  ['Staff salary', 'staff'],
  ['Recharge', 'Recarge'],
]

/** name, category, subcategory, unit, rate in whole rupees, supplier */
const PURCHASE_SAMPLES: [string, string, string, string, number, string][] = [
  ['Copper wire 1.5 sq mm', 'Wiring', 'Copper', 'meter', 32, 'Sharma Electricals'],
  ['Copper wire 2.5 sq mm', 'Wiring', 'Copper', 'meter', 48, 'Sharma Electricals'],
  ['Copper wire 4 sq mm', 'Wiring', 'Copper', 'meter', 76, 'Sharma Electricals'],
  ['Aluminium wire 4 sq mm', 'Wiring', 'Aluminium', 'meter', 29, 'Verma Traders'],
  ['Casing pipe 1 inch', 'Wiring', 'Casing', 'meter', 22, 'Verma Traders'],
  ['Modular switch 1 way', 'Switches', 'Modular', 'piece', 65, 'Anchor Agency'],
  ['Modular socket 6A', 'Switches', 'Modular', 'piece', 78, 'Anchor Agency'],
  ['Switch plate 4 module', 'Switches', 'Plates', 'piece', 145, 'Anchor Agency'],
  ['Bell push', 'Switches', 'Modular', 'piece', 55, 'Anchor Agency'],
  ['LED bulb 9W', 'Lighting', 'Bulbs', 'piece', 82, 'Bright Wholesale'],
  ['LED bulb 12W', 'Lighting', 'Bulbs', 'piece', 108, 'Bright Wholesale'],
  ['LED tube 20W', 'Lighting', 'Tubes', 'piece', 190, 'Bright Wholesale'],
  ['LED strip warm', 'Lighting', 'Strip', 'meter', 45, 'Bright Wholesale'],
  ['Panel light 15W', 'Lighting', 'Panel', 'piece', 240, 'Bright Wholesale'],
  ['PVC pipe 1 inch', 'Plumbing', 'PVC', 'meter', 58, 'Verma Traders'],
  ['PVC elbow 1 inch', 'Plumbing', 'Fittings', 'piece', 18, 'Verma Traders'],
  ['Teflon tape', 'Plumbing', 'Fittings', 'piece', 9, 'Verma Traders'],
  ['MCB 16A single pole', 'Protection', 'MCB', 'piece', 165, 'Sharma Electricals'],
  ['MCB 32A double pole', 'Protection', 'MCB', 'piece', 420, 'Sharma Electricals'],
  ['Distribution box 8 way', 'Protection', 'Boxes', 'piece', 690, 'Sharma Electricals'],
  ['Insulation tape', 'Consumables', 'Tape', 'piece', 12, 'Anchor Agency'],
  ['Cable tie 6 inch', 'Consumables', 'Ties', 'packet', 35, 'Anchor Agency'],
  ['Screws 1 inch', 'Consumables', 'Fasteners', 'packet', 40, 'Verma Traders'],
  ['Ceiling fan 1200mm', 'Appliances', 'Fans', 'piece', 1450, 'Bright Wholesale'],
  ['Exhaust fan 8 inch', 'Appliances', 'Fans', 'piece', 780, 'Bright Wholesale'],
  ['Immersion rod 1500W', 'Appliances', 'Heating', 'piece', 395, 'Bright Wholesale'],
]

const LOAN_SAMPLES: {
  lender: string
  purpose: string
  loanAccountNumber: string
  principalRupees: number
  interestRate: string
  emiRupees: number
  emiDay: number
}[] = [
  {
    lender: 'HDFC Bank',
    purpose: 'Shop renovation',
    loanAccountNumber: 'HDFCLN00481223',
    principalRupees: 500000,
    interestRate: '10.5% p.a.',
    emiRupees: 12500,
    emiDay: 5,
  },
  {
    lender: 'Bajaj Finserv',
    purpose: 'Delivery two-wheeler',
    loanAccountNumber: 'BJFN2291771',
    principalRupees: 80000,
    interestRate: '13% p.a.',
    emiRupees: 3200,
    emiDay: 10,
  },
]

/** name, variety, quantity, location */
const STOCK_SAMPLES: [string, string, string, string][] = [
  ['Copper wire 1.5 sq mm', 'Red', '180 meter', 'Godown shelf A'],
  ['Copper wire 2.5 sq mm', 'Black', '95 meter', 'Godown shelf A'],
  ['Modular switch 1 way', 'Anchor', '64 pieces', 'Counter drawer 2'],
  ['LED bulb 9W', 'Bright warm white', '40 pieces', 'Counter shelf'],
  ['LED bulb 12W', 'Bright cool white', '18 pieces', 'Counter shelf'],
  ['MCB 16A single pole', 'Sharma branded', '22 pieces', 'Godown shelf B'],
  ['PVC pipe 1 inch', 'White', '12 pieces', 'Godown floor'],
  ['Ceiling fan 1200mm', 'White, 3 blade', '4 pieces', 'Back room'],
]

/** name, subtitle, everyDays */
const CHORE_SAMPLES: [string, string | undefined, number | undefined][] = [
  ['Change RO filter', 'Kitchen purifier', 90],
  ['Service inverter battery', 'Shop backup', 180],
  ['Clean shop signage', undefined, 30],
  ['Pay shop rent', 'To landlord', 30],
  ['Pest control', 'Whole shop', 120],
]

/** category, title */
const DOC_SAMPLES: [string, string][] = [
  ['Pratham', 'Aadhaar card'],
  ['Pratham', 'PAN card'],
  ['Shop', 'GST certificate'],
  ['Shop', 'Shop license'],
  ['Shop', 'Electricity bill'],
]

const IMPORTANT_DATE_SAMPLES: { title: string; monthDay: [number, number]; yearly: boolean }[] = [
  { title: "Pratham's birthday", monthDay: [14, 3], yearly: true },
  { title: 'Shop lease renewal', monthDay: [1, 4], yearly: true },
  { title: 'GST annual filing', monthDay: [31, 12], yearly: true },
]

const PASSWORD_SAMPLES: { title: string; username: string; password: string; url: string }[] = [
  { title: 'GST Portal', username: 'pratham@shopmail.com', password: 'Gst@2026Secure', url: 'gst.gov.in' },
  { title: 'Shop WiFi', username: '', password: 'ShopWifi@2026', url: '' },
  { title: 'Amazon Business', username: 'prathamkaithwas@gmail.com', password: 'Amzn#Biz2026', url: 'business.amazon.in' },
]

/** A small labelled placeholder image, generated rather than shipped — the
 *  point of the fake data is to preview layout, not to carry real scans of
 *  anyone's documents. */
function placeholderPhoto(label: string, bg: string): string {
  const c = document.createElement('canvas')
  c.width = 320
  c.height = 200
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 320, 200)
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = 'bold 22px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 160, 100)
  return c.toDataURL('image/png')
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

export function withFakeData(db: DB): DB {
  const today = todayKey()
  const expenseCats = db.categories.filter((c) => c.type === 'expense')
  const incomeCats = db.categories.filter((c) => c.type === 'income')
  const accountIds = db.accounts.map((a) => a.id)
  if (!expenseCats.length || !incomeCats.length || !accountIds.length) return db

  const transactions: Transaction[] = []
  for (let i = 0; i < 25; i++) {
    const date = addDays(today, -i)
    const perDay = randInt(1, 4)
    for (let j = 0; j < perDay; j++) {
      const isIncome = Math.random() < 0.25
      const [note, description] = pick(TX_NOTES)
      const hh = String(randInt(9, 21)).padStart(2, '0')
      const mm = String(randInt(0, 59)).padStart(2, '0')
      transactions.push({
        id: uid(),
        type: isIncome ? 'income' : 'expense',
        date: `${date}T${hh}:${mm}`,
        amount: randInt(50, 5000) * 100,
        categoryId: pick(isIncome ? incomeCats : expenseCats).id,
        accountId: pick(accountIds),
        note,
        description,
      })
    }
  }

  const memos: Memo[] = NOTES.map(([title, body], i) => ({
    id: uid(),
    date: addDays(today, -randInt(0, 20)),
    title,
    body,
    pinned: i === 2,
  }))

  const sleepLogs: SleepLog[] = []
  for (let i = 1; i <= 20; i++) {
    if (Math.random() < 0.15) continue // the odd real night off
    const night = addDays(today, -i)
    const bedH = randInt(22, 23)
    const bedM = pick([0, 15, 30, 45])
    const wakeH = randInt(6, 8)
    const wakeM = pick([0, 15, 30, 45])
    sleepLogs.push({
      id: uid(),
      date: night,
      start: `${night}T${String(bedH).padStart(2, '0')}:${String(bedM).padStart(2, '0')}`,
      end: `${addDays(night, 1)}T${String(wakeH).padStart(2, '0')}:${String(wakeM).padStart(2, '0')}`,
    })
  }

  const moodLogs: MoodLog[] = []
  for (let i = 0; i < 20; i++) {
    moodLogs.push({ id: uid(), date: addDays(today, -i), level: pick(MOOD_TAGS) })
  }

  const habits: Habit[] = [
    { id: uid(), name: 'Meditate', icon: '', color: '#4C8CF5', order: 0 },
    { id: uid(), name: 'Read', icon: '', color: '#7ED957', order: 1, unit: 'pages', target: 20 },
    { id: uid(), name: 'Exercise', icon: '', color: '#F58C4E', order: 2 },
  ]
  const habitLogs: HabitLog[] = []
  for (const habit of habits) {
    for (let i = 0; i < 20; i++) {
      if (Math.random() < 0.4) continue
      habitLogs.push({
        id: uid(),
        habitId: habit.id,
        date: addDays(today, -i),
        amount: habit.unit ? randInt(5, habit.target ?? 20) : undefined,
      })
    }
  }

  // Spread across categories, units and suppliers on purpose: the rate book
  // is only worth anything once there is enough in it that you cannot hold
  // it in your head, which is exactly the state that has to be previewable.
  const purchaseItems: PurchaseItem[] = PURCHASE_SAMPLES.map(
    ([name, category, subcategory, unit, rupees, supplier], i) => ({
      id: uid(),
      name,
      category,
      subcategory,
      unit,
      rate: rupees * 100,
      supplier,
      updatedAt: new Date(Date.now() - randInt(0, 90) * 86400000).toISOString(),
      order: i,
    }),
  )

  const loans: Loan[] = LOAN_SAMPLES.map((l, i) => ({
    id: uid(),
    lender: l.lender,
    purpose: l.purpose,
    loanAccountNumber: l.loanAccountNumber,
    principal: l.principalRupees * 100,
    interestRate: l.interestRate,
    emiAmount: l.emiRupees * 100,
    emiDay: l.emiDay,
    startDate: addDays(today, -randInt(60, 400)),
    reminderEnabled: true,
    reminderDaysBefore: 2,
    order: i,
  }))

  const stockItems: StockItem[] = STOCK_SAMPLES.map(([name, variety, quantity, location], i) => ({
    id: uid(),
    name,
    variety,
    quantity,
    location,
    fields: [],
    updatedAt: new Date(Date.now() - randInt(0, 30) * 86400000).toISOString(),
    order: i,
  }))

  const chores: Chore[] = CHORE_SAMPLES.map(([name, subtitle, everyDays], i) => ({
    id: uid(),
    name,
    subtitle,
    color: CHART_COLORS[(i * 5) % CHART_COLORS.length],
    everyDays,
    order: i,
  }))
  const choreLogs: ChoreLog[] = []
  for (const chore of chores) {
    // A handful of logs spread over the last several intervals, not a
    // perfect schedule — a chore that's actually kept up with still has
    // the odd cycle run late or skipped.
    const span = chore.everyDays ?? 30
    for (let n = 1; n <= 5; n++) {
      if (Math.random() < 0.2) continue
      choreLogs.push({
        id: uid(),
        choreId: chore.id,
        date: addDays(today, -(n * span + randInt(-3, 3))),
      })
    }
  }

  const docItems: DocItem[] = DOC_SAMPLES.map(([category, title], i) => ({
    id: uid(),
    category,
    title,
    photos: [placeholderPhoto(title, CHART_COLORS[i % CHART_COLORS.length])],
    order: i,
  }))

  const importantDates: ImportantDate[] = IMPORTANT_DATE_SAMPLES.map(({ title, monthDay, yearly }) => {
    const [day, month] = monthDay
    const y = Number(today.slice(0, 4))
    return {
      id: uid(),
      title,
      date: `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      yearly,
    }
  })

  return {
    ...db,
    transactions: [...db.transactions, ...transactions],
    memos: [...db.memos, ...memos],
    sleepLogs: [...db.sleepLogs, ...sleepLogs],
    moodLogs: [...db.moodLogs, ...moodLogs],
    habits: [...db.habits, ...habits],
    habitLogs: [...db.habitLogs, ...habitLogs],
    purchaseItems: [...db.purchaseItems, ...purchaseItems],
    loans: [...db.loans, ...loans],
    stockItems: [...db.stockItems, ...stockItems],
    chores: [...db.chores, ...chores],
    choreLogs: [...db.choreLogs, ...choreLogs],
    docItems: [...db.docItems, ...docItems],
    importantDates: [...db.importantDates, ...importantDates],
  }
}

/**
 * The vault and passwords are encrypted at rest, so seeding them needs a
 * real key rather than a plain object literal. This provisions the vault's
 * lock with DEV_DEMO_SEQUENCE above and encrypts each sample entry under
 * it — so opening it for the first time in the dev preview finds it
 * already unlocked-ready and full (tap heart, star, sun, moon), the same
 * as every other screen the fake data touches, without going through
 * VaultLock's real first-use setup flow.
 *
 * Kept separate from `withFakeData` because encryption is async and that
 * one isn't; the call site awaits this as its own step.
 */
export async function withFakeVaultData(db: DB): Promise<DB> {
  if (db.vaultSecurity || db.vaultItems.length || db.passwordItems.length) return db

  const salt = randomSaltB64()
  const key = await deriveVaultKey(DEV_DEMO_PASSPHRASE, salt)
  const check = await encryptText(key, CANARY)

  const vaultItems: VaultItem[] = [
    {
      id: uid(),
      category: 'bank',
      order: 0,
      cipher: await encryptJSON(key, {
        title: 'HDFC Savings',
        fields: [
          { label: 'Account Holder', value: 'Pratham Kaithwas' },
          { label: 'Account Number', value: '50100234567890', sensitive: true },
          { label: 'IFSC Code', value: 'HDFC0001234' },
          { label: 'Bank Name', value: 'HDFC Bank' },
          { label: 'Branch', value: 'MP Nagar Branch' },
          { label: 'UPI ID', value: 'pratham@hdfc' },
        ],
      }),
    },
    {
      id: uid(),
      category: 'card',
      order: 1,
      cipher: await encryptJSON(key, {
        title: 'HDFC Business Card',
        fields: [
          { label: 'Card Holder', value: 'Pratham Kaithwas' },
          { label: 'Card Number', value: '4532871056342219', sensitive: true },
          { label: 'Expiry (MM/YY)', value: '09/29' },
          { label: 'CVV', value: '482', sensitive: true },
          { label: 'Card Network', value: 'Visa' },
          { label: 'Bank', value: 'HDFC' },
          { label: 'Card Type', value: 'Credit' },
        ],
      }),
    },
    {
      id: uid(),
      category: 'card',
      order: 2,
      cipher: await encryptJSON(key, {
        title: 'SBI Debit Card',
        fields: [
          { label: 'Card Holder', value: 'Pratham Kaithwas' },
          { label: 'Card Number', value: '5241093867215530', sensitive: true },
          { label: 'Expiry (MM/YY)', value: '04/28' },
          { label: 'CVV', value: '117', sensitive: true },
          { label: 'Card Network', value: 'Mastercard' },
          { label: 'Bank', value: 'SBI' },
          { label: 'Card Type', value: 'Debit' },
        ],
      }),
    },
    {
      id: uid(),
      category: 'card',
      order: 3,
      cipher: await encryptJSON(key, {
        title: 'Bank of Baroda RuPay',
        fields: [
          { label: 'Card Holder', value: 'Pratham Kaithwas' },
          { label: 'Card Number', value: '6076259914430082', sensitive: true },
          { label: 'Expiry (MM/YY)', value: '11/30' },
          { label: 'CVV', value: '904', sensitive: true },
          { label: 'Card Network', value: 'RuPay' },
          { label: 'Bank', value: 'Bank of Baroda' },
          { label: 'Card Type', value: 'Debit' },
        ],
      }),
    },
  ]

  const passwordItems: PasswordItem[] = await Promise.all(
    PASSWORD_SAMPLES.map(async (p, i): Promise<PasswordItem> => ({
      id: uid(),
      order: i,
      cipher: await encryptJSON(key, {
        title: p.title,
        username: p.username || undefined,
        password: p.password,
        url: p.url || undefined,
      }),
    })),
  )

  return {
    ...db,
    vaultSecurity: { salt, check },
    vaultItems: [...db.vaultItems, ...vaultItems],
    passwordItems: [...db.passwordItems, ...passwordItems],
  }
}

/** True once anything a real user could have entered is present. */
export function isEmptyOfUserData(db: DB): boolean {
  return (
    db.transactions.length === 0 &&
    db.memos.length === 0 &&
    db.sleepLogs.length === 0 &&
    db.habits.length === 0 &&
    db.moodLogs.length === 0
  )
}
