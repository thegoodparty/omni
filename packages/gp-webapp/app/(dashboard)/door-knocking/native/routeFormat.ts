// The routing vendor returns metres; every canvasser reading a route is in
// the US. Shared so the walk view and the printable sheet can't drift on the
// unit or the rounding.
export const formatDistance = (meters: number): string =>
  `${(meters / 1609.344).toFixed(1)} mi`
