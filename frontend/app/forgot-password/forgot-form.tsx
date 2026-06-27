'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { forgotPassword } from '@/lib/api'

const INPUT = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500'

export default function ForgotForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [resetToken, setResetToken] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value

    startTransition(async () => {
      try {
        const res = await forgotPassword(email)
        if (res.reset_token) {
          setResetToken(res.reset_token)
        } else {
          // Email not registered — show generic message without revealing that
          setResetToken('NOT_FOUND')
        }
      } catch {
        setError('Something went wrong. Please try again.')
      }
    })
  }

  if (resetToken === 'NOT_FOUND') {
    return (
      <div className="flex flex-col gap-4 text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          If that email is registered, a reset link has been issued.
        </p>
        <Link href="/login" className="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
          ← Back to sign in
        </Link>
      </div>
    )
  }

  if (resetToken) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Your reset token (valid for 1 hour):
        </p>
        <code className="break-all rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
          {resetToken}
        </code>
        <button
          type="button"
          onClick={() => router.push(`/reset-password?token=${encodeURIComponent(resetToken)}`)}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Set new password →
        </button>
        <p className="text-center text-xs text-zinc-400">
          In production this token will be emailed instead.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Enter your email and we&apos;ll generate a reset token.
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
          className={INPUT}
          placeholder="you@example.com"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="mt-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Sending…' : 'Get reset token'}
      </button>

      <Link
        href="/login"
        className="text-center text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        ← Back to sign in
      </Link>
    </form>
  )
}
