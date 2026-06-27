'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import { getBrokerStatus, getZerodhaLoginUrl, connectZerodha, disconnectBroker, useSimulatedBroker } from '@/lib/api'
import type { BrokerStatus } from '@/lib/api'

export default function BrokerView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [status, setStatus] = useState<BrokerStatus | null>(null)
  const [requestToken, setRequestToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
    getBrokerStatus(t).then(setStatus).catch(() => null)
  }, [router])

  async function handleZerodhaLogin() {
    setLoading(true); setMsg(null)
    try {
      const { login_url } = await getZerodhaLoginUrl(tokenRef.current)
      window.open(login_url, '_blank')
      setMsg({ type: 'ok', text: 'Zerodha login opened. After logging in, paste the request_token below.' })
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Failed' })
    } finally { setLoading(false) }
  }

  async function handleConnect() {
    if (!requestToken.trim()) return
    setLoading(true); setMsg(null)
    try {
      const s = await connectZerodha(tokenRef.current, requestToken.trim())
      setStatus(s); setRequestToken('')
      setMsg({ type: 'ok', text: 'Connected to Zerodha successfully.' })
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Connection failed' })
    } finally { setLoading(false) }
  }

  async function handleSimulated() {
    setLoading(true); setMsg(null)
    try {
      const s = await useSimulatedBroker(tokenRef.current)
      setStatus(s)
      setMsg({ type: 'ok', text: 'Switched to simulated broker.' })
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Failed' })
    } finally { setLoading(false) }
  }

  async function handleDisconnect() {
    setLoading(true)
    try {
      const s = await disconnectBroker(tokenRef.current)
      setStatus(s)
      setMsg({ type: 'ok', text: 'Disconnected.' })
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  if (!authChecked) return null

  const isZerodha = status?.broker === 'zerodha'

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Broker" />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Broker Setup</h1>
        <p className="mb-8 text-xs text-zinc-400">
          Connect Zerodha Kite for live trading, or use the simulated broker for paper-like live execution.
        </p>

        {/* Current status */}
        <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Current Broker</p>
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${status?.connected ? 'bg-emerald-500' : 'bg-red-400'}`} />
            <span className="text-sm font-semibold capitalize text-zinc-900 dark:text-zinc-50">
              {status?.broker ?? '—'}
            </span>
            {status?.note && (
              <span className="text-xs text-zinc-400">{status.note}</span>
            )}
          </div>
        </div>

        {msg && (
          <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${msg.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300'}`}>
            {msg.text}
          </div>
        )}

        {/* Zerodha section */}
        <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Zerodha Kite</p>
          <p className="mb-4 text-xs text-zinc-400">
            Requires KITE_API_KEY and KITE_API_SECRET in backend/.env.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleZerodhaLogin}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              1. Open Zerodha Login
            </button>
            <div className="flex gap-2">
              <input
                value={requestToken}
                onChange={e => setRequestToken(e.target.value)}
                placeholder="Paste request_token from Kite redirect URL"
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                onClick={handleConnect}
                disabled={loading || !requestToken.trim()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                2. Connect
              </button>
            </div>
          </div>
        </div>

        {/* Simulated broker */}
        <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Simulated Broker</p>
          <p className="mb-4 text-xs text-zinc-400">
            Executes orders instantly at live yfinance price. No real money. Great for testing.
          </p>
          <button
            onClick={handleSimulated}
            disabled={loading}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 disabled:opacity-60"
          >
            Use Simulated Broker
          </button>
        </div>

        {isZerodha && (
          <button
            onClick={handleDisconnect}
            disabled={loading}
            className="text-xs text-red-500 hover:text-red-400"
          >
            Disconnect Zerodha
          </button>
        )}
      </main>
    </div>
  )
}
