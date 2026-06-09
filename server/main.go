package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/micro"
)

//go:embed dist
var staticFS embed.FS

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("%s is required", key)
	}
	return v
}

func main() {
	addr := envOr("ADDR", ":8080")
	natsURL := envOr("NATS_URL", "nats://nats.ngs.synadia-test.com:4222")
	natsCreds := requireEnv("NATS_CREDS")
	cpBaseURL := envOr("CP_URL", "https://cloud.synadia.com")
	cpPAT := requireEnv("CP_PAT")
	cpSystemID := requireEnv("CP_SYSTEM_ID")
	serviceAccountNKey := requireEnv("SERVICE_ACCOUNT_NKEY")

	nc, err := nats.Connect(natsURL, nats.UserCredentials(natsCreds), nats.Name("sygma-server"))
	if err != nil {
		log.Fatalf("failed to connect to NATS: %v", err)
	}
	defer nc.Close()
	log.Printf("connected to NATS at %s", nc.ConnectedUrl())

	share := &shareService{
		cpBaseURL: cpBaseURL,
		cpPAT:     cpPAT,
		systemID:  cpSystemID,
	}

	svc, err := micro.AddService(nc, micro.Config{
		Name:        "sygma",
		Version:     "0.1.0",
		Description: "Sygma whiteboard service",
	})
	if err != nil {
		log.Fatalf("failed to create micro service: %v", err)
	}
	defer svc.Stop()

	g := svc.AddGroup("sygma.whiteboard")
	if err := g.AddEndpoint("share", micro.HandlerFunc(share.handleShare)); err != nil {
		log.Fatalf("failed to add share endpoint: %v", err)
	}
	if err := g.AddEndpoint("list-shared", micro.HandlerFunc(share.handleListShared)); err != nil {
		log.Fatalf("failed to add list-shared endpoint: %v", err)
	}
	if err := g.AddEndpoint("unshare", micro.HandlerFunc(share.handleUnshare)); err != nil {
		log.Fatalf("failed to add unshare endpoint: %v", err)
	}
	if err := g.AddEndpoint("delete", micro.HandlerFunc(share.handleDelete)); err != nil {
		log.Fatalf("failed to add delete endpoint: %v", err)
	}
	log.Print("sygma micro service started")

	signup := &signupHandler{
		cpBaseURL:          cpBaseURL,
		cpPAT:              cpPAT,
		systemID:           cpSystemID,
		serviceAccountNKey: serviceAccountNKey,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/signup", signup.ServeHTTP)

	dist, err := fs.Sub(staticFS, "dist")
	if err != nil {
		log.Fatalf("failed to create sub filesystem: %v", err)
	}
	fileServer := http.FileServer(http.FS(dist))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		f, err := dist.(fs.ReadFileFS).ReadFile(r.URL.Path[1:])
		if err != nil || len(f) == 0 {
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})

	log.Printf("listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
