import type { OCRSize } from 'runonweb/ocr'

export type ModelSize = OCRSize

export const MODEL_SIZES: Array<{
  value: ModelSize
  label: string
  download: string
  hint: string
}> = [
  {
    value: 'tiny',
    label: 'Tiny',
    download: '~6 MB',
    hint: 'El més ràpid, per a fotos molt nítides.',
  },
  {
    value: 'small',
    label: 'Small',
    download: '~31 MB',
    hint: 'Equilibri recomanat entre qualitat i velocitat.',
  },
  {
    value: 'medium',
    label: 'Medium',
    download: '~139 MB',
    hint: 'Més precisió en tiquets tèrmics i fotos difícils.',
  },
]

export const MAX_PAGES_OPTIONS = [5, 10, 20]
export const MAX_SIDE_OPTIONS = [1800, 2400, 3200]
