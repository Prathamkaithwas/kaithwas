/**
 * Handing one or more photos to another app.
 *
 * Same split as lib/backup.ts and for the same reason: inside Capacitor's
 * Android WebView there is no share sheet behind the web Share API worth
 * counting on, so natively this writes each photo to a temp file through the
 * Filesystem plugin first and shares the resulting file:// URIs. On the web
 * it goes through `navigator.share` directly, which is the only path a
 * browser actually offers.
 */

import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

export interface SharePhoto {
  title: string
  dataUrl: string
}

function extOf(dataUrl: string): string {
  if (dataUrl.startsWith('data:application/pdf')) return 'pdf'
  return dataUrl.startsWith('data:image/png') ? 'png' : 'jpg'
}

async function shareNative(photos: SharePhoto[]): Promise<boolean> {
  const uris: string[] = []
  for (let i = 0; i < photos.length; i++) {
    const { dataUrl } = photos[i]
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const path = `share-doc-${Date.now()}-${i}.${extOf(dataUrl)}`
    await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache })
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
    uris.push(uri)
  }
  await Share.share({ files: uris })
  return true
}

async function shareWeb(photos: SharePhoto[]): Promise<boolean> {
  const files = await Promise.all(
    photos.map(async (p, i) => {
      const blob = await (await fetch(p.dataUrl)).blob()
      return new File([blob], `${p.title || 'document'}-${i}.${extOf(p.dataUrl)}`, { type: blob.type })
    }),
  )
  if (!navigator.canShare?.({ files })) return false
  await navigator.share({ files })
  return true
}

/** True if it actually handed off to a share sheet; false if sharing isn't available here. */
export async function sharePhotos(photos: SharePhoto[]): Promise<boolean> {
  if (!photos.length) return false
  return Capacitor.isNativePlatform() ? shareNative(photos) : shareWeb(photos)
}
