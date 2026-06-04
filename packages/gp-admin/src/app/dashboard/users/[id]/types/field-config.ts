export type FieldType = 'text' | 'date' | 'boolean' | 'badge'

export type BadgeColor =
  | 'blue'
  | 'green'
  | 'gray'
  | 'orange'
  | 'iris'
  | 'violet'
  | 'amber'
  | 'red'

export interface FieldConfig {
  key: string
  label: string
  type: FieldType
  badgeColor?: BadgeColor
  trueBadgeColor?: BadgeColor
  falseBadgeColor?: BadgeColor
  fallback?: string
  colorMap?: Record<string, BadgeColor>
  defaultColor?: BadgeColor
}

export interface CardConfig {
  title: string
  fields: FieldConfig[]
}

export function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}
