'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { askTradingAgent } from '@/lib/api'
import type { TradingAgentLink } from '@/lib/api'

type ChatMessage = { role: 'user' | 'agent'; text: string; suggestions?: string[]; link?: TradingAgentLink | null }

// Lightweight **bold** support — the knowledge base uses it for emphasis and
// symbol names; no need for a full markdown renderer for a chat bubble.
function renderChatText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <Fragment key={i}>{part}</Fragment>
  )
}

const GREETING: ChatMessage = {
  role: 'agent',
  text: "Hi! I'm your Trading Agent — ask me how to use any part of the platform, e.g. \"how do I place a trade\" or \"what is Golden Stock\".",
  suggestions: [
    'How do I place a trade?',
    'What is Golden Stock?',
    'How does Paper Trading work?',
    'What does the Risk Engine do?',
  ],
}

export function TradingAgentChat() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open])

  async function send(question: string) {
    const q = question.trim()
    if (!q || sending) return
    const token = localStorage.getItem('mts_token')
    if (!token) return
    setMessages(prev => [...prev, { role: 'user', text: q }])
    setInput('')
    setSending(true)
    try {
      const reply = await askTradingAgent(token, q)
      setMessages(prev => [...prev, { role: 'agent', text: reply.answer, suggestions: reply.suggestions, link: reply.link }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'agent', text: (e as Error).message }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open && (
        <div className="mb-3 flex h-[520px] w-[360px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-100 bg-indigo-600 px-4 py-3 dark:border-zinc-800">
            <div>
              <p className="text-sm font-semibold text-white">Trading Agent</p>
              <p className="text-[11px] text-indigo-100">Your guide to the platform</p>
            </div>
            <button onClick={() => setOpen(false)} className="rounded p-1 text-indigo-100 hover:bg-indigo-500/50" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className="max-w-[85%]">
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                      m.role === 'user'
                        ? 'rounded-br-sm bg-indigo-600 text-white'
                        : 'rounded-bl-sm bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                    }`}
                  >
                    {renderChatText(m.text)}
                  </div>
                  {m.role === 'agent' && m.link && (
                    <button
                      onClick={() => { router.push(m.link!.href); setOpen(false) }}
                      className="mt-2 flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700"
                    >
                      Open {m.link.label} →
                    </button>
                  )}
                  {m.role === 'agent' && m.suggestions && m.suggestions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.suggestions.map(s => (
                        <button
                          key={s}
                          onClick={() => send(s)}
                          className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-2 text-[13px] text-zinc-400 dark:bg-zinc-800">…</div>
              </div>
            )}
          </div>

          <form
            onSubmit={e => { e.preventDefault(); send(input) }}
            className="flex items-center gap-2 border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800"
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about any feature…"
              className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition-transform hover:scale-105 hover:bg-indigo-700"
        aria-label="Open Trading Agent chat"
        title="Trading Agent"
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
      </button>
    </div>
  )
}
