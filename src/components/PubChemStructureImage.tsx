import { useEffect, useMemo, useState } from 'react'
import * as pubchem from '../lib/pubchem'

export function PubChemStructureImage({
  cas,
  name,
  cid,
  size = 'large',
  className,
  alt = '',
  onExhausted,
}: {
  cas: string | null | undefined
  name: string | null | undefined
  cid?: number | null
  size?: 'small' | 'large'
  className?: string
  alt?: string
  onExhausted?: () => void
}) {
  const candidates = useMemo(() => {
    const urls = [
      cid ? pubchem.structureImageUrl(cid, size) : null,
      cas?.trim() ? pubchem.structureImageUrlForTerm(cas.trim(), size) : null,
      name?.trim() ? pubchem.structureImageUrlForTerm(name.trim(), size) : null,
    ].filter(Boolean) as string[]
    return [...new Set(urls)]
  }, [cas, cid, name, size])
  const [index, setIndex] = useState(0)

  useEffect(() => setIndex(0), [candidates.join('|')])

  const src = candidates[index]
  if (!src) return null

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => {
        if (index < candidates.length - 1) {
          setIndex((value) => value + 1)
        } else {
          onExhausted?.()
        }
      }}
    />
  )
}
