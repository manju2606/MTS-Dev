'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { resetPassword } from '@/lib/api'

const INPUT = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500'

export default function ResetForm() {
  const router = useRouter()
  const params = useSearchParams()
  const tokenFromUrl = params.get('token') ?? ''

  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget
    const token = (form.elements.namedItem('token') as HTMLInputElement).value
    const newPassword = (form.elements.namedItem('new_password') as HTMLInputElement).value
    const confirm = (form.elements.namedItem('confirm') as HTMLInputElement).value

    if (newPassword !== confirm) {
      setError('Passwords do not match')
      return
    }

    startTransition(async () => {
      try {
        await resetPassword(token, newPassword)
        setDone(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Reset failed')
      }
    })
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <p className="text-sm font-medium text-green-600 dark:text-green-400">
          Password updated successfully.
        </p>
        <button
          type="button"
          onClick={() => router.push('/login')}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Sign in with new password →
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="token" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Reset token
        </label>
        <input
          id="token"
          name="token"
          type="text"
          required
          defaultValue={tokenFromUrl}
          disabled={isPending}
          className={INPUT}
          placeholder="Paste your reset token"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="new_password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          New password
        </label>
        <input
          id="new_password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={isPending}
          className={INPUT}
          placeholder="Min 8 characters"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="confirm" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Confirm new password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          disabled={isPending}
          className={INPUT}
          placeholder="••••••••"
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
        {isPending ? 'Resetting…' : 'Reset password'}
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
