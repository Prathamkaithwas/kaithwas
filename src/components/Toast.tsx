import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type ToastKind = 'success' | 'error'

interface ToastItem {
  id: string
  kind: ToastKind
  message: string
  /** Set just before removal, to run the exit animation — the item stays in
   *  the list for one more frame so `toast-out` has something to animate. */
  leaving?: boolean
}

const DURATION = 2600
const EXIT = 220

const ToastContext = createContext<{ push: (kind: ToastKind, message: string) => void } | null>(
  null,
)

/**
 * A brief pill at the top of the screen for something worth a beat of
 * acknowledgement — an entry saved, a habit checked off — that doesn't rise
 * to a haptic-only confirmation but also isn't worth interrupting for.
 *
 * Lives at the root (see App.tsx) rather than inside whichever screen
 * triggers one, because the screen that triggers a toast often closes
 * itself in the same action — TxEditor's own commit() calls onClose() right
 * after saving, and local state in an unmounting component would vanish
 * with it. A root-level stack outlives every screen under it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef(new Map<string, number>())

  const remove = useCallback((id: string) => {
    setItems((list) => list.filter((t) => t.id !== id))
    timers.current.delete(id)
  }, [])

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      setItems((list) => [...list, { id, kind, message }])
      const timer = window.setTimeout(() => {
        setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
        window.setTimeout(() => remove(id), EXIT)
      }, DURATION)
      timers.current.set(id, timer)
    },
    [remove],
  )

  useEffect(() => {
    const map = timers.current
    return () => map.forEach((t) => window.clearTimeout(t))
  }, [])

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" data-kind={t.kind} data-leaving={t.leaving || undefined}>
            <ToastGlyph kind={t.kind} />
            <span className="truncate">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastGlyph({ kind }: { kind: ToastKind }) {
  if (kind === 'success') {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
        aria-hidden
      >
        <path d="M5 13l4 4L19 7" />
      </svg>
    )
  }
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      className="shrink-0"
      aria-hidden
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** `success`/`error` rather than a single generic call — every call site
 *  already knows which one it means, and the colour/icon follow from that
 *  automatically instead of being picked by hand at each call site. */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return {
    success: (message: string) => ctx.push('success', message),
    error: (message: string) => ctx.push('error', message),
  }
}
