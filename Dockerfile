FROM node:24-slim AS frontend
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM golang:1.26-bookworm AS backend
WORKDIR /app/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ .
COPY --from=frontend /app/server/dist ./dist
RUN CGO_ENABLED=0 go build -o sygma .

FROM gcr.io/distroless/static-debian12
COPY --from=backend /app/server/sygma /sygma
EXPOSE 8080
ENTRYPOINT ["/sygma"]
