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
	cpBaseURL := flag.String("cp-url", "https://cloud.synadia.com", "Synadia Control Plane base URL")
	serviceAccountNKey := flag.String("service-account-nkey", "", "Public NKey of the service account (for imports)")
	jwtCookieName := flag.String("jwt-cookie", "nats_jwt", "Name of the HTTP cookie for the NATS bearer JWT")
	flag.Parse()

	if *serviceAccountNKey == "" {
		log.Fatal("-service-account-nkey is required")
	}

	nc, err := nats.Connect(*natsURL)
	if err != nil {
		log.Fatalf("failed to connect to NATS: %v", err)
	}
	defer nc.Close()
	log.Printf("connected to NATS at %s", nc.ConnectedUrl())

	signup := &signupHandler{
		cpBaseURL:          *cpBaseURL,
		serviceAccountNKey: *serviceAccountNKey,
		jwtCookieName:      *jwtCookieName,
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

	log.Printf("listening on %s", *addr)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
