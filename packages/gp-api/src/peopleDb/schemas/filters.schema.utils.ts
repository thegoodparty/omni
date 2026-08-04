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

  // `key` is validated at runtime against schemaShape (the `key in
  // schemaShape` check above), but TS can't narrow a Record's string key to
  // a subtype of T's constraint, so the cast is unavoidable here.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const asFilterKey = (key: string): T => key as T

  for (const [key, value] of Object.entries(filters)) {
    if (!(key in schemaShape)) continue

    if (typeof value === 'boolean') {
      if (value === true) {
        filterList.push(asFilterKey(key))
        filterOperators[key] = { operator: 'is', value: 'not_null' }
      } else if (value === false) {
        filterList.push(asFilterKey(key))
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
      filterList.push(asFilterKey(key))
      filterValues[key] = value.in.map(String)
      filterOperators[key] = { operator: 'in', values: value.in, includeNull }
    } else if (
      value &&
      typeof value === 'object' &&
      'notIn' in value &&
      Array.isArray(value.notIn) &&
      value.notIn.length > 0
    ) {
      filterList.push(asFilterKey(key))
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
      filterList.push(asFilterKey(key))
      // Narrowed by the `eq !== undefined && eq !== null` check above; the
      // schema constrains `eq` to string | number but `in` doesn't narrow it.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const eqValue = value.eq as string | number
      filterValues[key] = [String(eqValue)]
      filterOperators[key] = { operator: 'eq', value: eqValue }
    } else if (
      value &&
      typeof value === 'object' &&
      'is' in value &&
      value.is
    ) {
      filterList.push(asFilterKey(key))
      // The schema constrains `is` to 'not_null' | 'null'; `in`/truthy checks
      // above don't narrow the property's type.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
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
      filterList.push(asFilterKey(key))
      const includeNull = '_includeNull' in value && value._includeNull === true
      // The schema shape constrains `_or` entries to { gte?, lte? }; the
      // `Array.isArray` check above only confirms it's an array, not its
      // element shape.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
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
      filterList.push(asFilterKey(key))
      const gteValue =
        'gte' in value && value.gte !== undefined && value.gte !== null
          ? // The schema constrains `gte` to number; the `in`/nullish checks
            // above don't narrow the property's type.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            (value.gte as number)
          : undefined
      const lteValue =
        'lte' in value && value.lte !== undefined && value.lte !== null
          ? // Same as gteValue above — schema-constrained, not TS-narrowed.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            (value.lte as number)
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
