export default function getModalHref(
  pathname: string,
  searchParams: string,
  queryKey: string,
) {
  const params = new URLSearchParams(searchParams)
  params.set(queryKey, 'true')
  const query = params.toString()

  return query ? `${pathname}?${query}` : pathname
}
