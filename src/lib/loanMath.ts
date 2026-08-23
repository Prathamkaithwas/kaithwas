import type { Loan } from '../types'

/**
 * What a loan actually costs, worked out from what the app already stores.
 *
 * The Loans screen has always been a record: lender, EMI, rate, dates. The one
 * thing it computed was how far through the *calendar* a loan was, which is
 * the number a borrower is most likely to misread. On a 10.5% loan, halfway
 * through the years you are nowhere near halfway through the debt — the early
 * EMIs are mostly interest, so the principal barely moves at first. Every
 * figure here exists to answer "how much do I still owe, really".
 *
 * All money is integer paise, matching the rest of the app. All rates are
 * annual percentages.
 */

/** Pull a number out of whatever was typed in the rate box — "10.5% p.a.",
 *  "10.5 %", "10.5" all mean the same thing. Returns null when there is
 *  nothing usable, so callers can fall back to showing the raw text. */
export function parseRate(rate?: string): number | null {
  if (!rate) return null
  const m = rate.replace(',', '.').match(/-?\d+(\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : null
}

/** Whole months between two dates, never negative. */
function monthsBetween(fromISO: string, to: Date): number {
  const a = new Date(fromISO + (fromISO.length <= 10 ? 'T00:00' : ''))
  if (Number.isNaN(a.getTime())) return 0
  const months = (to.getFullYear() - a.getFullYear()) * 12 + (to.getMonth() - a.getMonth())
  return Math.max(0, months - (to.getDate() < a.getDate() ? 1 : 0))
}

export interface LoanAnalysis {
  /** Annual rate actually used, as a percentage. */
  ratePct: number
  /** Total number of EMIs the loan takes to clear. */
  totalEmis: number
  /** EMIs already paid, by the calendar. */
  emisPaid: number
  emisLeft: number
  /** integer paise */
  totalRepayment: number
  totalInterest: number
  /** What is still owed today — the number that actually matters. */
  outstanding: number
  /** Principal cleared so far. */
  principalPaid: number
  /** Interest handed over so far. */
  interestPaid: number
  /**
   * Share of the *debt* cleared, 0-100. Deliberately separate from the
   * calendar progress the card already draws: on a long loan these two
   * disagree sharply for years, and the gap between them is the single most
   * useful thing this whole module has to say.
   */
  debtPct: number
  /** Split of the next EMI, so "where does my money actually go" is answerable. */
  nextInterest: number
  nextPrincipal: number
  /** When the last EMI lands, if a start date is known. */
  payoffDate: Date | null
}

/**
 * Returns null when the loan simply does not hold enough to reason about —
 * no principal, no rate, no EMI, or an EMI too small to ever clear the
 * interest (a real situation, and one worth refusing to draw a fake
 * projection for rather than dividing by zero and showing a confident wrong
 * number).
 */
export function analyseLoan(loan: Loan, now: Date = new Date()): LoanAnalysis | null {
  const P = loan.principal ?? 0
  const E = loan.emiAmount ?? 0
  const ratePct = parseRate(loan.interestRate)
  if (P <= 0 || E <= 0 || ratePct === null) return null

  const r = ratePct / 12 / 100

  // An interest-free loan is just division; the log formula below would
  // divide by zero on it.
  let totalEmis: number
  if (r === 0) {
    totalEmis = Math.ceil(P / E)
  } else {
    // The EMI has to at least cover the first month's interest, or the
    // balance grows forever and there is no payoff to project.
    if (E <= P * r) return null
    const exact = -Math.log(1 - (P * r) / E) / Math.log(1 + r)
    // Ceil is right for a genuine fractional tail — 35.6 EMIs really does
    // need a 36th payment. It is wrong for 35.0007, which is a real 35-EMI
    // contract plus floating-point dust, and rounding that up invents an
    // instalment: a 36-month schedule reads as 37, and the total repayment
    // overshoots the agreement value by a whole EMI. Snap to the integer when
    // we are already within a hundredth of one.
    totalEmis =
      Math.abs(exact - Math.round(exact)) < 0.01 ? Math.round(exact) : Math.ceil(exact)
  }
  if (!Number.isFinite(totalEmis) || totalEmis <= 0) return null

  const emisPaid = loan.startDate ? Math.min(totalEmis, monthsBetween(loan.startDate, now)) : 0
  const emisLeft = Math.max(0, totalEmis - emisPaid)

  // Balance after k payments: P(1+r)^k − E·((1+r)^k − 1)/r
  const balanceAfter = (k: number): number => {
    if (k <= 0) return P
    if (r === 0) return Math.max(0, P - E * k)
    const g = Math.pow(1 + r, k)
    return Math.max(0, P * g - (E * (g - 1)) / r)
  }

  const outstanding = balanceAfter(emisPaid)
  const principalPaid = P - outstanding
  const interestPaid = Math.max(0, E * emisPaid - principalPaid)

  // The final EMI is usually a little smaller than the rest; using it
  // unrounded would overstate the total by a few rupees, which is exactly
  // the kind of thing that makes a borrower distrust the whole screen.
  const totalRepayment = E * (totalEmis - 1) + balanceAfter(totalEmis - 1) * (1 + r)
  const totalInterest = Math.max(0, totalRepayment - P)

  const nextInterest = Math.round(outstanding * r)
  const nextPrincipal = Math.max(0, Math.min(E, Math.round(E - nextInterest)))

  let payoffDate: Date | null = null
  if (loan.startDate) {
    const s = new Date(loan.startDate + (loan.startDate.length <= 10 ? 'T00:00' : ''))
    if (!Number.isNaN(s.getTime())) {
      payoffDate = new Date(s)
      payoffDate.setMonth(payoffDate.getMonth() + totalEmis)
    }
  }

  return {
    ratePct,
    totalEmis,
    emisPaid,
    emisLeft,
    totalRepayment: Math.round(totalRepayment),
    totalInterest: Math.round(totalInterest),
    outstanding: Math.round(outstanding),
    principalPaid: Math.round(principalPaid),
    interestPaid: Math.round(interestPaid),
    debtPct: P > 0 ? Math.min(100, Math.max(0, (principalPaid / P) * 100)) : 0,
    nextInterest,
    nextPrincipal,
    payoffDate,
  }
}

/**
 * What paying a bit extra every month would do.
 *
 * The most actionable number a borrower can be shown: not "you owe X" but
 * "another ₹1,000 a month and you are free eleven months sooner, ₹40,000
 * lighter". Returns null when the extra changes nothing worth reporting.
 */
export function prepaymentEffect(
  loan: Loan,
  extraPerMonth: number,
  now: Date = new Date(),
): { monthsSaved: number; interestSaved: number; newEmisLeft: number } | null {
  const base = analyseLoan(loan, now)
  if (!base || extraPerMonth <= 0) return null

  const r = base.ratePct / 12 / 100
  const E = loan.emiAmount + extraPerMonth
  let balance = base.outstanding
  if (balance <= 0) return null

  let months = 0
  let interest = 0
  // Straightforward month-by-month run rather than a closed form: the loop is
  // bounded by the original tenure, it is a few hundred iterations at worst,
  // and it stays obviously correct if a rounding rule ever changes.
  const cap = base.emisLeft + 1
  while (balance > 0 && months < cap) {
    const i = balance * r
    interest += i
    balance = balance + i - E
    months++
  }
  if (months >= cap) return null

  // Interest still to come on the untouched schedule: every remaining EMI
  // added up, less the balance those EMIs are actually retiring. Read off
  // `loan`, not off `base` — the analysis reports the loan, it does not carry
  // the EMI itself, and reaching for a field that was never on it is how this
  // silently became NaN the first time round.
  const baseInterest = loan.emiAmount * base.emisLeft - base.outstanding
  const monthsSaved = base.emisLeft - months
  const interestSaved = Math.round(Math.max(0, baseInterest - interest))
  if (monthsSaved <= 0 && interestSaved <= 0) return null

  return { monthsSaved, interestSaved, newEmisLeft: months }
}
