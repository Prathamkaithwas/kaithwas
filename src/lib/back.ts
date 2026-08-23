/**
 * Android back-button handling.
 *
 * Back must unwind exactly one level per press:
 *
 *   overlay (keypad → picker → sheet → editor → search)
 *     → a non-default tab returns to Transactions
 *       → only then exit, and only on a second press within ~2s
 *
 * Quitting the app straight from an open editor loses whatever was being
 * typed, so that must never happen.
 *
 * Rather than have the shell know about every overlay in the app — including
 * the ones nested inside the transaction editor — anything that can be backed
 * out of registers a handler while it is open. The most recently registered
 * one wins, which for React's mount order is the innermost, so a keypad opened
 * on top of the editor closes before the editor does.
 */

import { useEffect, useRef } from 'react'

type BackHandler = () => void

const stack: { run: BackHandler }[] = []

/** Register a handler for as long as `active` is true. */
export function useBackHandler(active: boolean, fn: BackHandler): void {
  // The handler usually closes over state that changes every render, but
  // re-registering would reorder the stack and break nesting. So the stack
  // holds a stable entry that reads the latest closure through this ref.
  const latest = useRef(fn)
  latest.current = fn

  useEffect(() => {
    if (!active) return
    const entry = { run: () => latest.current() }
    stack.push(entry)
    return () => {
      const i = stack.lastIndexOf(entry)
      if (i !== -1) stack.splice(i, 1)
    }
  }, [active])
}

/** Runs the innermost handler. Returns false when nothing was open. */
export function popBackHandler(): boolean {
  const entry = stack[stack.length - 1]
  if (!entry) return false
  entry.run()
  return true
}

export function hasBackHandler(): boolean {
  return stack.length > 0
}
