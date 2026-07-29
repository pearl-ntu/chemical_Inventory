import QRCode from 'qrcode'

/**
 * The QR sticker encodes a deep link back into this app, so scanning a bottle
 * with any phone camera opens its record. The base URL is whatever the app is
 * currently served from, which keeps local, Pages, and self-hosted deployments
 * all working without configuration.
 */
function appUrl(path: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#${path}`
}

export function containerDeepLink(code: string): string {
  return appUrl(`/inventory?code=${encodeURIComponent(code)}`)
}

export function locationDeepLink(location: string): string {
  return appUrl(`/inventory?location=${encodeURIComponent(location)}`)
}

export function memberDeepLink(owner: string, openAdd = false): string {
  const params = new URLSearchParams({ owner })
  if (openAdd) params.set('add', '1')
  return appUrl(`/inventory?${params.toString()}`)
}

export async function qrDataUrl(value: string, size = 256): Promise<string> {
  return QRCode.toDataURL(value, {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#12151cff', light: '#ffffffff' },
  })
}
