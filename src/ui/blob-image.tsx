import { useEffect, useRef } from 'react'
import type { ComponentProps } from 'react'

export function BlobImage({
  blob,
  ...props
}: Omit<ComponentProps<'img'>, 'src' | 'ref'> & { blob: Blob }) {
  const element = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const image = element.current
    if (!image) return
    const url = URL.createObjectURL(blob)
    image.src = url
    return () => {
      image.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [blob])
  return <img {...props} ref={element} />
}
