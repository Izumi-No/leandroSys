package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"leandrosys/printd/internal/config"
)

func TestClaimUsesApiPayloadContract(t *testing.T) {
	const printerID = "550e8400-e29b-41d4-a716-446655440000"
	const agentID = "agent-local-123"

	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if r.Method != http.MethodPost {
			t.Errorf("método = %q, esperado POST", r.Method)
		}
		if r.URL.Path != "/api/print-jobs/claim" {
			t.Errorf("caminho = %q, inesperado", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer token-de-teste" {
			t.Errorf("Authorization = %q, inesperado", got)
		}

		var payload struct {
			PrinterID string `json:"printerId"`
			AgentID   string `json:"agentId"`
			Limit     int    `json:"limit"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decodificar payload: %v", err)
		}
		if payload.PrinterID != printerID || payload.AgentID != agentID || payload.Limit != 8 {
			t.Errorf("payload = %+v, contrato inesperado", payload)
		}

		w.Header().Set("Content-Type", "application/json")
		if requestCount == 1 {
			_, _ = w.Write([]byte(`{"jobs":[]}`))
			return
		}
		_, _ = w.Write([]byte(`{"jobs":[{"id":"job-1","kind":"ORDER","status":"PRINTING","attempts":1,"data":"YQ==","printerId":"550e8400-e29b-41d4-a716-446655440000","columns":48,"codepage":0}]}`))
	}))
	defer server.Close()

	store, err := config.Abrir(filepath.Join(t.TempDir(), "printd.json"))
	if err != nil {
		t.Fatalf("abrir config: %v", err)
	}
	if err := store.Update(func(config *config.Arquivo) {
		config.APIURL = server.URL + "/api"
	}); err != nil {
		t.Fatalf("atualizar config: %v", err)
	}

	client := Novo(store)
	client.token = "token-de-teste"
	jobs, err := client.Claim(context.Background(), printerID, agentID, 8)
	if err != nil {
		t.Fatalf("claim vazio: %v", err)
	}
	if len(jobs) != 0 {
		t.Fatalf("jobs = %d, esperado 0", len(jobs))
	}

	jobs, err = client.Claim(context.Background(), printerID, agentID, 8)
	if err != nil {
		t.Fatalf("claim com job: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("jobs = %d, esperado 1", len(jobs))
	}
	if job := jobs[0]; job.ID != "job-1" || job.PrinterID != printerID || job.Columns != 48 || job.Data != "YQ==" {
		t.Fatalf("job decodificado = %+v, contrato inesperado", job)
	}
}
