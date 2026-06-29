'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  changePassword,
  getMe,
  getRiskConfig,
  getUsage,
  updateProfile,
  updateRiskConfig,
} from '@/lib/api'
import type { RiskConfig, UsageInfo, User } from '@/lib/api'
import { NavBar } from '@/components/nav-bar'

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-xs font-medium text-zinc-500">{label}</label>
      {children}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'

export default function SettingsView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [user, setUser] = useState<User | null>(null)
  const [riskConfig, setRiskConfig] = useState<RiskConfig | null>(null)
  const [usage, setUsage] = useState<UsageInfo | null>(null)

  // Profile form state
  const [fullName, setFullName] = useState('')
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  // Password form state
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pwLoading, setPwLoading] = useState(false)

  // Risk form state
  const [riskMsg, setRiskMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [riskLoading, setRiskLoading] = useState(false)
  const [capital, setCapital] = useState('')
  const [maxPosPct, setMaxPosPct] = useState('')
  const [maxDailyLoss, setMaxDailyLoss] = useState('')
  const [maxDrawdown, setMaxDrawdown] = useState('')
  const [minRR, setMinRR] = useState('')
  const [maxStop, setMaxStop] = useState('')

  useEffect(() => {
    const t = localStorage.getItem('mts_token')
    if (!t) { router.replace('/login'); return }
    tokenRef.current = t
    Promise.all([getMe(t), getRiskConfig(t), getUsage(t)]).then(([u, rc, usg]) => {
      setUser(u)
      setFullName(u.full_name)
      setRiskConfig(rc)
      setCapital(String(rc.capital))
      setMaxPosPct(String((rc.max_position_pct * 100).toFixed(1)))
      setMaxDailyLoss(String((rc.max_daily_loss_pct * 100).toFixed(1)))
      setMaxDrawdown(String((rc.max_drawdown_pct * 100).toFixed(1)))
      setMinRR(String(rc.min_risk_reward))
      setMaxStop(String((rc.max_stop_pct * 100).toFixed(1)))
      setUsage(usg)
    }).catch(() => {})
  }, [router])

  async function saveProfile() {
    if (!fullName.trim()) return
    setProfileLoading(true)
    setProfileMsg(null)
    try {
      const updated = await updateProfile(tokenRef.current, fullName.trim())
      setUser(updated)
      setProfileMsg({ ok: true, text: 'Profile updated.' })
    } catch (e) {
      setProfileMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setProfileLoading(false)
    }
  }

  async function savePassword() {
    if (newPw !== confirmPw) { setPwMsg({ ok: false, text: 'Passwords do not match.' }); return }
    if (newPw.length < 8) { setPwMsg({ ok: false, text: 'New password must be 8+ characters.' }); return }
    setPwLoading(true)
    setPwMsg(null)
    try {
      await changePassword(tokenRef.current, currentPw, newPw)
      setPwMsg({ ok: true, text: 'Password changed successfully.' })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setPwLoading(false)
    }
  }

  async function saveRisk() {
    setRiskLoading(true)
    setRiskMsg(null)
    try {
      const updated = await updateRiskConfig(tokenRef.current, {
        capital: parseFloat(capital),
        max_position_pct: parseFloat(maxPosPct) / 100,
        max_daily_loss_pct: parseFloat(maxDailyLoss) / 100,
        max_drawdown_pct: parseFloat(maxDrawdown) / 100,
        min_risk_reward: parseFloat(minRR),
        max_stop_pct: parseFloat(maxStop) / 100,
      })
      setRiskConfig(updated)
      setRiskMsg({ ok: true, text: 'Risk limits updated.' })
    } catch (e) {
      setRiskMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setRiskLoading(false)
    }
  }

  function Feedback({ msg }: { msg: { ok: boolean; text: string } | null }) {
    if (!msg) return null
    return (
      <p className={`mt-3 text-xs ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
        {msg.text}
      </p>
    )
  }

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <NavBar active="Settings" />
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Settings</h1>

        {/* Profile */}
        <Card title="Profile">
          <Field label="Email">
            <input disabled value={user?.email ?? ''} className={inputCls + ' opacity-60 cursor-not-allowed'} />
          </Field>
          <Field label="Display Name">
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className={inputCls}
            />
          </Field>
          <button
            onClick={saveProfile}
            disabled={profileLoading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {profileLoading ? 'Saving…' : 'Save Profile'}
          </button>
          <Feedback msg={profileMsg} />
        </Card>

        {/* Subscription & usage */}
        {usage && (
          <Card title="Subscription & AI Usage">
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-zinc-400">Plan</p>
                <p className="mt-0.5 text-sm font-medium capitalize text-zinc-800 dark:text-zinc-200">
                  {usage.tier}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">AI Calls Today</p>
                <p className="mt-0.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {usage.calls_today} / {usage.limit === 9999 ? '∞' : usage.limit}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Remaining</p>
                <p className="mt-0.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {usage.limit === 9999 ? '∞' : usage.remaining}
                </p>
              </div>
            </div>
            {usage.calls_today > 0 && usage.limit < 9999 && (
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${Math.min(100, (usage.calls_today / usage.limit) * 100)}%` }}
                />
              </div>
            )}
          </Card>
        )}

        {/* Password */}
        <Card title="Change Password">
          <Field label="Current Password">
            <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className={inputCls} />
          </Field>
          <Field label="New Password (8+ chars)">
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Confirm New Password">
            <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} className={inputCls} />
          </Field>
          <button
            onClick={savePassword}
            disabled={pwLoading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {pwLoading ? 'Changing…' : 'Change Password'}
          </button>
          <Feedback msg={pwMsg} />
        </Card>

        {/* Risk limits */}
        <Card title="Risk Limits (applied to all paper trades)">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Paper Capital (₹)">
              <input type="number" value={capital} onChange={e => setCapital(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Max Position Size (%)">
              <input type="number" value={maxPosPct} onChange={e => setMaxPosPct(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Max Daily Loss (%)">
              <input type="number" value={maxDailyLoss} onChange={e => setMaxDailyLoss(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Max Drawdown (%)">
              <input type="number" value={maxDrawdown} onChange={e => setMaxDrawdown(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Min Risk:Reward">
              <input type="number" step="0.1" value={minRR} onChange={e => setMinRR(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Max Stop Distance (%)">
              <input type="number" value={maxStop} onChange={e => setMaxStop(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <button
            onClick={saveRisk}
            disabled={riskLoading}
            className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {riskLoading ? 'Saving…' : 'Save Risk Limits'}
          </button>
          <Feedback msg={riskMsg} />
        </Card>
      </main>
    </div>
  )
}
