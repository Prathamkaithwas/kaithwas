import type { Settings } from '../types'

/** All money is stored as integer paise. Never do float math on stored values. */

export function toPaise(input: string | number): number {
  const n = typeof input === 'number' ? input : parseFloat(input || '0')
  if (!isFinite(n)) return 0
  return Math.round(n * 100)
}

export function fromPaise(paise: number): number {
  return paise / 100
}

/** 1,23,456.00 — Indian grouping */
export function groupIndian(intPart: string): string {
  const neg = intPart.startsWith('-')
  const s = neg ? intPart.slice(1) : intPart
  if (s.length <= 3) return (neg ? '-' : '') + s
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return (neg ? '-' : '') + grouped + ',' + last3
}

export function formatAmount(
  paise: number,
  s: Pick<Settings, 'decimals'>,
  opts: { signed?: boolean } = {},
): string {
  const abs = Math.abs(paise)
  const whole = Math.floor(abs / 100)
  let body = groupIndian(String(whole))
  if (s.decimals === 2) {
    body += '.' + String(abs % 100).padStart(2, '0')
  }
  const sign = paise < 0 ? '-' : opts.signed && paise > 0 ? '+' : ''
  return sign + body
}

export function formatMoney(
  paise: number,
  s: Pick<Settings, 'decimals' | 'currencySymbol' | 'symbolBefore'>,
  opts: { signed?: boolean; hideSymbol?: boolean } = {},
): string {
  const body = formatAmount(paise, s, opts)
  if (opts.hideSymbol) return body
  const neg = body.startsWith('-') || body.startsWith('+')
  const sign = neg ? body[0] : ''
  const rest = neg ? body.slice(1) : body
  return s.symbolBefore
    ? `${sign}${s.currencySymbol} ${rest}`
    : `${sign}${rest} ${s.currencySymbol}`
}

/** Split an expression into numbers, operators and brackets. */
export function calcTokens(expr: string): string[] {
  return expr.match(/(\d+\.?\d*|[+\-*/()])/g) ?? []
}

/**
 * Evaluate a calculator expression: digits, `. + - * /` and brackets.
 *
 * A recursive-descent parser rather than the two-pass scan this used to be.
 * Two passes can express "× and ÷ bind tighter than + and −" but they cannot
 * express nesting, and brackets are the whole point of multi-step sums like
 * `(120*3)+(45*2)`.
 *
 * Deliberately forgiving, because it runs on every keystroke against a
 * half-typed sum: a trailing operator, an unclosed bracket or an empty pair
 * are all evaluated as far as they make sense instead of blowing up. Division
 * by zero yields 0 rather than Infinity, which is what the old version did and
 * what stops the running total flashing nonsense mid-entry.
 *
 * Returns paise — the rounding happens once, at the end, so intermediate
 * results keep full precision.
 */
export function evalExpression(expr: string): number {
  const tokens = calcTokens(expr)
  if (!tokens.length) return 0

  let i = 0
  const peek = () => tokens[i]

  // sum := product (('+' | '-') product)*
  const sum = (): number => {
    let acc = product()
    while (peek() === '+' || peek() === '-') {
      const op = tokens[i++]
      const rhs = product()
      acc = op === '+' ? acc + rhs : acc - rhs
    }
    return acc
  }

  // product := unary (('*' | '/') unary)*
  const product = (): number => {
    let acc = unary()
    while (peek() === '*' || peek() === '/') {
      const op = tokens[i++]
      const rhs = unary()
      acc = op === '*' ? acc * rhs : rhs === 0 ? 0 : acc / rhs
    }
    return acc
  }

  // unary := ('+' | '-')* atom — a leading sign is part of the number
  const unary = (): number => {
    let sign = 1
    while (peek() === '+' || peek() === '-') {
      if (tokens[i++] === '-') sign = -sign
    }
    return sign * atom()
  }

  // atom := number | '(' sum ')'
  const atom = (): number => {
    const t = peek()
    if (t === undefined) return 0 // half-typed sum: nothing left to read
    if (t === '(') {
      i++
      const inner = sum()
      if (peek() === ')') i++ // an unclosed bracket just ends here
      return inner
    }
    if (t === ')') return 0 // stray close; the caller will step over it
    i++
    const n = parseFloat(t)
    return isFinite(n) ? n : 0
  }

  const acc = sum()
  return isFinite(acc) ? Math.round(acc * 100) : 0
}

/**
 * How many brackets are still open, for the smart bracket key and for
 * indenting the tape. Never negative — a stray ')' is ignored rather than
 * pushing the count below zero.
 */
export function openBrackets(expr: string): number {
  let depth = 0
  for (const t of calcTokens(expr)) {
    if (t === '(') depth++
    else if (t === ')' && depth > 0) depth--
  }
  return depth
}
