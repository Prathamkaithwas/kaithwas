import type { LucideIcon } from 'lucide-react'
import { hapticMedium } from '../lib/haptics'

export interface FanAction {
  key: string
  label: string
  icon: LucideIcon
  onPick: () => void
}

/**
 * The More tab's destination list: tap the tab to open it, tap a row to go
 * there. Purely presentational and self-contained — a row's own `onClick`
 * fires its action and closes the panel, so the trigger button only needs to
 * toggle `open`.
 */
export function FanFab({
  actions,
  open,
  onClose,
}: {
  actions: FanAction[]
  open: boolean
  onClose: () => void
}) {
  return (
    <>
      {open && <div className="fan-scrim" onClick={onClose} aria-hidden />}

      {/* Anchored to the centre of the third of three nav cells, as a
          percentage rather than a pixel offset, so it stays on the More tab
          at any screen width. */}
      <div className="fan-panel" data-open={open || undefined}>
        {actions.map((a) => (
          <button
            key={a.key}
            className="fan-row"
            onClick={() => {
              hapticMedium()
              a.onPick()
              onClose()
            }}
          >
            <span className="fan-row-icon">
              <a.icon size={20} strokeWidth={1.9} />
            </span>
            <span className="fan-row-label">{a.label}</span>
          </button>
        ))}
      </div>
    </>
  )
}
