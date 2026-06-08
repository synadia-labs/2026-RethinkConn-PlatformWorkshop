package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"

	"github.com/synadia-io/control-plane-sdk-go/syncp"
)

type signupHandler struct {
	cpBaseURL          string
	serviceAccountNKey string
}

type signupRequest struct {
	Token string `json:"token"`
	TeamID string `json:"team_id,omitempty"`
	CpURL  string `json:"cp_url,omitempty"`
}

type signupResponse struct {
	AccountID        string `json:"account_id"`
	AccountPublicKey string `json:"account_public_key"`
	Creds            string `json:"creds"`
}

func (h *signupHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	log.Printf("signup: request: token=%s... team_id=%q cp_url=%q", req.Token[:min(len(req.Token), 10)], req.TeamID, req.CpURL)
	if req.Token == "" {
		http.Error(w, "token is required", http.StatusBadRequest)
		return
	}

	cpURL := h.cpBaseURL
	if req.CpURL != "" {
		cpURL = req.CpURL
	}
	ctx := h.cpContext(r.Context(), req.Token, cpURL)
	client := syncp.NewAPIClient(syncp.NewConfiguration())

	teamID, err := h.resolveTeam(ctx, client, req.TeamID)
	if err != nil {
		log.Printf("signup: resolve team: %s", apiError(err))
		http.Error(w, fmt.Sprintf("failed to resolve team: %v", err), http.StatusBadRequest)
		return
	}

	systemID, err := h.findNGSSystem(ctx, client, teamID)
	if err != nil {
		log.Printf("signup: find NGS system: %s", apiError(err))
		http.Error(w, fmt.Sprintf("failed to find NGS system: %v", err), http.StatusBadRequest)
		return
	}

	account, err := h.createAccount(ctx, client, systemID)
	if err != nil {
		log.Printf("signup: create account: %s", apiError(err))
		http.Error(w, fmt.Sprintf("failed to create account: %v", err), http.StatusInternalServerError)
		return
	}

	if err := h.createServiceImport(ctx, client, account.Id); err != nil {
		log.Printf("signup: create service import: %s", apiError(err))
		http.Error(w, fmt.Sprintf("failed to configure imports: %v", err), http.StatusInternalServerError)
		return
	}

	jwt, userID, err := h.createBrowserUser(ctx, client, account.Id)
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
		AccountID:        account.Id,
		AccountPublicKey: ptrVal(account.AccountPublicKey),
		Creds:            creds,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)

	log.Printf("signup: created account %s (%s) for team %s", account.Name, account.Id, teamID)
	_ = jwt
}

func (h *signupHandler) cpContext(parent context.Context, token string, baseURL string) context.Context {
	ctx := context.WithValue(parent, syncp.ContextServerVariables, map[string]string{
		"baseUrl": baseURL,
	})
	return context.WithValue(ctx, syncp.ContextAccessToken, token)
}

func (h *signupHandler) resolveTeam(ctx context.Context, client *syncp.APIClient, teamID string) (string, error) {
	if teamID != "" {
		return teamID, nil
	}
	teams, _, err := client.SessionAPI.ListTeams(ctx).Execute()
	if err != nil {
		return "", fmt.Errorf("list teams: %w", err)
	}
	if len(teams.Items) == 0 {
		return "", fmt.Errorf("no teams found")
	}
	if len(teams.Items) > 1 {
		return "", fmt.Errorf("multiple teams found, please specify team_id")
	}
	return teams.Items[0].Id, nil
}

func (h *signupHandler) findNGSSystem(ctx context.Context, client *syncp.APIClient, teamID string) (string, error) {
	systems, _, err := client.TeamAPI.ListTeamSystems(ctx, teamID).Execute()
	if err != nil {
		return "", fmt.Errorf("list systems: %w", err)
	}
	for _, s := range systems.Items {
		if s.Name == "NGS" {
			return s.Id, nil
		}
	}
	return "", fmt.Errorf("no NGS system found in team")
}

func (h *signupHandler) createAccount(ctx context.Context, client *syncp.APIClient, systemID string) (*syncp.AccountViewResponse, error) {
	account, _, err := client.SystemAPI.CreateAccount(ctx, systemID).
		AccountCreateRequest(syncp.AccountCreateRequest{
			Name: "sygma",
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
						Conn:    syncp.Ptr(int64(10)),
						Leaf:    syncp.Ptr(int64(0)),
						Imports: syncp.Ptr(int64(10)),
						Exports: syncp.Ptr(int64(2)),
					},
					TieredLimits: map[string]syncp.JetStreamLimits{
						"R1": {
							DiskStorage:        syncp.Ptr(int64(100 * 1024 * 1024)), // 100 MiB
							DiskMaxStreamBytes: syncp.Ptr(int64(100 * 1024 * 1024)), // 100 MiB per stream
							Streams:            syncp.Ptr(int64(2)),
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
	_, _, err := client.AccountAPI.CreateSubjectImport(ctx, accountID).
		SubjectImportCreateRequest(syncp.SubjectImportCreateRequest{
			JwtSettings: syncp.Import{
				Account: &h.serviceAccountNKey,
				Subject: syncp.Ptr("sygma.>"),
				Type:    &serviceType,
			},
		}).Execute()
	if err != nil {
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
