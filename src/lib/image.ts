export type PreparedImage = {
  blob: Blob
  url: string
  width: number
  height: number
  rotation: number
}

type LoadedImage = {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

async function loadImage(source: Blob): Promise<LoadedImage> {
  try {
    const bitmap = await createImageBitmap(source, {
      imageOrientation: 'from-image',
    })
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    }
  } catch {
    const url = URL.createObjectURL(source)
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = () => reject(new Error("No s'ha pogut llegir la imatge."))
        element.src = url
      })
      return {
        source: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        close: () => URL.revokeObjectURL(url),
      }
    } catch (error) {
      URL.revokeObjectURL(url)
      throw error
    }
  }
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/jpeg',
  quality = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("No s'ha pogut generar la imatge."))
      },
      type,
      quality,
    )
  })
}

export type PrepareOptions = {
  maxSide?: number
  rotation?: number
  enhance?: boolean
  upscale?: boolean
}

/**
 * Decode, orient, rotate, optionally enhance and downscale an image so OCR
 * receives a predictable, reasonably sized bitmap.
 */
export async function prepareImage(
  source: Blob,
  options: PrepareOptions = {},
): Promise<PreparedImage> {
  const maxSide = options.maxSide ?? 2400
  const rotation = ((options.rotation ?? 0) % 360 + 360) % 360
  const image = await loadImage(source)

  try {
    const longest = Math.max(image.width, image.height)
    if (!longest) throw new Error('La imatge no té dimensions.')

    const rawScale = maxSide / longest
    const scale = options.upscale
      ? Math.min(2, Math.max(0.2, rawScale))
      : Math.min(1, rawScale)

    const drawWidth = Math.max(1, Math.round(image.width * scale))
    const drawHeight = Math.max(1, Math.round(image.height * scale))
    const swaps = rotation === 90 || rotation === 270
    const width = swaps ? drawHeight : drawWidth
    const height = swaps ? drawWidth : drawHeight

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error("No s'ha pogut preparar el canvas.")

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.save()
    context.translate(width / 2, height / 2)
    context.rotate((rotation * Math.PI) / 180)
    if (options.enhance) {
      context.filter = 'grayscale(1) contrast(1.18)'
    }
    context.drawImage(image.source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
    context.restore()

    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92)
    return {
      blob,
      url: URL.createObjectURL(blob),
      width,
      height,
      rotation,
    }
  } finally {
    image.close()
  }
}

/** Small JPEG data URL used by the history list. */
export async function makeThumbnail(source: Blob, maxSide = 340): Promise<string> {
  const image = await loadImage(source)
  try {
    const longest = Math.max(image.width, image.height)
    const scale = Math.min(1, maxSide / Math.max(1, longest))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return ''
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image.source, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.76)
  } finally {
    image.close()
  }
}
