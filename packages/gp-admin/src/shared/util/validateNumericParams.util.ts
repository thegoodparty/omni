import { notFound } from 'next/navigation'

export function validateNumericParams(...params: string[]): number[] {
  return params.map((value) => {
    const parsed = Number(value)
    if (Number.isNaN(parsed)) {
      notFound()
    }
    return parsed
  })
}
