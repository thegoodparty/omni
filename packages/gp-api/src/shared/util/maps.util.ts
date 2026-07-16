export const mapToObject = <V>(map: Map<string, V>): Record<string, V> =>
  Object.fromEntries(map)
