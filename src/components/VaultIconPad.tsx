import { Heart, Star, Sun, Moon, Leaf, Anchor, Camera, Music2, Umbrella, type LucideIcon } from 'lucide-react'
import { LOCK_ICON_IDS, type LockIconId } from '../lib/vaultConst'

/** Which glyph each id in LOCK_ICON_IDS (vaultConst.ts) actually draws.
 *  Shared between the real lock screen (Authentication.tsx) and the
 *  change-lock flow in More.tsx, so the two can never drift apart into
 *  showing different icons for the same id. */
export const LOCK_ICON_MAP: Record<LockIconId, LucideIcon> = {
  heart: Heart,
  star: Star,
  sun: Sun,
  moon: Moon,
  leaf: Leaf,
  anchor: Anchor,
  camera: Camera,
  music: Music2,
  umbrella: Umbrella,
}

/** The four-cell progress readout — blank cells, not the icons themselves.
 *  The whole point of tapping icons instead of typing a PIN into a field in
 *  full view is lost if the readout then displays exactly which four were
 *  tapped for anyone glancing at it instead of the grid. */
export function VaultPinCells({ length, filled }: { length: number; filled: number }) {
  return (
    <div className="vault-pin">
      {Array.from({ length }, (_, i) => (
        <span key={i} className="vault-pin-cell" data-on={i < filled || undefined} />
      ))}
    </div>
  )
}

/** The 3-column icon grid plus backspace, shared by every place a sequence
 *  gets tapped in — unlocking, first-run provisioning, and the change-lock
 *  flow in More.tsx. Pure display; the sequence itself lives in whichever
 *  parent is driving it. */
export function VaultIconPad({
  onPick,
  onBackspace,
  disabled,
}: {
  onPick: (id: LockIconId) => void
  onBackspace: () => void
  disabled?: boolean
}) {
  return (
    <div className="vault-keys">
      {LOCK_ICON_IDS.map((id) => {
        const Icon = LOCK_ICON_MAP[id]
        return (
          <button key={id} className="vault-key" aria-label={id} disabled={disabled} onClick={() => onPick(id)}>
            <Icon size={22} strokeWidth={2} />
          </button>
        )
      })}
      {/* Blank either side of backspace, not a disabled key — rendered as a
          button it still picked up the global disabled styling and sat
          there looking like a control you were being refused. */}
      <span aria-hidden />
      <button className="vault-key" disabled={disabled} onClick={onBackspace} aria-label="Backspace">
        ⌫
      </button>
      <span aria-hidden />
    </div>
  )
}
