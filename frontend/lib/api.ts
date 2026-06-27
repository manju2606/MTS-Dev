const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { detail?: string }).detail ?? 'Invalid email or password')
  }
  return res.json() as Promise<{ access_token: string; token_type: string }>
}

export async function getMe(token: string) {
  const res = await fetch(`${BASE}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Unauthorized')
  return res.json() as Promise<{ id: string; email: string; full_name: string; role: string }>
}
