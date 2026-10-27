import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { canvasToBlob } from './image'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type RenderedPdf = {
  pages: Array<{ page: number; blob: Blob; width: number; height: number }>
  totalPages: number
  truncated: boolean
}

export type PdfOptions = {
  maxSide?: number
  maxPages?: number
  onProgress?: (page: number, total: number) => void
}

/** Rasterize a PDF one page at a time so it can be fed to the OCR model. */
export async function renderPdf(file: File, options: PdfOptions = {}): Promise<RenderedPdf> {
  const maxSide = options.maxSide ?? 2400
  const maxPages = options.maxPages ?? 10
  const data = new Uint8Array(await file.arrayBuffer())

  let pdf: pdfjs.PDFDocumentProxy
  const task = pdfjs.getDocument({ data })
  try {
    pdf = await task.promise
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'PasswordException') {
      throw new Error('El PDF està protegit amb contrasenya.')
    }
    throw new Error('No s’ha pogut obrir el PDF. Comprova que no estigui malmès.')
  }

  const pages: RenderedPdf['pages'] = []
  const totalPages = pdf.numPages
  const limit = Math.min(totalPages, maxPages)

  try {
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      try {
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(
          3,
          Math.max(0.5, maxSide / Math.max(base.width, base.height)),
        )
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.ceil(viewport.width))
        canvas.height = Math.max(1, Math.ceil(viewport.height))
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error("No s'ha pogut preparar la pàgina del PDF.")
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, viewport }).promise
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.94)
        pages.push({
          page: pageNumber - 1,
          blob,
          width: canvas.width,
          height: canvas.height,
        })
        options.onProgress?.(pageNumber, limit)
      } finally {
        page.cleanup()
      }
    }
  } finally {
    await task.destroy()
  }

  return {
    pages,
    totalPages,
    truncated: totalPages > limit,
  }
}
