import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FieldList } from './FieldList'
import type { FieldConfig } from '../types/field-config'

describe('FieldList', () => {
  it('returns null for unknown field type', () => {
    const fields = [
      { key: 'foo', label: 'Foo', type: 'unknown' },
    ] as unknown as FieldConfig[]

    const { container } = render(
      <FieldList data={{ foo: 'bar' }} fields={fields} />
    )

    expect(container.innerHTML).toBe('')
  })

  it('renders boolean with default green trueBadgeColor', () => {
    const fields: FieldConfig[] = [
      { key: 'active', label: 'Active', type: 'boolean' },
    ]

    render(<FieldList data={{ active: true }} fields={fields} />)

    expect(screen.getByText('Yes')).toBeInTheDocument()
  })

  it('renders boolean with custom falseBadgeColor', () => {
    const fields: FieldConfig[] = [
      {
        key: 'active',
        label: 'Active',
        type: 'boolean',
        falseBadgeColor: 'red',
      },
    ]

    render(<FieldList data={{ active: false }} fields={fields} />)

    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('renders badge with fallback "Not set" when value and fallback are missing', () => {
    const fields: FieldConfig[] = [
      { key: 'status', label: 'Status', type: 'badge' },
    ]

    render(<FieldList data={{}} fields={fields} />)

    expect(screen.getByText('Not set')).toBeInTheDocument()
  })

  it('renders badge falling through to default blue color', () => {
    const fields: FieldConfig[] = [
      { key: 'tier', label: 'Tier', type: 'badge' },
    ]

    render(<FieldList data={{ tier: 'Gold' }} fields={fields} />)

    expect(screen.getByText('Gold')).toBeInTheDocument()
  })
})
