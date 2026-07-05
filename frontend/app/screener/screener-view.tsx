'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  getScreenerMeta, runScreen, listSavedScreens, saveScreen, deleteSavedScreen,
} from '@/lib/api'
import type { ScreenerMeta, ScreenResult, ScreenerCriterion, SavedScreen } from '@/lib/api'

const FIELD_LABELS: Record<string, string> = {
  rsi: 'RSI (14)', macd_hist: 'MACD Histogram', sma20_ratio: 'vs SMA20 %',
  sma50_ratio: 'vs SMA50 %', volume_ratio: 'Volume Ratio', change_pct: 'Day Change %',
  atr_pct: 'ATR %', pe_ratio: 'P/E Ratio', pb_ratio: 'P/B Ratio',
  market_cap_cr: 'Market Cap (Cr)', dividend_yield: 'Dividend Yield %',
  roe: 'ROE %', debt_to_equity: 'Debt/Equity', revenue_growth: 'Revenue Growth %',
}

const UNIVERSE_LABELS: Record<string, string> = {
  nifty50: 'Nifty 50', nifty100: 'Nifty 100',
  niftymidcap150: 'Nifty Midcap 150', niftysmallcap250: 'Nifty Smallcap 250',
}

function pnlCls(v: number) {
  return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-500 dark:text-red-400' : 'text-zinc-400'
}

// ── Criterion row ─────────────────────────────────────────────────────────────
function CriterionRow({ c, fields, operators, onChange, onRemove }: {
  c: ScreenerCriterion; fields: string[]; operators: string[]
  onChange: (c: ScreenerCriterion) => void; onRemove: () => void
}) {
  const sel = 'rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={c.field} onChange={e => onChange({ ...c, field: e.target.value })} className={sel}>
        {fields.map(f => <option key={f} value={f}>{FIELD_LABELS[f] ?? f}</option>)}
      </select>
      <select value={c.operator} onChange={e => onChange({ ...c, operator: e.target.value })} className={sel}>
        {operators.map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input
        type="number" value={c.value}
        onChange={e => onChange({ ...c, value: parseFloat(e.target.value) || 0 })}
        className="w-24 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
      />
      <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-600">Remove</button>
    </div>
  )
}

// ── Result table ──────────────────────────────────────────────────────────────
function ResultsTable({ results }: { results: ScreenResult[] }) {
  if (!results.length) return (
    <div className="rounded-xl border border-zinc-200 bg-white py-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm text-zinc-500">No stocks matched your criteria.</p>
      <p className="mt-1 text-xs text-zinc-400">Try relaxing the conditions.</p>
    </div>
  )

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            {['Symbol', 'Price', 'Chg%', 'RSI', 'MACD', 'vs SMA20', 'vs SMA50', 'Vol Ratio', 'P/E', 'P/B', 'MCap (Cr)'].map(h => (
              <th key={h} className="px-3 py-2.5 text-left font-medium text-zinc-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={r.symbol} className="border-b border-zinc-50 hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
              <td className="px-3 py-2">
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">{r.symbol.replace(/\.(NS|BO)$/, '')}</p>
                <p className="text-[10px] text-zinc-400 truncate max-w-[100px]">{r.name}</p>
              </td>
              <td className="px-3 py-2 font-mono font-semibold text-zinc-800 dark:text-zinc-200">₹{r.price.toLocaleString('en-IN')}</td>
              <td className={`px-3 py-2 font-mono font-semibold ${pnlCls(r.change_pct)}`}>{r.change_pct > 0 ? '+' : ''}{r.change_pct.toFixed(2)}%</td>
              <td className={`px-3 py-2 font-mono ${r.rsi > 70 ? 'text-red-500' : r.rsi < 30 ? 'text-emerald-600' : 'text-zinc-600 dark:text-zinc-300'}`}>{r.rsi.toFixed(1)}</td>
              <td className={`px-3 py-2 font-mono ${pnlCls(r.macd_hist)}`}>{r.macd_hist.toFixed(2)}</td>
              <td className={`px-3 py-2 font-mono ${pnlCls(r.sma20_ratio)}`}>{r.sma20_ratio > 0 ? '+' : ''}{r.sma20_ratio.toFixed(2)}%</td>
              <td className={`px-3 py-2 font-mono ${pnlCls(r.sma50_ratio)}`}>{r.sma50_ratio > 0 ? '+' : ''}{r.sma50_ratio.toFixed(2)}%</td>
              <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-300">{r.volume_ratio.toFixed(2)}x</td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{r.pe_ratio ?? '—'}</td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{r.pb_ratio ?? '—'}</td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{r.market_cap_cr ? (r.market_cap_cr / 100).toFixed(0) + 'K' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function ScreenerView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [meta, setMeta] = useState<ScreenerMeta | null>(null)
  const [universe, setUniverse] = useState('nifty50')
  const [criteria, setCriteria] = useState<ScreenerCriterion[]>([
    { field: 'rsi', operator: '<', value: 40 },
    { field: 'sma50_ratio', operator: '>', value: -5 },
  ])
  const [limit, setLimit] = useState(20)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ total_scanned: number; matches: number; results: ScreenResult[] } | null>(null)
  const [savedScreens, setSavedScreens] = useState<SavedScreen[]>([])
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  const loadSaved = useCallback(async (t: string) => {
    const list = await listSavedScreens(t).catch(() => [])
    setSavedScreens(list)
  }, [])

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    setAuthChecked(true)
    getScreenerMeta(t).then(setMeta).catch(() => {})
    loadSaved(t)
  }, [router, loadSaved])

  async function handleRun() {
    setRunning(true); setResult(null)
    try {
      const data = await runScreen(tokenRef.current, { universe, criteria, limit })
      setResult(data)
    } catch (e) { console.error(e) }
    finally { setRunning(false) }
  }

  async function handleSave() {
    if (!saveName.trim()) return
    setSaving(true)
    try {
      await saveScreen(tokenRef.current, { name: saveName.trim(), universe, criteria })
      setSaveName('')
      await loadSaved(tokenRef.current)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    await deleteSavedScreen(tokenRef.current, id).catch(() => {})
    setSavedScreens(prev => prev.filter(s => s.id !== id))
  }

  function loadScreen(s: SavedScreen) {
    setUniverse(s.universe)
    setCriteria(s.criteria)
  }

  function addCriterion() {
    if (!meta) return
    setCriteria(prev => [...prev, { field: meta.fields[0], operator: '>', value: 0 }])
  }

  if (!authChecked) return null

  const sel = 'rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Screener" />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Custom Stock Screener</h1>
          <p className="text-xs text-zinc-400">Filter stocks by technical and fundamental criteria across Nifty universes</p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
          {/* Builder panel */}
          <div className="lg:col-span-3 space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Universe</label>
                  <select value={universe} onChange={e => setUniverse(e.target.value)} className={sel}>
                    {Object.entries(UNIVERSE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Max Results</label>
                  <select value={limit} onChange={e => setLimit(Number(e.target.value))} className={sel}>
                    {[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>

              <div className="mb-4 space-y-2">
                <p className="text-xs font-medium text-zinc-500">Criteria</p>
                {criteria.map((c, i) => (
                  <CriterionRow
                    key={i} c={c}
                    fields={meta?.fields ?? []}
                    operators={meta?.operators ?? []}
                    onChange={nc => setCriteria(prev => prev.map((x, j) => j === i ? nc : x))}
                    onRemove={() => setCriteria(prev => prev.filter((_, j) => j !== i))}
                  />
                ))}
                <button
                  onClick={addCriterion}
                  className="mt-2 rounded-lg border border-dashed border-zinc-300 px-4 py-1.5 text-xs text-zinc-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700"
                >
                  + Add condition
                </button>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleRun}
                  disabled={running || criteria.length === 0}
                  className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {running ? 'Scanning…' : 'Run Screen'}
                </button>
                <div className="flex items-center gap-2">
                  <input
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    placeholder="Save as…"
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 w-40"
                  />
                  <button
                    onClick={handleSave}
                    disabled={saving || !saveName.trim()}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            {/* Results */}
            {running && (
              <div className="flex justify-center py-12">
                <div className="text-center">
                  <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent mb-3" />
                  <p className="text-xs text-zinc-400">Scanning {UNIVERSE_LABELS[universe]}… this may take 30–60s</p>
                </div>
              </div>
            )}
            {result && !running && (
              <div>
                <p className="mb-3 text-xs text-zinc-500">
                  Scanned <span className="font-semibold text-zinc-800 dark:text-zinc-200">{result.total_scanned}</span> stocks —
                  found <span className="font-semibold text-indigo-600 dark:text-indigo-400">{result.matches}</span> matches
                </p>
                <ResultsTable results={result.results} />
              </div>
            )}
          </div>

          {/* Saved screens sidebar */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Saved Screens</p>
            {savedScreens.length === 0 ? (
              <p className="text-xs text-zinc-400">No saved screens yet.</p>
            ) : (
              savedScreens.map(s => (
                <div key={s.id} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => loadScreen(s)}
                      className="text-sm font-semibold text-zinc-900 hover:text-indigo-600 dark:text-zinc-50 dark:hover:text-indigo-400 text-left"
                    >
                      {s.name}
                    </button>
                    <button onClick={() => handleDelete(s.id)} className="text-[10px] text-red-400 hover:text-red-600">Delete</button>
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-0.5">{UNIVERSE_LABELS[s.universe]} · {s.criteria.length} condition{s.criteria.length > 1 ? 's' : ''}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {s.criteria.map((c, i) => (
                      <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {FIELD_LABELS[c.field] ?? c.field} {c.operator} {c.value}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
