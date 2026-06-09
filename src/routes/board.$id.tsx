import { createFileRoute } from '@tanstack/react-router'
import { Whiteboard } from '#/components/whiteboard'

export const Route = createFileRoute('/board/$id')({
  component: BoardPage,
  validateSearch: (search: Record<string, unknown>) => ({
    jsPrefix: (search.jsPrefix as string) || undefined,
    deliverPrefix: (search.deliverPrefix as string) || undefined,
  }),
})

function BoardPage() {
  const { id } = Route.useParams()
  const { jsPrefix, deliverPrefix } = Route.useSearch()
  return <Whiteboard id={id} jsPrefix={jsPrefix} deliverPrefix={deliverPrefix} />
}
