import { del, entries, set } from 'idb-keyval'
import type { ExtractedInvoice, OCRLine } from './extract'

export type HistoryPreview = {
  page: number
  width: number
  height: number
  text: string
  lines: OCRLine[]
  confidence: number
}

export type HistoryEntry = {
  id: string
  name: string
  createdAt: number
  thumbnail: string
  sourceKind: 'image' | 'pdf'
  invoice: ExtractedInvoice
  preview: HistoryPreview | null
}

const PREFIX = 'factura-ocr:'
const MAX_ENTRIES = 80

export async function listHistory(): Promise<HistoryEntry[]> {
  const all = await entries<string, HistoryEntry>()
  return all
    .filter(([key]) => typeof key === 'string' && key.startsWith(PREFIX))
    .map(([, value]) => value)
    .filter((value): value is HistoryEntry => Boolean(value))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveHistory(entry: HistoryEntry): Promise<void> {
  await set(`${PREFIX}${entry.id}`, entry)
  await pruneHistory()
}

export async function deleteHistory(id: string): Promise<void> {
  await del(`${PREFIX}${id}`)
}

export async function clearHistory(): Promise<void> {
  const all = await listHistory()
  await Promise.all(all.map((entry) => deleteHistory(entry.id)))
}

async function pruneHistory(): Promise<void> {
  const all = await listHistory()
  if (all.length <= MAX_ENTRIES) return
  await Promise.all(all.slice(MAX_ENTRIES).map((entry) => deleteHistory(entry.id)))
}
