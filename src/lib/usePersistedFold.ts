import { useState } from 'react'

/**
 * Which categories/groups are folded shut, kept across app restarts.
 *
 * Component state alone survives navigating within the app but not closing
 * and reopening it — every fold in the app (Kitee's categories, Documents'
 * groups) used to reset to fully-open on a fresh launch, which is the
 * opposite of what collapsing something is for. Backed by localStorage
 * (not the main `db` blob) since it's pure UI layout, not data worth a
 * backup slot.
 *
 * Restoring synchronously in the initializer, not a post-mount effect,
 * mirrors the fix already applied to the calculator's draft persistence —
 * see TxEditor.tsx.
 */
export function usePersistedFold(key: string): [Set<string>, (cat: string) => void] {
  const storageKey = `fold:${key}`
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })

  const toggle = (cat: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]))
      } catch {
        /* storage full or blocked — the fold still works for this session */
      }
      return next
    })

  return [collapsed, toggle]
}
