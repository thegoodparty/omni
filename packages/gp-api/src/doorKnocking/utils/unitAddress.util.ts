// The unit key renders back to a human address line: street parts joined in
// display order, apartment suffixed. Old line-format keys (a single
// AddressLine first segment) degrade gracefully to that segment.
//
// Shared by the route serve and the draw-step address preview rather than
// written twice: the two surfaces name the same physical door, and a
// candidate who previews "1200 W Elm St Apt 3B" and then walks a list
// spelling it differently has been given two addresses for one house.
export const renderUnitAddress = (addressKey: string): string => {
  const parts = addressKey.split('|')
  if (parts.length < 7) return parts[0] ?? addressKey
  const [house, prefixDir, street, designator, suffixDir, apartment] = parts
  const line = [house, prefixDir, street, designator, suffixDir]
    .filter((part) => part && part.length > 0)
    .join(' ')
  return apartment && apartment.length > 0 ? `${line} Apt ${apartment}` : line
}
