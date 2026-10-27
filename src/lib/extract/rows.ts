import type { FlatLine, PageOCR, Row, RowsResult } from './types'
import { cleanText } from './normalize'

function centerY(line: { box: { ymin: number; ymax: number } }): number {
  return (line.box.ymin + line.box.ymax) / 2
}

function median(values: number[]): number {
  if (!values.length) return 16
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 16
}

/**
 * Flatten pages and group OCR lines into visual rows. OCR often splits a label
 * and its value into separate lines; rows let us pair them back together.
 */
export function buildRows(pages: PageOCR[]): RowsResult {
  const lines: FlatLine[] = []
  pages.forEach((page, pageIndex) => {
    page.lines.forEach((line) => {
      lines.push({
        ...line,
        text: cleanText(line.text),
        page: pageIndex,
        index: lines.length,
        row: -1,
      })
    })
  })

  const medianHeight = median(
    lines
      .map((line) => line.box.ymax - line.box.ymin)
      .filter((height) => height > 1),
  )
  const tolerance = Math.max(5, medianHeight * 0.55)
  const rows: Row[] = []

  for (let page = 0; page < pages.length; page += 1) {
    const pageLines = lines
      .filter((line) => line.page === page)
      .sort((a, b) => centerY(a) - centerY(b))

    let bucket: FlatLine[] = []
    let bucketCenter = 0

    const flush = () => {
      if (!bucket.length) return
      const sorted = [...bucket].sort((a, b) => a.box.xmin - b.box.xmin)
      const index = rows.length
      sorted.forEach((line) => {
        line.row = index
      })
      rows.push({
        index,
        page,
        lines: sorted,
        text: sorted.map((line) => line.text).join(' ').trim(),
        centerY:
          sorted.reduce((sum, line) => sum + centerY(line), 0) / sorted.length,
        height: Math.max(...sorted.map((line) => line.box.ymax - line.box.ymin)),
      })
      bucket = []
    }

    for (const line of pageLines) {
      const cy = centerY(line)
      if (!bucket.length) {
        bucket = [line]
        bucketCenter = cy
        continue
      }
      if (Math.abs(cy - bucketCenter) <= tolerance) {
        bucket.push(line)
        bucketCenter =
          bucket.reduce((sum, item) => sum + centerY(item), 0) / bucket.length
      } else {
        flush()
        bucket = [line]
        bucketCenter = cy
      }
    }
    flush()
  }

  return { lines, rows, medianHeight }
}

/** Text of a row plus the rows above it on the same page. */
export function rowContextAbove(rows: Row[], rowIndex: number, radius = 1): string {
  const row = rows[rowIndex]
  if (!row) return ''
  const start = Math.max(0, rowIndex - radius)
  const parts: string[] = []
  for (let index = start; index <= rowIndex; index += 1) {
    const candidate = rows[index]
    if (!candidate || candidate.page !== row.page) continue
    parts.push(candidate.text)
  }
  return parts.join(' ')
}

/** Text of a row plus its neighbours on the same page. */
export function rowContext(rows: Row[], rowIndex: number, radius = 1): string {
  const row = rows[rowIndex]
  if (!row) return ''
  const start = Math.max(0, rowIndex - radius)
  const end = Math.min(rows.length - 1, rowIndex + radius)
  const parts: string[] = []
  for (let index = start; index <= end; index += 1) {
    const candidate = rows[index]
    if (!candidate || candidate.page !== row.page) continue
    parts.push(candidate.text)
  }
  return parts.join(' ')
}

export function rowAbove(rows: Row[], rowIndex: number): Row | undefined {
  const row = rows[rowIndex]
  if (!row) return undefined
  const previous = rows[rowIndex - 1]
  return previous && previous.page === row.page ? previous : undefined
}

export function rowBelow(rows: Row[], rowIndex: number): Row | undefined {
  const row = rows[rowIndex]
  if (!row) return undefined
  const next = rows[rowIndex + 1]
  return next && next.page === row.page ? next : undefined
}
