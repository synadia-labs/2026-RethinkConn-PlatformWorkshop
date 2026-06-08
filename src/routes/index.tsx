import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const [signedUp, setSignedUp] = useState(
    () => localStorage.getItem('sygma_account_id') !== null,
  )

  function signOut() {
    localStorage.removeItem('sygma_account_id')
    localStorage.removeItem('sygma_account_nkey')
    localStorage.removeItem('sygma_creds')
    setSignedUp(false)
  }

  if (!signedUp) {
    return <SignupForm onSuccess={() => setSignedUp(true)} />
  }

  return <WhiteboardList onSignOut={signOut} />
}

function SignupForm({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState('')
  const [teamId, setTeamId] = useState('')
  const [cpUrl, setCpUrl] = useState('https://cloud.synadia.com')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          team_id: teamId || undefined,
          cp_url: cpUrl || undefined,
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(text)
      }

      const data = await res.json()
      localStorage.setItem('sygma_account_id', data.account_id)
      localStorage.setItem('sygma_account_nkey', data.account_public_key)
      localStorage.setItem('sygma_creds', data.creds)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-white">
      <h1 className="text-5xl font-bold text-slate-800">&Sigma;ygma</h1>
      <p className="text-xl text-slate-600">Collaborative whiteboard powered by NATS</p>

      <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-4">
        <div>
          <label htmlFor="token" className="mb-1 block text-sm font-medium text-slate-700">
            Synadia Cloud Personal Access Token
          </label>
          <input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="uat_..."
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>

        <div>
          <label htmlFor="cpUrl" className="mb-1 block text-sm font-medium text-slate-700">
            Synadia Cloud URL
          </label>
          <input
            id="cpUrl"
            type="url"
            value={cpUrl}
            onChange={(e) => setCpUrl(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>

        <div>
          <label htmlFor="teamId" className="mb-1 block text-sm font-medium text-slate-700">
            Team ID <span className="text-slate-400">(optional)</span>
          </label>
          <input
            id="teamId"
            type="text"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            placeholder="Leave blank to auto-detect"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-violet-500 px-5 py-3 text-lg font-medium text-white hover:bg-violet-600 disabled:opacity-50"
        >
          {loading ? 'Signing up...' : 'Sign up'}
        </button>
      </form>
    </main>
  )
}

function WhiteboardList({ onSignOut }: { onSignOut: () => void }) {
  const boardId = Math.random().toString(36).slice(2, 10)

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-white">
      <h1 className="text-5xl font-bold text-slate-800">&Sigma;ygma</h1>
      <p className="text-xl text-slate-600">Collaborative whiteboard powered by NATS</p>
      <Link
        to="/board/$id"
        params={{ id: boardId }}
        className="rounded-full bg-violet-500 px-5 py-3 text-lg font-medium text-white hover:bg-violet-600"
      >
        Start a whiteboard
      </Link>
      <button
        onClick={onSignOut}
        className="text-sm text-slate-400 hover:text-slate-600"
      >
        Sign out
      </button>
    </main>
  )
}
