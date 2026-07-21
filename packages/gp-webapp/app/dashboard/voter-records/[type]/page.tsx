import { redirect } from 'next/navigation'

// The legacy per-type voter-file detail page was replaced by the
// People-API-backed Contacts experience; this stub keeps old bookmarks and
// stale links working.
export default function Page() {
  redirect('/dashboard/contacts')
}
