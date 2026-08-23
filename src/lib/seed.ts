import type { Account, Category, DB, Settings } from '../types'
import { DEFAULT_MOODS } from '../types'

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export const DEFAULT_SETTINGS: Settings = {
  // Was '₹' until the rebuild commit turned it into '@' — an encoding
  // casualty, not a decision. A fresh install was pricing everything in
  // at-signs. Only the default: an existing database keeps whatever symbol is
  // saved in it, because that one may well be a real choice.
  currencySymbol: '₹',
  symbolBefore: true,
  decimals: 2,
  firstDayOfWeek: 0,
  monthStartDay: 1,
  dateFormat: 'DD/MM/YYYY',
  carryOver: false,
  accent: '#C41230',
  darkMode: true,

  startScreen: 'Daily',
  subcategory: true,
  showDescription: true,
  autocomplete: true,
  inputOrder: 'amount',
  colorSet: 'A',
  timeInput: true,
  quickAdd: false,
  noteButton: false,
  keepDraftEntry: true,
  transferAsExpense: false,
  cardExpenseDisplay: 'atTheTime',
}

export const ACCENT_PRESETS = [
  '#C41230', // vampire red (default)
  '#F4695D', // coral
  '#2FA3A0', // teal
  '#3F7EDB', // blue
  '#7E57C2', // purple
  '#F0A030', // amber
  '#4A4A4A', // graphite
]

/** Pie/legend palette, in the order the app hands them out. */
export const CHART_COLORS = [
  '#F4695D','#F58C4E','#F5C242','#C8DC4B','#7ED957','#3FC77F',
  '#35C5C0','#4C8CF5','#7E7BE8','#B476E5','#E36FB4','#9AA0A6',
]

const EXPENSE_CATS: [string, string, string][] = [
  ['Food', '\u{1F35A}', '#F4695D'],
  ['Social Life', '\u{1F37B}', '#F58C4E'],
  ['Pets', '\u{1F43E}', '#C8DC4B'],
  ['Transport', '\u{1F68C}', '#4C8CF5'],
  ['Culture', '\u{1F3AC}', '#7E7BE8'],
  ['Household', '\u{1F3E0}', '#7ED957'],
  ['Apparel', '\u{1F455}', '#E36FB4'],
  ['Beauty', '\u{1F484}', '#B476E5'],
  ['Health', '\u{1F489}', '#3FC77F'],
  ['Education', '\u{1F4DA}', '#35C5C0'],
  ['Gift', '\u{1F381}', '#F5C242'],
  ['Suplier', '\u{1F4E6}', '#F4695D'],
  ['Recarge', '\u{1F4F1}', '#F58C4E'],
  ['staff', '\u{1F477}', '#F5C242'],
  ['Family', '\u{1F46A}', '#C8DC4B'],
  ['delivery', '\u{1F6F5}', '#35C5C0'],
  ['Customer Return', '\u{21A9}', '#7ED957'],
  ['Other', '\u{2795}', '#9AA0A6'],
]

const INCOME_CATS: [string, string, string][] = [
  ['Customer', '\u{1F464}', '#F4695D'],
  ['Salary', '\u{1F4BC}', '#4C8CF5'],
  ['Allowance', '\u{1F4B5}', '#3FC77F'],
  ['Bonus', '\u{1F3AF}', '#35C5C0'],
  ['extraSold', '\u{1F4E4}', '#F5C242'],
  ['family', '\u{1F46A}', '#F58C4E'],
  ['Other', '\u{2795}', '#9AA0A6'],
]

const ACCOUNTS: [string, Account['group']][] = [
  ['Cash', 'Cash'],
  ['CashWallet', 'Cash'],
  ['CashGalla', 'Cash'],
  ['Gpay', 'Accounts'],
  ['Bank', 'Accounts'],
  ['Card', 'Card'],
]

export function seedDB(): DB {
  const categories: Category[] = [
    ...EXPENSE_CATS.map(([name, icon, color], i) => ({
      id: uid(),
      name,
      type: 'expense' as const,
      icon,
      color,
      order: i,
    })),
    ...INCOME_CATS.map(([name, icon, color], i) => ({
      id: uid(),
      name,
      type: 'income' as const,
      icon,
      color,
      order: i,
    })),
  ]

  const accounts: Account[] = ACCOUNTS.map(([name, group], i) => ({
    id: uid(),
    name,
    group,
    initialBalance: 0,
    excludeFromTotal: false,
    order: i,
  }))

  return {
    version: 9,
    accounts,
    categories,
    transactions: [],
    budgets: [],
    repeats: [],
    memos: [],
    habits: [],
    habitLogs: [],
    chores: [],
    choreLogs: [],
    sleepLogs: [],
    importantDates: [],
    moodLogs: [],
    moods: DEFAULT_MOODS,
    hiddenTransactions: [],
    hiddenMemos: [],
    vaultItems: [],
    passwordItems: [],
    docItems: [],
    loans: [],
    stockItems: [],
    purchaseItems: [],
    plannerTasks: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}
