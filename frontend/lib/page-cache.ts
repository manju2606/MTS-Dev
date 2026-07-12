// Lightweight "show the last-known page instantly, then refresh in the
// background" cache -- localStorage-backed so it survives reloads/tab
// closes (unlike in-memory-only state, which resets on every hard
// refresh). Deliberately minimal: read the cached value synchronously
// before the first fetch, write the fresh value after every successful
// fetch. Not a general-purpose cache (no TTL/eviction) -- each page's own
// poll interval is what keeps it from going stale, same as before this
// existed; this only removes the blank-spinner flash on repeat visits.
const CACHE_PREFIX = 'mts_cache:'

export function readPageCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writePageCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data))
  } catch {
    // Quota exceeded / localStorage unavailable (private browsing, etc.)
    // -- the cache is a nice-to-have, not required for the page to work.
  }
}
