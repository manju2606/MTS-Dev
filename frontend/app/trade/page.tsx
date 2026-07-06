import { Suspense } from 'react'
import { TradeView } from './trade-view'

export default function TradePage() {
  return (
    <Suspense>
      <TradeView />
    </Suspense>
  )
}
