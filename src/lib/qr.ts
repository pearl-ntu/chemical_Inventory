import QRCode from 'qrcode'

/**
 * The QR sticker encodes a deep link back into this app, so scanning a bottle
 * with any phone camera opens its record. The base URL is whatever the app is
 * currently served from, which keeps local, Pages, and self-hosted deployments
 * all working without configuration.
 */
export function deepLink(code: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/inventory?code=${encodeURIComponent(code)}`
}

export async function qrDataUrl(code: string, size = 256): Promise<string> {
  return QRCode.toDataURL(deepLink(code), {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#12151cff', light: '#ffffffff' },
  })
}
