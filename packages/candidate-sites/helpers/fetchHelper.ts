import { API_ROOT } from '@/appEnv'

export async function fetchHelper<T>(url: string): Promise<T | null> {
  const resp = await fetch(`${API_ROOT}/${url}`)
  return resp.ok ? (await resp.json()) as T : null
}