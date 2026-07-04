import { Suspense } from 'react'
import AssistantView from './assistant-view'

export const metadata = { title: 'Portfolio Assistant — MTS Pro' }

export default function PortfolioAssistantPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p className="text-sm text-zinc-400">Loading…</p></div>}>
      <AssistantView />
    </Suspense>
  )
}
