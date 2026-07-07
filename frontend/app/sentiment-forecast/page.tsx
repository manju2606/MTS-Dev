import type { Metadata } from 'next'
import { SentimentForecastView } from './sentiment-forecast-view'

export const metadata: Metadata = { title: 'Sentiment Forecast — Manju Trade AI Pro' }

export default function SentimentForecastPage() {
  return <SentimentForecastView />
}
