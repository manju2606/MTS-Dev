import type { Metadata } from 'next'
import { Suspense } from 'react'
import ResetForm from './reset-form'

export const metadata: Metadata = {
  title: 'Reset password — Manju Trade AI Pro',
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Manju Trade AI Pro
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Set a new password
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
