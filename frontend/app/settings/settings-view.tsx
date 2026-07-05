'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  changePassword,
  getMe,
  getRiskConfig,
  getUsage,
  updateProfile,
  updateRiskConfig,
  getMyOrg,
  createOrg,
  listOrgMembers,
  listOrgInvites,
  inviteMember,
  revokeInvite,
  updateOrgPlan,
  acceptInvite,
} from '@/lib/api'
import type { RiskConfig, UsageInfo, User, OrgData, OrgMember, OrgInvite } from '@/lib/api'
import { NavBar } from '@/components/nav-bar'

function Feedback({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null
  return (
    <p className={`mt-3 text-xs ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
      {msg.text}
    </p>
  )
}

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

const PLAN_COLOR: Record<string, string> = {
  free:       'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  pro:        'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  enterprise: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
}

function OrgCard({ tokenRef }: { tokenRef: React.RefObject<string> }) {
  const [org, setOrg] = useState<OrgData | null | undefined>(undefined)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [invites, setInvites] = useState<OrgInvite[]>([])
  const [newOrgName, setNewOrgName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteToken, setInviteToken] = useState('')
  const [lastToken, setLastToken] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getMyOrg(tokenRef.current).then(o => {
      setOrg(o)
      if (o) {
        listOrgMembers(tokenRef.current).then(setMembers).catch(() => {})
        if (o.role === 'owner' || o.role === 'admin') {
          listOrgInvites(tokenRef.current).then(setInvites).catch(() => {})
        }
      }
    }).catch(() => setOrg(null))
  }, [tokenRef])

  async function create() {
    if (!newOrgName.trim()) return
    setBusy(true); setMsg(null)
    try {
      const o = await createOrg(tokenRef.current, newOrgName.trim())
      setOrg(o); setMembers([]); setInvites([])
      setMsg({ ok: true, text: `Organization "${o.name}" created.` })
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Create failed' }) }
    finally { setBusy(false) }
  }

  async function invite() {
    if (!inviteEmail.trim()) return
    setBusy(true); setMsg(null)
    try {
      const r = await inviteMember(tokenRef.current, inviteEmail.trim())
      setLastToken(r.invite_token)
      setInviteEmail('')
      const list = await listOrgInvites(tokenRef.current)
      setInvites(list)
      setMsg({ ok: true, text: `Invite sent. Token: ${r.invite_token}` })
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Invite failed' }) }
    finally { setBusy(false) }
  }

  async function revoke(email: string) {
    setBusy(true)
    try {
      await revokeInvite(tokenRef.current, email)
      setInvites(prev => prev.filter(i => i.email !== email))
    } catch { /* ignore */ }
    finally { setBusy(false) }
  }

  async function accept() {
    if (!inviteToken.trim()) return
    setBusy(true); setMsg(null)
    try {
      const r = await acceptInvite(tokenRef.current, inviteToken.trim())
      if (r.joined) {
        const o = await getMyOrg(tokenRef.current)
        setOrg(o)
        if (o) { listOrgMembers(tokenRef.current).then(setMembers).catch(() => {}) }
        setMsg({ ok: true, text: 'Joined organization!' })
        setInviteToken('')
      }
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Accept failed' }) }
    finally { setBusy(false) }
  }

  async function upgradePlan(plan: string) {
    setBusy(true); setMsg(null)
    try {
      const updated = await updateOrgPlan(tokenRef.current, plan)
      setOrg(updated)
      setMsg({ ok: true, text: `Plan updated to ${plan}.` })
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Update failed' }) }
    finally { setBusy(false) }
  }

  if (org === undefined) return (
    <Card title="Organization">
      <div className="h-8 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
    </Card>
  )

  return (
    <Card title="Organization">
      {msg && (
        <p className={`mb-4 rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300'}`}>
          {msg.text}
        </p>
      )}

      {org === null ? (
        <div className="space-y-5">
          {/* Create new org */}
          <div>
            <p className="mb-1 text-xs font-medium text-zinc-500">Create a new organization</p>
            <div className="flex gap-2">
              <input
                value={newOrgName}
                onChange={e => setNewOrgName(e.target.value)}
                placeholder="Organization name"
                className={inputCls}
              />
              <button
                onClick={create} disabled={busy || !newOrgName.trim()}
                className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                Create
              </button>
            </div>
          </div>

          {/* Accept invite */}
          <div>
            <p className="mb-1 text-xs font-medium text-zinc-500">Or join with an invite token</p>
            <div className="flex gap-2">
              <input
                value={inviteToken}
                onChange={e => setInviteToken(e.target.value)}
                placeholder="Paste invite token"
                className={inputCls}
              />
              <button
                onClick={accept} disabled={busy || !inviteToken.trim()}
                className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                Join
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Org header */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">{org.name}</p>
              <p className="text-xs text-zinc-400">Your role: <span className="font-medium capitalize">{org.role}</span></p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${PLAN_COLOR[org.plan] ?? ''}`}>
                {org.plan}
              </span>
              <span className="text-xs text-zinc-400">{org.member_count} member{org.member_count !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Plan limits */}
          <div className="grid grid-cols-3 gap-3 text-xs">
            {[
              { label: 'Max Users', value: org.limits.max_users === -1 ? '∞' : org.limits.max_users },
              { label: 'Max Capital', value: org.limits.max_capital === -1 ? '∞' : `₹${(org.limits.max_capital / 1e5).toFixed(0)}L` },
              { label: 'Live Trading', value: org.limits.live_trading ? 'Yes' : 'No' },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg bg-zinc-50 p-3 text-center dark:bg-zinc-800">
                <p className="text-zinc-400">{label}</p>
                <p className={`mt-0.5 font-semibold ${label === 'Live Trading' && value === 'Yes' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-800 dark:text-zinc-200'}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Upgrade plan (owner only) */}
          {org.role === 'owner' && (
            <div>
              <p className="mb-2 text-xs font-medium text-zinc-500">Change Plan</p>
              <div className="flex gap-2">
                {(['free', 'pro', 'enterprise'] as const).filter(p => p !== org.plan).map(plan => (
                  <button
                    key={plan}
                    onClick={() => upgradePlan(plan)}
                    disabled={busy}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize disabled:opacity-60 ${
                      plan === 'enterprise' ? 'bg-amber-500 text-white hover:bg-amber-400'
                      : plan === 'pro' ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                      : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200'
                    }`}
                  >
                    {plan === 'enterprise' ? 'Enterprise' : plan === 'pro' ? '→ Pro' : '→ Free'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Invite (owner/admin only) */}
          {(org.role === 'owner' || org.role === 'admin') && (
            <div>
              <p className="mb-2 text-xs font-medium text-zinc-500">Invite Member</p>
              <div className="flex gap-2">
                <input
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="Email address"
                  type="email"
                  className={inputCls}
                />
                <button
                  onClick={invite} disabled={busy || !inviteEmail.trim()}
                  className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  Invite
                </button>
              </div>
              {lastToken && (
                <p className="mt-2 rounded-lg bg-zinc-100 px-3 py-2 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 break-all">
                  Token: {lastToken}
                </p>
              )}
            </div>
          )}

          {/* Members list */}
          {members.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-zinc-500">Members</p>
              <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                {members.map(m => (
                  <div key={m.user_id} className="flex items-center justify-between px-4 py-2 text-xs">
                    <span className="truncate text-zinc-700 dark:text-zinc-200 font-mono">{m.user_id.slice(0, 8)}…</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                      m.role === 'owner' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                      : m.role === 'admin' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}>{m.role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending invites */}
          {invites.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-zinc-500">Pending Invites</p>
              <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                {invites.filter(i => !i.accepted).map(inv => (
                  <div key={inv.email} className="flex items-center justify-between px-4 py-2 text-xs">
                    <span className="text-zinc-700 dark:text-zinc-200">{inv.email}</span>
                    <button
                      onClick={() => revoke(inv.email)}
                      disabled={busy}
                      className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export default function SettingsView() {
  const router = useRouter()
  const tokenRef = useRef('')
  const [user, setUser] = useState<User | null>(null)
  const [, setRiskConfig] = useState<RiskConfig | null>(null)
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

        {/* Organization */}
        <OrgCard tokenRef={tokenRef} />
      </main>
    </div>
  )
}
