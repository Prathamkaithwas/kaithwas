import { useEffect, useRef, useState } from 'react'
import { Sheet } from './ui'
import { hapticLight } from '../lib/haptics'

/**
 * Choose which part of a photo a card actually shows.
 *
 * Card backgrounds are wide, shallow crops of photos that are usually neither
 * — so `background-size: cover` was silently taking the middle band and
 * throwing away the part anyone actually pointed the camera at. Faces landed
 * half out of frame, and there was no way to say otherwise.
 *
 * The frame is the card's own shape, at the card's own aspect, so what is
 * inside it while dragging is exactly what appears on the card. Pan by
 * dragging, zoom on the slider or by pinching.
 *
 * The crop is baked into a new image rather than stored as a transform. It
 * keeps both card renderers as plain `background-image` with nothing to
 * interpret, and the stored file gets *smaller* rather than carrying pixels
 * that are never shown. The cost is that re-opening this adjusts the crop
 * rather than the original — so "Choose another photo" sits right here, for
 * when the wanted part was cropped away.
 */

/** Long edge of what gets written out. Twice the widest a card is ever drawn,
 *  so it stays sharp on a dense screen without storing a whole camera photo
 *  in the database for every card. */
const OUT_MAX = 900

export function PhotoCropper({
  src,
  aspect,
  onDone,
  onCancel,
  onPickAnother,
}: {
  src: string
  /** width / height of the card this will sit behind */
  aspect: number
  onDone: (dataUrl: string) => void
  onCancel: () => void
  onPickAnother?: () => void
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [ready, setReady] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // Live values for the drag, kept out of state so a drag does not re-render
  // per frame; state is only written when the gesture settles.
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setReady(true)
      setZoom(1)
      setPos({ x: 0, y: 0 })
    }
    img.src = src
  }, [src])

  const frame = () => frameRef.current?.getBoundingClientRect()

  /** The scale at which the photo exactly covers the frame — zoom 1. */
  const coverScale = (fw: number, fh: number) => {
    const img = imgRef.current
    if (!img) return 1
    return Math.max(fw / img.width, fh / img.height)
  }

  /** Keeps the photo covering the frame, so no gap can ever be dragged in. */
  const clamp = (p: { x: number; y: number }, z: number) => {
    const f = frame()
    const img = imgRef.current
    if (!f || !img) return p
    const s = coverScale(f.width, f.height) * z
    const w = img.width * s
    const h = img.height * s
    const maxX = Math.max(0, (w - f.width) / 2)
    const maxY = Math.max(0, (h - f.height) / 2)
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    }
  }

  const onZoom = (z: number) => {
    setZoom(z)
    setPos((p) => clamp(p, z))
  }

  const apply = () => {
    const f = frame()
    const img = imgRef.current
    if (!f || !img) return

    const s = coverScale(f.width, f.height) * zoom
    // Where the frame sits over the source image, in source pixels.
    const sw = f.width / s
    const sh = f.height / s
    const sx = (img.width - sw) / 2 - pos.x / s
    const sy = (img.height - sh) / 2 - pos.y / s

    const outW = Math.min(OUT_MAX, Math.round(sw))
    const outH = Math.round(outW / aspect)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, outW)
    canvas.height = Math.max(1, outH)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    hapticLight()
    onDone(canvas.toDataURL('image/jpeg', 0.86))
  }

  const img = imgRef.current
  const f = frame()
  const s = f && img ? coverScale(f.width, f.height) * zoom : 1

  return (
    <Sheet open onClose={onCancel} title="Adjust the photo">
      <div className="p-4 space-y-4">
        <div className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Drag to move, pinch or use the slider to zoom. What you see in the
          frame is what the card shows.
        </div>

        <div
          ref={frameRef}
          className="crop-frame"
          style={{ aspectRatio: String(aspect) }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            setPos(clamp({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }, zoom))
          }}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
          // Pinch, for the hand that reaches for it before finding the slider.
          onTouchStart={(e) => {
            if (e.touches.length !== 2) return
            const [a, b] = [e.touches[0], e.touches[1]]
            pinch.current = {
              dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
              zoom,
            }
            drag.current = null
          }}
          onTouchMove={(e) => {
            const p = pinch.current
            if (!p || e.touches.length !== 2) return
            const [a, b] = [e.touches[0], e.touches[1]]
            const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
            onZoom(Math.max(1, Math.min(4, (p.zoom * dist) / p.dist)))
          }}
          onTouchEnd={() => {
            pinch.current = null
          }}
        >
          {ready && img && (
            <img
              src={src}
              alt=""
              draggable={false}
              className="crop-img"
              style={{
                width: img.width * s,
                height: img.height * s,
                transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`,
              }}
            />
          )}
        </div>

        <label className="crop-zoom">
          <span className="crop-zoom-l">Zoom</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => onZoom(Number(e.target.value))}
          />
        </label>

        <div className="flex gap-2">
          {onPickAnother && (
            <button
              className="flex-1 py-3 rounded-lg text-[14px] font-semibold"
              style={{ background: 'var(--bg)', color: 'var(--text)' }}
              onClick={onPickAnother}
            >
              Another photo
            </button>
          )}
          <button
            className="flex-1 py-3 rounded-lg text-white text-[14px] font-semibold"
            style={{ background: 'var(--accent)' }}
            disabled={!ready}
            onClick={apply}
          >
            Use this
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/**
 * The two card shapes this crops for, measured from the rendered cards
 * rather than guessed — a frame that is not the card's real shape shows you
 * one thing and saves another.
 */
export const NOTE_CARD_ASPECT = 3.84
export const HABIT_TILE_ASPECT = 1.64
