package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"

	"github.com/nats-io/nats.go"
)

//go:embed dist
var staticFS embed.FS

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	natsURL := flag.String("nats", nats.DefaultURL, "NATS server URL")
	flag.Parse()

	nc, err := nats.Connect(*natsURL)
	if err != nil {
		log.Fatalf("failed to connect to NATS: %v", err)
	}
	defer nc.Close()
	log.Printf("connected to NATS at %s", nc.ConnectedUrl())

	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/signup", func(w http.ResponseWriter, r *http.Request) {
		// TODO: accept Control Plane token, configure imports, create user credentials, set cookie
		http.Error(w, "not implemented", http.StatusNotImplemented)
	})

	dist, err := fs.Sub(staticFS, "dist")
	if err != nil {
		log.Fatalf("failed to create sub filesystem: %v", err)
	}
	fileServer := http.FileServer(http.FS(dist))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// SPA fallback: serve index.html for paths that don't match a static file
		f, err := dist.(fs.ReadFileFS).ReadFile(r.URL.Path[1:])
		if err != nil || len(f) == 0 {
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})

	log.Printf("listening on %s", *addr)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
