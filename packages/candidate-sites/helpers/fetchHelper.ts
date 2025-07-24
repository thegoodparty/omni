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
  
  if (!resp.ok) {
    return null
  }
  
  // Check if response has content before trying to parse JSON
  const text = await resp.text()
  if (!text) {
    return null
  }
  
  try {
    return JSON.parse(text) as T
  } catch (error) {
    console.warn('Failed to parse JSON response:', error)
    return null
  }
}