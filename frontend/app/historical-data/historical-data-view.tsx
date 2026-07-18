'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/nav-bar'
import {
  downloadHistoricalData, getHistoricalCandles, listDownloadedHistoricalSymbols,
  deleteHistoricalSeries, listMcxContracts, searchStocks,
} from '@/lib/api'
import type {
  HistoricalCandle, HistoricalDataInterval, HistoricalDownloadedSeries, HistoricalDownloadResult,
  McxContractOption, StockSearchResult,
} from '@/lib/api'

const EXCHANGES = ['NSE', 'BSE', 'NFO', 'MCX']
const INTERVALS: HistoricalDataInterval[] = [
  'minute', '3minute', '5minute', '10minute', '15minute', '30minute', '60minute', 'day',
]

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function daysAgoStr(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export default function HistoricalDataView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [authChecked, setAuthChecked] = useState(false)

  const [pickedSymbols, setPickedSymbols] = useState<string[]>([])
  const [exchange, setExchange] = useState('NSE')
  const [interval, setInterval] = useState<HistoricalDataInterval>('day')
  const [fromDate, setFromDate] = useState(daysAgoStr(365))
  const [toDate, setToDate] = useState(todayStr())
  const [includeOi, setIncludeOi] = useState(false)

  const [mcxContracts, setMcxContracts] = useState<McxContractOption[]>([])
  const [mcxPick, setMcxPick] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSuggestions, setSearchSuggestions] = useState<StockSearchResult[]>([])
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [downloading, setDownloading] = useState(false)
  const [results, setResults] = useState<HistoricalDownloadResult[] | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [downloaded, setDownloaded] = useState<HistoricalDownloadedSeries[]>([])
  const [browseCandles, setBrowseCandles] = useState<HistoricalCandle[] | null>(null)
  const [browsing, setBrowsing] = useState<HistoricalDownloadedSeries | null>(null)
  const [csvExporting, setCsvExporting] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    const id = setTimeout(() => setAuthChecked(true), 0)
    loadDownloaded(t)
    listMcxContracts(t).then(setMcxContracts).catch(() => {})
    return () => clearTimeout(id)
  }, [router])

  // Symbols are exchange-specific -- switching exchange invalidates prior picks.
  function handleExchangeChange(next: string) {
    setExchange(next)
    setPickedSymbols([])
    setMcxPick('')
    setSearchQuery('')
    setSearchSuggestions([])
  }

  function loadDownloaded(t: string) {
    listDownloadedHistoricalSymbols(t).then(setDownloaded).catch(() => {})
  }

  function handleSearchChange(val: string) {
    setSearchQuery(val)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    if (val.trim().length < 2) { setSearchSuggestions([]); return }
    searchDebounce.current = setTimeout(() => {
      searchStocks(tokenRef.current, val).then(setSearchSuggestions)
    }, 250)
  }

  function addSymbol(symbol: string) {
    setPickedSymbols(prev => prev.includes(symbol) ? prev : [...prev, symbol])
    setSearchQuery('')
    setSearchSuggestions([])
    setMcxPick('')
  }

  function removeSymbol(symbol: string) {
    setPickedSymbols(prev => prev.filter(s => s !== symbol))
  }

  async function handleDownload() {
    if (pickedSymbols.length === 0) return
    setDownloading(true); setMsg(null); setResults(null)
    try {
      const res = await downloadHistoricalData(tokenRef.current, {
        symbols: pickedSymbols,
        exchange,
        interval,
        from_date: fromDate,
        to_date: toDate,
        include_oi: includeOi,
      })
      setResults(res.results)
      const failed = res.results.filter(r => !r.ok).length
      const total = pickedSymbols.length
      setMsg(failed === 0
        ? { type: 'ok', text: `Downloaded ${total - failed}/${total} symbols successfully.` }
        : { type: 'err', text: `${failed}/${total} symbols failed — see details below.` })
      loadDownloaded(tokenRef.current)
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Download failed' })
    } finally { setDownloading(false) }
  }

  async function browseSeries(series: HistoricalDownloadedSeries) {
    setBrowsing(series)
    setBrowseCandles(null)
    try {
      const candles = await getHistoricalCandles(tokenRef.current, {
        symbol: series.symbol,
        exchange: series.exchange,
        interval: series.interval as HistoricalDataInterval,
        from_date: series.from_time.slice(0, 10),
        to_date: series.to_time.slice(0, 10),
      })
      setBrowseCandles(candles)
    } catch {
      setBrowseCandles([])
    }
  }

  function seriesKey(series: HistoricalDownloadedSeries) {
    return `${series.symbol}-${series.exchange}-${series.interval}`
  }

  async function downloadCsv(series: HistoricalDownloadedSeries) {
    const key = seriesKey(series)
    setCsvExporting(key)
    try {
      const candles = browsing && seriesKey(browsing) === key && browseCandles
        ? browseCandles
        : await getHistoricalCandles(tokenRef.current, {
            symbol: series.symbol,
            exchange: series.exchange,
            interval: series.interval as HistoricalDataInterval,
            from_date: series.from_time.slice(0, 10),
            to_date: series.to_time.slice(0, 10),
          })

      const header = 'time,open,high,low,close,volume,open_interest'
      const rows = candles.map(c =>
        [c.time, c.open, c.high, c.low, c.close, c.volume, c.open_interest ?? ''].join(',')
      )
      const csv = [header, ...rows].join('\n')

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${series.symbol}_${series.exchange}_${series.interval}_${series.from_time.slice(0, 10)}_${series.to_time.slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      setMsg({ type: 'err', text: `Failed to export ${series.symbol} to CSV` })
    } finally {
      setCsvExporting(null)
    }
  }

  async function handleDelete(series: HistoricalDownloadedSeries) {
    const label = series.friendly_label ?? series.symbol
    if (!window.confirm(`Delete all ${series.candles} downloaded candles for ${label} (${series.exchange}, ${series.interval})? This can't be undone.`)) {
      return
    }
    const key = seriesKey(series)
    setDeleting(key)
    try {
      await deleteHistoricalSeries(tokenRef.current, {
        symbol: series.symbol, exchange: series.exchange, interval: series.interval,
      })
      setDownloaded(prev => prev.filter(s => seriesKey(s) !== key))
      if (browsing && seriesKey(browsing) === key) { setBrowsing(null); setBrowseCandles(null) }
      setMsg({ type: 'ok', text: `Deleted ${label} (${series.exchange}, ${series.interval}).` })
    } catch {
      setMsg({ type: 'err', text: `Failed to delete ${label}` })
    } finally {
      setDeleting(null)
    }
  }

  if (!authChecked) return null

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Historical Data" />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Historical Data</h1>
        <p className="mb-8 text-xs text-zinc-400">
          Download OHLCV history for any NSE/BSE/NFO/MCX symbol using your connected Zerodha account
          (same connection as the MCX pages — requires Kite Connect&apos;s Historical Data subscription).
          Not connected? <a href="/broker" className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400">Connect via Broker settings →</a>
        </p>

        {/* download form */}
        <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Download</p>

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500">Exchange</label>
              <select value={exchange} onChange={e => handleExchangeChange(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                {EXCHANGES.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500">Interval</label>
              <select value={interval} onChange={e => setInterval(e.target.value as HistoricalDataInterval)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500">From</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500">To</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
            </div>
          </div>

          <label className="mb-1 block text-xs font-medium text-zinc-500">
            Symbols {exchange === 'MCX' ? '(pick a contract)' : '(search & add)'}
          </label>

          {exchange === 'MCX' ? (
            <div className="mb-2 flex gap-2">
              <select value={mcxPick} onChange={e => e.target.value && addSymbol(e.target.value)}
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                <option value="">Select a contract…</option>
                {mcxContracts.map(c => (
                  <option key={c.value} value={c.value} disabled={pickedSymbols.includes(c.value)}>
                    {c.label}{pickedSymbols.includes(c.value) ? ' (added)' : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="relative mb-2">
              <input
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search a symbol (e.g. RELIANCE, TCS…)"
                autoComplete="off"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              {searchSuggestions.length > 0 && (
                <ul className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  {searchSuggestions.map(r => (
                    <li key={r.symbol}>
                      <button type="button" onClick={() => addSymbol(r.symbol.replace('.NS', '').replace('.BO', ''))}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/40">
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {r.symbol.replace('.NS', '').replace('.BO', '')}
                        </span>
                        <span className="ml-2 truncate text-zinc-400">{r.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {pickedSymbols.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {pickedSymbols.map(s => (
                <span key={s} className="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                  {exchange === 'MCX' ? (mcxContracts.find(c => c.value === s)?.label ?? s) : s}
                  <button type="button" onClick={() => removeSymbol(s)} className="text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-100">✕</button>
                </span>
              ))}
            </div>
          )}

          <label className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
            <input type="checkbox" checked={includeOi} onChange={e => setIncludeOi(e.target.checked)} />
            Include Open Interest (F&O / MCX only)
          </label>

          <button
            onClick={handleDownload}
            disabled={downloading || pickedSymbols.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {downloading ? 'Downloading…' : 'Download & Save'}
          </button>
        </div>

        {msg && (
          <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${msg.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300'}`}>
            {msg.text}
          </div>
        )}

        {results && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  {['Symbol', 'Status', 'Candles Saved', 'Error'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-zinc-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.symbol} className="border-b border-zinc-50 dark:border-zinc-800/50">
                    <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-50">{r.symbol}</td>
                    <td className={`px-3 py-2 font-semibold ${r.ok ? 'text-emerald-600' : 'text-red-600'}`}>{r.ok ? 'OK' : 'Failed'}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{r.candles_saved}</td>
                    <td className="px-3 py-2 text-red-500">{r.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* browse downloaded data */}
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Already Downloaded</p>
          </div>
          {downloaded.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-400">Nothing downloaded yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  {['Symbol', 'Exchange', 'Interval', 'Candles', 'From', 'To', ''].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-zinc-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {downloaded.map(s => (
                  <tr key={`${s.symbol}-${s.exchange}-${s.interval}`} className="border-b border-zinc-50 dark:border-zinc-800/50">
                    <td className="px-3 py-2">
                      <p className="font-semibold text-zinc-900 dark:text-zinc-50">{s.friendly_label ?? s.symbol}</p>
                      {s.friendly_label && <p className="text-[10px] text-zinc-400">{s.symbol}</p>}
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{s.exchange}</td>
                    <td className="px-3 py-2 text-zinc-500">{s.interval}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{s.candles}</td>
                    <td className="px-3 py-2 text-zinc-500">{s.from_time.slice(0, 10)}</td>
                    <td className="px-3 py-2 text-zinc-500">{s.to_time.slice(0, 10)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <button onClick={() => browseSeries(s)} className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                          View →
                        </button>
                        <button
                          onClick={() => downloadCsv(s)}
                          disabled={csvExporting === seriesKey(s)}
                          className="text-[11px] font-semibold text-emerald-600 hover:underline disabled:opacity-50 dark:text-emerald-400"
                        >
                          {csvExporting === seriesKey(s) ? 'Exporting…' : 'Download CSV ⬇'}
                        </button>
                        <button
                          onClick={() => handleDelete(s)}
                          disabled={deleting === seriesKey(s)}
                          className="text-[11px] font-semibold text-red-500 hover:underline disabled:opacity-50 dark:text-red-400"
                        >
                          {deleting === seriesKey(s) ? 'Deleting…' : 'Delete 🗑'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {browsing && (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {browsing.symbol} · {browsing.exchange} · {browsing.interval}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => downloadCsv(browsing)}
                  disabled={csvExporting === seriesKey(browsing)}
                  className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-50 dark:text-emerald-400"
                >
                  {csvExporting === seriesKey(browsing) ? 'Exporting…' : 'Download CSV ⬇'}
                </button>
                <button onClick={() => { setBrowsing(null); setBrowseCandles(null) }} className="text-xs text-zinc-400 hover:text-zinc-600">
                  Close ✕
                </button>
              </div>
            </div>
            {browseCandles === null ? (
              <p className="py-8 text-center text-xs text-zinc-400">Loading…</p>
            ) : browseCandles.length === 0 ? (
              <p className="py-8 text-center text-xs text-zinc-400">No candles found.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      {['Time', 'Open', 'High', 'Low', 'Close', 'Volume', 'OI'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-zinc-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {browseCandles.map(c => (
                      <tr key={c.time} className="border-b border-zinc-50 dark:border-zinc-800/50">
                        <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-300">{c.time.replace('T', ' ').slice(0, 19)}</td>
                        <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-300">{c.open.toFixed(2)}</td>
                        <td className="px-3 py-2 font-mono text-emerald-600">{c.high.toFixed(2)}</td>
                        <td className="px-3 py-2 font-mono text-red-500">{c.low.toFixed(2)}</td>
                        <td className="px-3 py-2 font-mono font-semibold text-zinc-900 dark:text-zinc-50">{c.close.toFixed(2)}</td>
                        <td className="px-3 py-2 text-zinc-500">{c.volume.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2 text-zinc-500">{c.open_interest ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
