export type RangeCondition = {
  gte?: number
  lte?: number
}

export type FilterOperator = {
  operator: string
  values?: string[] | number[]
  value?: string | number
  gte?: number
  lte?: number
  includeNull?: boolean
  orRanges?: RangeCondition[]
}

export type TransformFiltersResult<T extends string> = {
  filters: T[]
  filterValues: Record<string, string[]>
  filterOperators: Record<string, FilterOperator>
}

export const transformFilters = <T extends string>(
  filters: Record<string, unknown>,
  schemaShape: Record<string, unknown>,
): TransformFiltersResult<T> => {
  const filterList: T[] = []
  const filterValues: Record<string, string[]> = {}
  const filterOperators: Record<string, FilterOperator> = {}

  for (const [key, value] of Object.entries(filters)) {
    if (!(key in schemaShape)) continue

    if (typeof value === 'boolean') {
      if (value === true) {
        filterList.push(key as T)
        filterOperators[key] = { operator: 'is', value: 'not_null' }
      } else if (value === false) {
        filterList.push(key as T)
        filterOperators[key] = { operator: 'is', value: 'null' }
        filterValues[key] = []
      }
    } else if (
      value &&
      typeof value === 'object' &&
      'in' in value &&
      Array.isArray(value.in) &&
      value.in.length > 0
    ) {
      const includeNull = '_includeNull' in value && value._includeNull === true
      filterList.push(key as T)
      filterValues[key] = value.in.map(String)
      filterOperators[key] = { operator: 'in', values: value.in, includeNull }
    } else if (
      value &&
      typeof value === 'object' &&
      'notIn' in value &&
      Array.isArray(value.notIn) &&
      value.notIn.length > 0
    ) {
      filterList.push(key as T)
      // id is not an enum field — filterValues drives text-based enum
      // mapping elsewhere in the pipeline, which notIn's uuid set has no use
      // for, so it is intentionally left unpopulated.
      filterOperators[key] = { operator: 'notIn', values: value.notIn }
    } else if (
      value &&
      typeof value === 'object' &&
      'eq' in value &&
      value.eq !== undefined &&
      value.eq !== null
    ) {
      filterList.push(key as T)
      const eqValue = value.eq as string | number
      filterValues[key] = [String(eqValue)]
      filterOperators[key] = { operator: 'eq', value: eqValue }
    } else if (
      value &&
      typeof value === 'object' &&
      'is' in value &&
      value.is
    ) {
      filterList.push(key as T)
      const isValue = value.is as 'not_null' | 'null'
      filterOperators[key] = { operator: 'is', value: isValue }
      if (isValue === 'null') {
        filterValues[key] = []
      }
    } else if (
      value &&
      typeof value === 'object' &&
      '_or' in value &&
      Array.isArray(value._or)
    ) {
      filterList.push(key as T)
      const includeNull = '_includeNull' in value && value._includeNull === true
      const orRanges = (value._or as Array<{ gte?: number; lte?: number }>).map(
        (range) => ({
          gte:
            range.gte !== undefined && range.gte !== null
              ? range.gte
              : undefined,
          lte:
            range.lte !== undefined && range.lte !== null
              ? range.lte
              : undefined,
        }),
      )
      filterOperators[key] = { operator: 'or', orRanges, includeNull }
    } else if (
      value &&
      typeof value === 'object' &&
      ('gte' in value || 'lte' in value)
    ) {
      filterList.push(key as T)
      const gteValue =
        'gte' in value && value.gte !== undefined && value.gte !== null
          ? (value.gte as number)
          : undefined
      const lteValue =
        'lte' in value && value.lte !== undefined && value.lte !== null
          ? (value.lte as number)
          : undefined
      const includeNull = '_includeNull' in value && value._includeNull === true

      if (gteValue !== undefined && lteValue !== undefined) {
        filterOperators[key] = {
          operator: 'range',
          gte: gteValue,
          lte: lteValue,
          includeNull,
        }
      } else if (gteValue !== undefined) {
        filterOperators[key] = { operator: 'gte', value: gteValue, includeNull }
      } else if (lteValue !== undefined) {
        filterOperators[key] = { operator: 'lte', value: lteValue, includeNull }
      }
    }
  }

  return { filters: filterList, filterValues, filterOperators }
}
