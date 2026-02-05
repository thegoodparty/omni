'use client'

import { Badge } from '@radix-ui/themes'
import { formatDate } from '@/lib/utils/date'
import { DataRow } from './DataRow'
import type { FieldConfig } from '../types/field-config'
import { getNestedValue } from '../types/field-config'

interface FieldListProps {
  data: unknown
  fields: FieldConfig[]
}

export function FieldList({ data, fields }: FieldListProps) {
  return (
    <>
      {fields.map((field) => (
        <FieldRenderer key={field.key} data={data} field={field} />
      ))}
    </>
  )
}

interface FieldRendererProps {
  data: unknown
  field: FieldConfig
}

function FieldRenderer({ data, field }: FieldRendererProps) {
  const value = getNestedValue(data, field.key)

  switch (field.type) {
    case 'text':
      return (
        <DataRow label={field.label}>
          {value != null ? String(value) : field.fallback}
        </DataRow>
      )

    case 'date':
      return (
        <DataRow label={field.label}>
          {value ? formatDate(String(value)) : field.fallback}
        </DataRow>
      )

    case 'boolean': {
      const isTrue = Boolean(value)
      return (
        <DataRow label={field.label}>
          <Badge
            color={
              isTrue
                ? (field.trueBadgeColor ?? 'green')
                : (field.falseBadgeColor ?? 'gray')
            }
            variant="soft"
          >
            {isTrue ? 'Yes' : 'No'}
          </Badge>
        </DataRow>
      )
    }

    case 'badge': {
      const stringValue = value != null ? String(value) : ''
      const color =
        field.colorMap?.[stringValue] ??
        field.badgeColor ??
        field.defaultColor ??
        'blue'
      return (
        <DataRow label={field.label}>
          <Badge color={color} variant="soft">
            {stringValue || (field.fallback ?? 'Not set')}
          </Badge>
        </DataRow>
      )
    }

    default:
      return null
  }
}
