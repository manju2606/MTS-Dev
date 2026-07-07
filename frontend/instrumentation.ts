// Server-side error tracking — opt-in via SENTRY_DSN (runtime env var, not
// baked into the client bundle). No-ops entirely when unset.
import type { Instrumentation } from 'next'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.SENTRY_DSN) {
    const Sentry = await import('@sentry/node')
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
    })
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err) => {
  if (process.env.SENTRY_DSN) {
    const Sentry = await import('@sentry/node')
    Sentry.captureException(err)
  }
}
