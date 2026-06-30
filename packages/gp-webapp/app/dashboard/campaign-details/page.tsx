import { redirect } from 'next/navigation'

// The public profile moved to /dashboard/profile. Keep this route as a
// permanent redirect so existing links and bookmarks still resolve.
export default async function Page(): Promise<never> {
  redirect('/dashboard/profile')
}
