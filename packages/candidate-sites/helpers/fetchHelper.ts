import { API_ROOT } from '@/appEnv'

export async function fetchHelper<T>(url: string, options: any = {}): Promise<T | null> {
  const resp = await fetch(`${API_ROOT}/${url}`, {
    ...options,
    body: options.body && typeof options.body === 'object' 
      ? JSON.stringify(options.body) 
      : options.body,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  return resp.ok ? (await resp.json()) as T : null
}