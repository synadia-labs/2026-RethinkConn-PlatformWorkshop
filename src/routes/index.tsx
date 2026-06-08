import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
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
    </main>
  )
}
