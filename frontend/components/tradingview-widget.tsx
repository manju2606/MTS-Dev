'use client'

import { useEffect, useRef, useState } from 'react'

// Watches the `dark` class on <html> (toggled by useDarkMode in nav-bar.tsx)
// so the embedded widget matches the app's current theme and flips live when
// the user toggles it, without needing a shared theme context.
function useHtmlDarkMode(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )
  useEffect(() => {
    const el = document.documentElement
    const observer = new MutationObserver(() => setDark(el.classList.contains('dark')))
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

// Embeds TradingView's hosted "Advanced Real-Time Chart" widget (real
// TradingView market data, independent of our own backend) via their
// external-embedding script. `symbol` uses TradingView's EXCHANGE:TICKER
// format -- note real exchange-listed futures (e.g. "NYMEX:NG1!") return
// "This symbol is only available on TradingView" on the free embeddable
// widget (it needs a paid TradingView data license); free CFD/spot proxies
// like "CAPITALCOM:NATURALGAS" work and track the same underlying price.
export function TradingViewWidget({ symbol, height = 520 }: { symbol: string; height?: number }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dark = useHtmlDarkMode()
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    function onChange() { setFullscreen(document.fullscreenElement === wrapperRef.current) }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.innerHTML = '<div class="tradingview-widget-container__widget"></div>'

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true
    script.text = JSON.stringify({
      autosize: true,
      symbol,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: dark ? 'dark' : 'light',
      style: '1',
      locale: 'en',
      enable_publishing: false,
      allow_symbol_change: false,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    })
    container.appendChild(script)

    return () => { container.innerHTML = '' }
  }, [symbol, dark])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      wrapperRef.current?.requestFullscreen()
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      {/* containerRef IS the ".tradingview-widget-container" element (not an
          extra wrapper around it) -- TradingView's embed script expects the
          widget div and script tag to be its direct children per their own
          snippet structure. An extra nesting level here previously left the
          injected iframe pushed below this box's visible (overflow-hidden)
          area instead of filling it. */}
      <div
        ref={containerRef}
        className="tradingview-widget-container relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800"
        style={{ height: fullscreen ? '100vh' : height }}
      />
      <button
        type="button"
        onClick={toggleFullscreen}
        title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        className="absolute right-3 top-3 z-10 rounded-md bg-zinc-900/60 p-1.5 text-white transition-colors hover:bg-zinc-900/80"
      >
        {fullscreen ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        )}
      </button>
    </div>
  )
}
