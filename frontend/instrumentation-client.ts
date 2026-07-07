// Client-side error tracking — opt-in via NEXT_PUBLIC_SENTRY_DSN (baked in at
// build time, see Dockerfile). No-ops entirely when unset.
import * as Sentry from '@sentry/browser'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  })
}
