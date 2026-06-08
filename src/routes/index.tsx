import { WhiteboardPreview } from '#/components/whiteboard-preview'
import type { WhiteboardInfo } from '#/lib/nats'
import {
  connectNats,
  createWhiteboard,
  deleteWhiteboard,
  ensureStream,
  listWhiteboards,
  renameWhiteboard,
} from '#/lib/nats'
import type { NatsConnection } from '@nats-io/nats-core'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  Check,
  Copy,
  Import,
  LogOut,
  Plus,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--bg-base)]">
      <h1 className="font-serif text-5xl font-bold text-[var(--sea-ink)]">
        &Sigma;ygma
      </h1>
      <p className="text-xl text-[var(--sea-ink-soft)]">
        Collaborative whiteboard powered by NATS
      </p>

      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-md flex-col gap-4"
      >
        <div>
          <label
            htmlFor="token"
            className="mb-1 block font-medium text-[var(--sea-ink)]"
          >
            Synadia Cloud Personal Access Token
          </label>
          <input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="uat_..."
            required
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-[var(--sea-ink)] focus:border-[var(--lagoon)] focus:outline-none focus:ring-1 focus:ring-[var(--lagoon)]"
          />
        </div>

        <div>
          <label
            htmlFor="cpUrl"
            className="mb-1 block font-medium text-[var(--sea-ink)]"
          >
            Synadia Cloud URL
          </label>
          <input
            id="cpUrl"
            type="url"
            value={cpUrl}
            onChange={(e) => setCpUrl(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-[var(--sea-ink)] focus:border-[var(--lagoon)] focus:outline-none focus:ring-1 focus:ring-[var(--lagoon)]"
          />
        </div>

        <div>
          <label
            htmlFor="teamId"
            className="mb-1 block font-medium text-[var(--sea-ink)]"
          >
            Team ID{' '}
            <span className="text-[var(--sea-ink-soft)]">(optional)</span>
          </label>
          <input
            id="teamId"
            type="text"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            placeholder="Leave blank to auto-detect"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-[var(--sea-ink)] focus:border-[var(--lagoon)] focus:outline-none focus:ring-1 focus:ring-[var(--lagoon)]"
          />
        </div>

        {error && <p className="text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-[var(--lagoon-deep)] px-5 py-3 text-lg font-medium text-white hover:bg-[var(--lagoon)] disabled:opacity-50"
        >
          {loading ? 'Signing up...' : 'Sign up'}
        </button>
      </form>
    </main>
  )
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const now = Date.now()
  const seconds = Math.floor((now - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <p className="mb-1 font-medium text-[var(--sea-ink-soft)]">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded bg-[var(--sand)] px-2 py-1.5 font-mono text-[var(--sea-ink)]">
          {value}
        </code>
        <button
          onClick={copy}
          className="rounded p-1.5 text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  )
}

function ShareModal({
  board,
  onClose,
}: {
  board: WhiteboardInfo
  onClose: () => void
}) {
  const accountNkey = localStorage.getItem('sygma_account_nkey') || ''
  const subject = `whiteboard.${board.id}.>`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--sea-ink)]">
            Share "{board.name}"
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-[var(--sea-ink-soft)]">
            To share this whiteboard, both you and the recipient need to
            configure subject exports/imports in Synadia Cloud.
          </p>

          <div className="space-y-3 rounded-lg border border-[var(--line)] p-4">
            <p className="font-semibold text-[var(--sea-ink)]">
              Your info (give to recipient)
            </p>
            <CopyField label="Account Public Key" value={accountNkey} />
            <CopyField label="Subject" value={subject} />
          </div>

          <div className="space-y-2 rounded-lg border border-[var(--line)] p-4">
            <p className="font-semibold text-[var(--sea-ink)]">Steps</p>
            <ol className="list-inside list-decimal space-y-1.5 text-[var(--sea-ink-soft)]">
              <li>
                <strong className="text-[var(--sea-ink)]">You (owner):</strong>{' '}
                In Synadia Cloud, go to your sygma account and create a{' '}
                <strong>Subject Export</strong> for{' '}
                <code className="rounded bg-[var(--sand)] px-1 font-mono">
                  {subject}
                </code>
              </li>
              <li>
                <strong className="text-[var(--sea-ink)]">Recipient:</strong> In
                Synadia Cloud, create a <strong>Subject Import</strong> using
                your Account Public Key and subject above
              </li>
              <li>
                <strong className="text-[var(--sea-ink)]">Recipient:</strong>{' '}
                Click "Import board" in Sygma and enter the board ID:{' '}
                <code className="rounded bg-[var(--sand)] px-1 font-mono">
                  {board.id}
                </code>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

function BoardCard({
  board,
  nc,
  onRename,
  onDelete,
}: {
  board: WhiteboardInfo
  nc: NatsConnection | null
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(board.name)
  const [showShare, setShowShare] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  async function commitRename() {
    const trimmed = editName.trim()
    setEditing(false)
    if (!trimmed || trimmed === board.name || !nc) {
      setEditName(board.name)
      return
    }
    try {
      await renameWhiteboard(nc, board.id, trimmed)
      onRename(board.id, trimmed)
    } catch (err) {
      console.error('rename whiteboard:', err)
      setEditName(board.name)
    }
  }

  return (
    <div className="group overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-sm transition-shadow hover:shadow-lg">
      <Link
        to="/board/$id"
        params={{ id: board.id }}
        className="block aspect-[10/7] w-full overflow-hidden bg-white"
      >
        {nc && <WhiteboardPreview id={board.id} nc={nc} />}
      </Link>
      <div className="flex items-start justify-between border-t border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                commitRename()
              }}
            >
              <input
                ref={inputRef}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditName(board.name)
                    setEditing(false)
                  }
                }}
                className="w-full rounded border border-[var(--lagoon)] bg-[var(--surface-strong)] px-1 py-0.5 font-medium text-[var(--sea-ink)] outline-none"
              />
            </form>
          ) : (
            <p
              className="cursor-text truncate font-semibold text-[var(--sea-ink)] group-hover:text-[var(--lagoon)]"
              onDoubleClick={() => setEditing(true)}
            >
              {board.name}
            </p>
          )}
          {board.lastModified && (
            <p className="mt-0.5 text-[var(--sea-ink-soft)]">
              Edited {timeAgo(board.lastModified)}
            </p>
          )}
        </div>
        <div className="ml-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => setShowShare(true)}
            className="rounded p-1 text-[var(--sea-ink-soft)] hover:text-[var(--lagoon)]"
          >
            <Share2 size={14} />
          </button>
          <button
            onClick={async () => {
              if (!nc) return
              try {
                await deleteWhiteboard(nc, board.id)
                onDelete(board.id)
              } catch (err) {
                console.error('delete whiteboard:', err)
              }
            }}
            className="rounded p-1 text-[var(--sea-ink-soft)] hover:text-red-500"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {showShare && (
        <ShareModal board={board} onClose={() => setShowShare(false)} />
      )}
    </div>
  )
}

function WhiteboardList({ onSignOut }: { onSignOut: () => void }) {
  const [boards, setBoards] = useState<WhiteboardInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showNameInput, setShowNameInput] = useState(false)
  const [newName, setNewName] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importId, setImportId] = useState('')
  const [importName, setImportName] = useState('')
  const [importing, setImporting] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const ncRef = useRef<NatsConnection | null>(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    const { nc } = await connectNats()
    ncRef.current = nc
    const list = await listWhiteboards(nc)
    list.sort((a, b) => {
      if (!a.lastModified || !b.lastModified) return 0
      return (
        new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
      )
    })
    setBoards(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    load().catch(console.error)

    function onBeforeUnload() {
      ncRef.current?.close()
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      ncRef.current?.close()
      ncRef.current = null
    }
  }, [load])

  useEffect(() => {
    if (showNameInput) nameInputRef.current?.focus()
  }, [showNameInput])

  useEffect(() => {
    if (showImport) importInputRef.current?.focus()
  }, [showImport])

  async function handleImport() {
    const nc = ncRef.current
    const id = importId.trim()
    if (!nc || !id) return
    setImporting(true)
    try {
      await ensureStream(nc, `whiteboard_${id}`, [`whiteboard.${id}.>`])
      setShowImport(false)
      setImportId('')
      setImportName('')
      await nc.close()
      ncRef.current = null
      navigate({ to: '/board/$id', params: { id } })
    } catch (err) {
      console.error('import whiteboard:', err)
      setImporting(false)
    }
  }

  async function handleCreate() {
    const nc = ncRef.current
    if (!nc) return
    const name = newName.trim() || 'Untitled'
    setCreating(true)
    try {
      const board = await createWhiteboard(nc, name)
      await nc.close()
      ncRef.current = null
      navigate({ to: '/board/$id', params: { id: board.id } })
    } catch (err) {
      console.error('create whiteboard:', err)
      setCreating(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-base)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--header-bg)] px-6 py-3 backdrop-blur-sm">
        <h1 className="font-serif text-xl font-bold text-[var(--sea-ink)]">
          &Sigma;ygma
        </h1>
        <button
          onClick={onSignOut}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[var(--sea-ink-soft)] hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </header>

      <main className="flex-1 px-6 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--sea-ink)]">
            Whiteboards
          </h2>
          <div className="flex items-center gap-2">
            {showImport && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleImport()
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={importInputRef}
                  type="text"
                  value={importId}
                  onChange={(e) => setImportId(e.target.value)}
                  placeholder="Board ID"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowImport(false)
                      setImportId('')
                      setImportName('')
                    }
                  }}
                  className="w-48 rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-1.5 font-mono text-[var(--sea-ink)] focus:border-[var(--lagoon)] focus:outline-none focus:ring-1 focus:ring-[var(--lagoon)]"
                />
                <input
                  type="text"
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  placeholder="Name (optional)"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowImport(false)
                      setImportId('')
                      setImportName('')
                    }
                  }}
                  className="w-36 rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-1.5 text-[var(--sea-ink)] focus:border-[var(--lagoon)] focus:outline-none focus:ring-1 focus:ring-[var(--lagoon)]"
                />
              </form>
            )}
            <button
              onClick={() => {
                if (showImport) {
                  handleImport()
                } else {
                  setShowImport(true)
                }
              }}
              disabled={importing || loading}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-4 py-2 font-medium text-[var(--sea-ink)] hover:bg-[var(--link-bg-hover)] disabled:opacity-50"
            >
              <Import size={16} />
              {importing ? 'Importing...' : 'Import board'}
            </button>
            {showNameInput && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleCreate()
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={nameInputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Board name"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowNameInput(false)
                      setNewName('')
                    }
                  }}
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-1.5 text-[var(--sea-ink)] focus:border-[var(--lagoon)] focus:outline-none focus:ring-1 focus:ring-[var(--lagoon)]"
                />
              </form>
            )}
            <button
              onClick={() => {
                if (showNameInput) {
                  handleCreate()
                } else {
                  setShowNameInput(true)
                }
              }}
              disabled={creating || loading}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--lagoon-deep)] px-4 py-2 font-medium text-white hover:bg-[var(--lagoon)] disabled:opacity-50"
            >
              <Plus size={16} />
              {creating ? 'Creating...' : 'New whiteboard'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-[var(--sea-ink-soft)]">Loading whiteboards...</p>
          </div>
        ) : boards.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <p className="text-lg text-[var(--sea-ink-soft)]">
              No whiteboards yet
            </p>
            <p className="text-[var(--sea-ink-soft)]">
              Create your first whiteboard to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
            {boards.map((board) => (
              <BoardCard
                key={board.id}
                board={board}
                nc={ncRef.current}
                onRename={(id, name) => {
                  setBoards((prev) =>
                    prev.map((b) => (b.id === id ? { ...b, name } : b)),
                  )
                }}
                onDelete={(id) => {
                  setBoards((prev) => prev.filter((b) => b.id !== id))
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
