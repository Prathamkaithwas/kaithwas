import { useState } from 'react'
import type { Supplier } from '../types'
import { useStore } from '../store'
import { Empty, Sheet } from '../components/ui'
import { HoldConfirm } from '../components/HoldConfirm'

/**
 * The supplier directory behind Khushi's own header icon — a phone number
 * and whatever's worth remembering about each one, kept apart from
 * PurchaseItem.supplier (a plain typed name on a rate) the way an address
 * book is kept apart from the envelopes it gets used to address. See the
 * comment on the Supplier type itself for the fuller reasoning.
 */
export function SuppliersSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db } = useStore()
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const suppliers = [...db.suppliers].sort((a, b) => a.order - b.order)

  return (
    <Sheet open={open} onClose={onClose} title="Suppliers" full>
      <div className="p-4 space-y-3">
        <button
          className="w-full py-2.5 rounded-lg text-[13px] font-semibold"
          style={{ border: '1.5px dashed var(--accent)', color: 'var(--accent)' }}
          onClick={() => setEditing('new')}
        >
          + Add supplier
        </button>

        {suppliers.length === 0 && (
          <Empty text="No suppliers saved yet — their number and anything worth remembering about them, in one place" />
        )}

        <div className="space-y-2">
          {suppliers.map((s) => (
            <SupplierRow key={s.id} supplier={s} onOpen={() => setEditing(s)} />
          ))}
        </div>
      </div>

      {editing && (
        <SupplierEditor
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Sheet>
  )
}

function SupplierRow({ supplier, onOpen }: { supplier: Supplier; onOpen: () => void }) {
  return (
    <button
      className="w-full text-left px-4 py-3 rounded-lg flex items-center gap-3"
      style={{ background: 'var(--surface-2)' }}
      onClick={onOpen}
    >
      <span
        className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-[14px] font-semibold"
        style={{ background: 'var(--bg)', color: 'var(--muted)' }}
        aria-hidden
      >
        {supplier.name.trim().charAt(0).toUpperCase() || '?'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] truncate">{supplier.name}</span>
        {(supplier.phone || supplier.notes) && (
          <span className="block text-[12px] truncate" style={{ color: 'var(--muted)' }}>
            {[supplier.phone, supplier.notes].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      {/* A tap here calls without opening the editor first — the number is
          the one thing about a supplier that's worth reaching without an
          extra tap in between. stopPropagation keeps it from also opening
          the row underneath it. */}
      {supplier.phone && (
        <a
          href={`tel:${supplier.phone}`}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Call ${supplier.name}`}
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--bg)', color: 'var(--accent)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </a>
      )}
    </button>
  )
}

function SupplierEditor({
  supplier,
  onClose,
}: {
  supplier: Supplier | null
  onClose: () => void
}) {
  const { addSupplier, updateSupplier, deleteSupplier } = useStore()
  const [name, setName] = useState(supplier?.name ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [notes, setNotes] = useState(supplier?.notes ?? '')

  const save = () => {
    if (!name.trim()) return
    const payload = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
    }
    if (supplier) updateSupplier({ ...supplier, ...payload })
    else addSupplier(payload)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={supplier ? 'Edit supplier' : 'New supplier'}>
      <div className="p-4 space-y-4">
        <input
          className="w-full border-b pb-2 text-[16px]"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <input
          className="w-full border-b pb-2 text-[15px] num"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          placeholder="Phone number"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <textarea
          className="w-full text-[14px] resize-none border-b pb-2"
          style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
          rows={4}
          placeholder="Terms, what they carry, anything worth remembering"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex items-center gap-2 pt-2">
          {supplier && (
            <>
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                hold to delete
              </span>
              <HoldConfirm
                label="Delete supplier"
                onConfirm={() => {
                  deleteSupplier(supplier.id)
                  onClose()
                }}
              />
            </>
          )}
          <span className="flex-1" />
          <button
            className="flex-1 py-3 rounded-lg text-white text-[14px] font-semibold"
            style={{ background: 'var(--accent)' }}
            disabled={!name.trim()}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </Sheet>
  )
}
