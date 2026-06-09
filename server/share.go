package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/nats-io/nats.go/micro"
	"github.com/synadia-io/control-plane-sdk-go/syncp"
)

type shareService struct {
	cpBaseURL string
	cpPAT     string
	systemID  string
}

type shareRequest struct {
	OwnerAccountID string `json:"owner_account_id"`
	RecipientName  string `json:"recipient_name"`
	BoardID        string `json:"board_id"`
}

type shareResponse struct {
	OK            bool   `json:"ok"`
	Error         string `json:"error,omitempty"`
	JsPrefix      string `json:"js_prefix,omitempty"`
	DeliverPrefix string `json:"deliver_prefix,omitempty"`
}

type listSharedRequest struct {
	AccountID string `json:"account_id"`
}

type sharedBoard struct {
	StreamName string `json:"stream_name"`
	BoardName  string `json:"board_name"`
	JsPrefix   string `json:"js_prefix"`
}

type listSharedResponse struct {
	Boards []sharedBoard `json:"boards"`
	Error  string        `json:"error,omitempty"`
}

func (s *shareService) handleShare(req micro.Request) {
	var r shareRequest
	if err := json.Unmarshal(req.Data(), &r); err != nil {
		req.RespondJSON(shareResponse{Error: "invalid request"})
		return
	}
	if r.OwnerAccountID == "" || r.RecipientName == "" || r.BoardID == "" {
		req.RespondJSON(shareResponse{Error: "owner_account_id, recipient_name, and board_id are required"})
		return
	}

	streamName := "whiteboard_" + r.BoardID
	ctx := s.cpContext()
	client := syncp.NewAPIClient(syncp.NewConfiguration())

	ownerNkey, err := s.getAccountNkey(ctx, client, r.OwnerAccountID)
	if err != nil {
		log.Printf("share: get owner nkey: %s", apiError(err))
		req.RespondJSON(shareResponse{Error: "failed to find owner account"})
		return
	}

	export, err := s.ensureStreamExport(ctx, client, r.OwnerAccountID, streamName)
	if err != nil {
		log.Printf("share: create stream export: %s", apiError(err))
		req.RespondJSON(shareResponse{Error: fmt.Sprintf("failed to create stream export: %v", err)})
		return
	}

	recipientAccountName := "sygma-" + strings.ToLower(r.RecipientName)
	recipientAccountID, err := s.findAccountByName(ctx, client, recipientAccountName)
	if err != nil {
		log.Printf("share: find recipient account: %s", apiError(err))
		req.RespondJSON(shareResponse{Error: fmt.Sprintf("user %q not found", r.RecipientName)})
		return
	}

	recipientNkey, err := s.getAccountNkey(ctx, client, recipientAccountID)
	if err != nil {
		log.Printf("share: get recipient nkey: %s", apiError(err))
		req.RespondJSON(shareResponse{Error: "failed to find recipient account"})
		return
	}

	if err := s.ensureStreamShare(ctx, client, export.Id, recipientNkey); err != nil {
		log.Printf("share: share stream export: %s", apiError(err))
		req.RespondJSON(shareResponse{Error: fmt.Sprintf("failed to share stream export: %v", err)})
		return
	}

	streamImport, err := s.ensureStreamImport(ctx, client, recipientAccountID, ownerNkey, streamName, export.JsSubjectPrefix, export.DeliverSubjectPrefix)
	if err != nil {
		log.Printf("share: create stream import: %s", apiError(err))
		req.RespondJSON(shareResponse{Error: fmt.Sprintf("failed to create stream import: %v", err)})
		return
	}

	log.Printf("share: %s shared board %s (stream %s) with %s", r.OwnerAccountID, r.BoardID, streamName, recipientAccountName)
	req.RespondJSON(shareResponse{
		OK:            true,
		JsPrefix:      streamImport.JsSubjectPrefix,
		DeliverPrefix: streamImport.DeliverSubject,
	})
}

func (s *shareService) handleListShared(req micro.Request) {
	var r listSharedRequest
	if len(req.Data()) > 0 {
		if err := json.Unmarshal(req.Data(), &r); err != nil {
			req.RespondJSON(listSharedResponse{Error: "invalid request"})
			return
		}
	}
	if r.AccountID == "" {
		req.RespondJSON(listSharedResponse{Error: "account_id is required"})
		return
	}

	ctx := s.cpContext()
	client := syncp.NewAPIClient(syncp.NewConfiguration())

	imports, _, err := client.AccountAPI.ListStreamImports(ctx, r.AccountID).Execute()
	if err != nil {
		log.Printf("list-shared: list stream imports: %s", apiError(err))
		req.RespondJSON(listSharedResponse{Error: "failed to list shared boards"})
		return
	}

	var boards []sharedBoard
	for _, imp := range imports.Items {
		if !strings.HasPrefix(imp.StreamName, "whiteboard_") {
			continue
		}
		boardName := imp.StreamName
		ownerAccountID, err := s.findAccountByNkey(ctx, client, imp.RemoteAccountNkeyPublic)
		if err == nil {
			if name, err := s.getStreamDescription(ctx, client, ownerAccountID, imp.StreamName); err == nil && name != "" {
				boardName = name
			}
		}
		boards = append(boards, sharedBoard{
			StreamName: imp.StreamName,
			BoardName:  boardName,
			JsPrefix:   imp.JsSubjectPrefix,
		})
	}

	req.RespondJSON(listSharedResponse{Boards: boards})
}

func (s *shareService) cpContext() context.Context {
	ctx := context.WithValue(context.Background(), syncp.ContextServerVariables, map[string]string{
		"baseUrl": s.cpBaseURL,
	})
	return context.WithValue(ctx, syncp.ContextAccessToken, s.cpPAT)
}

func (s *shareService) getAccountNkey(ctx context.Context, client *syncp.APIClient, accountID string) (string, error) {
	account, _, err := client.AccountAPI.GetAccount(ctx, accountID).Execute()
	if err != nil {
		return "", fmt.Errorf("get account: %w", err)
	}
	return ptrVal(account.AccountPublicKey), nil
}

func (s *shareService) findAccountByName(ctx context.Context, client *syncp.APIClient, accountName string) (string, error) {
	accounts, _, err := client.SystemAPI.ListAccounts(ctx, s.systemID).Execute()
	if err != nil {
		return "", fmt.Errorf("list accounts: %w", err)
	}
	for _, a := range accounts.Items {
		if a.Name == accountName {
			return a.Id, nil
		}
	}
	return "", fmt.Errorf("account %q not found", accountName)
}

func (s *shareService) findAccountByNkey(ctx context.Context, client *syncp.APIClient, nkey string) (string, error) {
	accounts, _, err := client.SystemAPI.ListAccounts(ctx, s.systemID).Execute()
	if err != nil {
		return "", fmt.Errorf("list accounts: %w", err)
	}
	for _, a := range accounts.Items {
		if ptrVal(a.AccountPublicKey) == nkey {
			return a.Id, nil
		}
	}
	return "", fmt.Errorf("account with nkey not found")
}

func (s *shareService) getStreamDescription(ctx context.Context, client *syncp.APIClient, accountID string, streamName string) (string, error) {
	streams, _, err := client.AccountAPI.ListStreams(ctx, accountID).Execute()
	if err != nil {
		return "", err
	}
	for _, st := range streams.Items {
		if st.Config.Name == streamName {
			return ptrVal(st.Config.Description), nil
		}
	}
	return "", fmt.Errorf("stream %q not found", streamName)
}

func (s *shareService) ensureStreamExport(ctx context.Context, client *syncp.APIClient, accountID string, streamName string) (*syncp.StreamExportViewResponse, error) {
	exports, _, err := client.AccountAPI.ListStreamExports(ctx, accountID).Execute()
	if err == nil {
		for _, e := range exports.Items {
			if e.StreamName == streamName {
				return &e, nil
			}
		}
	}

	export, _, err := client.AccountAPI.CreateStreamExport(ctx, accountID).
		StreamExportCreateRequest(syncp.StreamExportCreateRequest{
			StreamName: streamName,
			IsPublic:   false,
		}).Execute()
	if err != nil {
		return nil, fmt.Errorf("create stream export: %w", err)
	}
	return export, nil
}

func (s *shareService) ensureStreamShare(ctx context.Context, client *syncp.APIClient, streamExportID string, targetNkey string) error {
	shares, _, err := client.StreamExportAPI.ListStreamShares(ctx, streamExportID).Execute()
	if err == nil {
		for _, sh := range shares.Items {
			if sh.TargetAccountNkeyPublic == targetNkey {
				return nil
			}
		}
	}

	_, _, err = client.StreamExportAPI.CreateStreamShares(ctx, streamExportID).
		StreamShareCreateRequest(syncp.StreamShareCreateRequest{
			TargetAccountNkeyPublic: targetNkey,
		}).Execute()
	if err != nil {
		return fmt.Errorf("create stream share: %w", err)
	}
	return nil
}

func (s *shareService) ensureStreamImport(ctx context.Context, client *syncp.APIClient, accountID string, remoteNkey string, streamName string, jsPrefix string, deliverPrefix string) (*syncp.StreamImportViewResponse, error) {
	imports, _, err := client.AccountAPI.ListStreamImports(ctx, accountID).Execute()
	if err == nil {
		for _, i := range imports.Items {
			if i.StreamName == streamName && i.RemoteAccountNkeyPublic == remoteNkey {
				return &i, nil
			}
		}
	}

	streamImport, _, err := client.AccountAPI.CreateStreamImport(ctx, accountID).
		StreamImportCreateRequest(syncp.StreamImportCreateRequest{
			StreamName:              streamName,
			RemoteAccountNkeyPublic: remoteNkey,
			JsSubjectPrefix:        jsPrefix,
			DeliverSubjectPrefix:    deliverPrefix,
			IsPublic:                false,
		}).Execute()
	if err != nil {
		return nil, fmt.Errorf("create stream import: %w", err)
	}
	return streamImport, nil
}
