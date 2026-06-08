import { createFileRoute } from '@tanstack/react-router'
import { Whiteboard } from '#/components/whiteboard'

export const Route = createFileRoute('/board/$id')({
  component: BoardPage,
})

function BoardPage() {
  const { id } = Route.useParams()
  return <Whiteboard id={id} />
}
