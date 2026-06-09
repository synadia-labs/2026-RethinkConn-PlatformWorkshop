package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/synadia-io/control-plane-sdk-go/syncp"
)

type signupHandler struct {
	cpBaseURL          string
	cpPAT              string
	systemID           string
	serviceAccountNKey string
}

type signupRequest struct {
	Name string `json:"name"`
}

type signupResponse struct {
	AccountID string `json:"account_id"`
	Creds     string `json:"creds"`
}

var validName = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func (h *signupHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if !validName.MatchString(req.Name) {
		http.Error(w, "name must contain only letters, numbers, hyphens, and underscores", http.StatusBadRequest)
		return
	}
	log.Printf("signup: request: name=%q", req.Name)

	ctx := h.cpContext(r.Context())
	client := syncp.NewAPIClient(syncp.NewConfiguration())

	accountName := "sygma-" + strings.ToLower(req.Name)

	account, err := h.findExistingAccount(ctx, client, accountName)
	if err != nil {
		log.Printf("signup: find existing account: %s", apiError(err))
		http.Error(w, fmt.Sprintf("failed to check existing account: %v", err), http.StatusInternalServerError)
		return
	}

	if account != nil {
		log.Printf("signup: found existing account %s (%s)", account.Name, account.Id)
		userID, err := h.findBrowserUser(ctx, client, account.Id)
		if err != nil {
			log.Printf("signup: find browser user: %s", apiError(err))
			http.Error(w, fmt.Sprintf("failed to find browser user: %v", err), http.StatusInternalServerError)
			return
		}
		creds, err := h.downloadCreds(ctx, client, userID)
		if err != nil {
			log.Printf("signup: download creds: %s", apiError(err))
			http.Error(w, fmt.Sprintf("failed to download creds: %v", err), http.StatusInternalServerError)
			return
		}
		resp := signupResponse{
			AccountID: account.Id,
			Creds:     creds,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		return
	}

	newAccount, err := h.createAccount(ctx, client, accountName)
	if err != nil {
		log.Printf("signup: create account: %s", apiError(err))
		http.Error(w, fmt.Sprintf("failed to create account: %v", err), http.StatusInternalServerError)
		return
	}

	if err := h.createServiceImport(ctx, client, newAccount.Id); err != nil {
		log.Printf("signup: create service import: %s", apiError(err))
		http.Error(w, fmt.Sprintf("failed to configure imports: %v", err), http.StatusInternalServerError)
		return
	}

	_, userID, err := h.createBrowserUser(ctx, client, newAccount.Id)
	if err != nil {
		log.Printf("signup: create browser user: %s", apiError(err))
		http.Error(w, fmt.Sprintf("failed to create user: %v", err), http.StatusInternalServerError)
		return
	}

	creds, err := h.downloadCreds(ctx, client, userID)
	if err != nil {
		log.Printf("signup: download creds: %s", apiError(err))
		http.Error(w, fmt.Sprintf("failed to download creds: %v", err), http.StatusInternalServerError)
		return
	}

	resp := signupResponse{
		AccountID: newAccount.Id,
		Creds:     creds,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)

	log.Printf("signup: created account %s (%s)", newAccount.Name, newAccount.Id)
}

func (h *signupHandler) cpContext(parent context.Context) context.Context {
	ctx := context.WithValue(parent, syncp.ContextServerVariables, map[string]string{
		"baseUrl": h.cpBaseURL,
	})
	return context.WithValue(ctx, syncp.ContextAccessToken, h.cpPAT)
}

func (h *signupHandler) findExistingAccount(ctx context.Context, client *syncp.APIClient, accountName string) (*syncp.AccountViewResponse, error) {
	accounts, _, err := client.SystemAPI.ListAccounts(ctx, h.systemID).Execute()
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	for _, a := range accounts.Items {
		if a.Name == accountName {
			return &a, nil
		}
	}
	return nil, nil
}

func (h *signupHandler) findBrowserUser(ctx context.Context, client *syncp.APIClient, accountID string) (string, error) {
	users, _, err := client.AccountAPI.ListUsers(ctx, accountID).Execute()
	if err != nil {
		return "", fmt.Errorf("list users: %w", err)
	}
	for _, u := range users.Items {
		if u.Name == "sygma-browser" {
			return u.Id, nil
		}
	}
	return "", fmt.Errorf("sygma-browser user not found")
}

func (h *signupHandler) createAccount(ctx context.Context, client *syncp.APIClient, accountName string) (*syncp.AccountViewResponse, error) {
	account, _, err := client.SystemAPI.CreateAccount(ctx, h.systemID).
		AccountCreateRequest(syncp.AccountCreateRequest{
			Name: accountName,
			JwtSettings: &syncp.AccountJWTSettings{
				Info: syncp.Info{
					Description: syncp.Ptr("Sygma whiteboard account"),
				},
				Limits: &syncp.OperatorLimits{
					NatsLimits: syncp.NatsLimits{
						Subs:    syncp.Ptr(int64(100)),
						Payload: syncp.Ptr(int64(1024 * 1024)), // 1 MiB
					},
					AccountLimits: syncp.AccountLimits{
						Conn:      syncp.Ptr(int64(10)),
						Leaf:      syncp.Ptr(int64(0)),
						Imports:   syncp.Ptr(int64(10)),
						Exports:   syncp.Ptr(int64(2)),
						Wildcards: syncp.Ptr(true),
					},
					TieredLimits: map[string]syncp.JetStreamLimits{
						"R1": {
							DiskStorage:        syncp.Ptr(int64(100 * 1024 * 1024)), // 100 MiB
							DiskMaxStreamBytes: syncp.Ptr(int64(10 * 1024 * 1024)),  // 10 MiB per stream
							Streams:            syncp.Ptr(int64(10)),
							Consumer:           syncp.Ptr(int64(2)),
						},
					},
				},
			},
		}).Execute()
	if err != nil {
		return nil, fmt.Errorf("create account: %w", err)
	}
	return account, nil
}

func (h *signupHandler) createServiceImport(ctx context.Context, client *syncp.APIClient, accountID string) error {
	serviceType := syncp.EXPORTTYPE_SERVICE
	_, resp, err := client.AccountAPI.CreateSubjectImport(ctx, accountID).
		SubjectImportCreateRequest(syncp.SubjectImportCreateRequest{
			JwtSettings: syncp.Import{
				Account: &h.serviceAccountNKey,
				Subject: syncp.Ptr("sygma.>"),
				Type:    &serviceType,
			},
		}).Execute()
	if err != nil && (resp == nil || resp.StatusCode >= 300) {
		return fmt.Errorf("create subject import: %w", err)
	}
	return nil
}

func (h *signupHandler) createBrowserUser(ctx context.Context, client *syncp.APIClient, accountID string) (jwt string, userID string, err error) {
	skGroup, _, err := client.AccountAPI.CreateAccountSkGroup(ctx, accountID).
		SigningKeyGroupCreateRequest(syncp.SigningKeyGroupCreateRequest{
			Name: "sygma-browser",
		}).Execute()
	if err != nil {
		return "", "", fmt.Errorf("create signing key group: %w", err)
	}
	skGroupID := skGroup.Id

	user, _, err := client.AccountAPI.CreateUser(ctx, accountID).
		NatsUserCreateRequest(syncp.NatsUserCreateRequest{
			Name:      "sygma-browser",
			SkGroupId: skGroupID,
			JwtSettings: &syncp.NatsCreateUserJwtSettings{
				BearerToken:            syncp.Ptr(true),
				AllowedConnectionTypes: []string{"WEBSOCKET"},
				Subs:                   syncp.Ptr(int64(-1)),
				Payload:                syncp.Ptr(int64(-1)),
				Data:                   syncp.Ptr(int64(-1)),
			},
		}).Execute()
	if err != nil {
		return "", "", fmt.Errorf("create user: %w", err)
	}

	return user.Jwt, user.Id, nil
}

func (h *signupHandler) downloadCreds(ctx context.Context, client *syncp.APIClient, userID string) (string, error) {
	creds, _, err := client.NatsUserAPI.DownloadNatsUserCreds(ctx, userID).Execute()
	if err != nil {
		return "", fmt.Errorf("download creds: %w", err)
	}
	return creds, nil
}

func apiError(err error) string {
	var apiErr *syncp.GenericOpenAPIError
	if errors.As(err, &apiErr) {
		return fmt.Sprintf("%s: %s", apiErr.Error(), string(apiErr.Body()))
	}
	return err.Error()
}

func ptrVal[T any](p *T) T {
	if p == nil {
		var zero T
		return zero
	}
	return *p
}
