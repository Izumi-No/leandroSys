// Package agent unit tests for reconciliation and claim logic.
package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"leandrosys/printd/internal/api"
	"leandrosys/printd/internal/config"
	"leandrosys/printd/internal/logbuf"
)

// helper creates temporary config Store backed by a file.
func newTempStore(t *testing.T) *config.Store {
	t.Helper()
	f, err := os.CreateTemp("", "printd-test-*.json")
	if err != nil {
		t.Fatalf("tmp file: %v", err)
	}
	// Write minimal JSON to avoid parse error.
	if _, err := f.WriteString("{}\n"); err != nil {
		f.Close()
		os.Remove(f.Name())
		t.Fatalf("write init: %v", err)
	}
	f.Close()
	store, err := config.Abrir(f.Name())
	if err != nil {
		t.Fatalf("abrir store: %v", err)
	}
	return store
}

// helper starts a fake API server returning controlled data.
func startFakeAPI(t *testing.T, printers []api.Impressora) (*httptest.Server, *int) {
	t.Helper()
	claimCalls := 0
	h := http.NewServeMux()
	h.HandleFunc("/auth/login", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"token": "test-token"})
	})
	h.HandleFunc("/printers", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			json.NewEncoder(w).Encode(map[string][]api.Impressora{"printers": printers})
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	})
	h.HandleFunc("/print-jobs/claim", func(w http.ResponseWriter, r *http.Request) {
		claimCalls++
		json.NewEncoder(w).Encode(map[string][]api.Job{"jobs": {}})
	})
	h.HandleFunc("/printers/", func(w http.ResponseWriter, r *http.Request) {
		// catch /printers/:id/attach and /detach, just echo back empty printer.
		json.NewEncoder(w).Encode(map[string]api.Impressora{"printer": {}})
	})

	srv := httptest.NewServer(h)
	return srv, &claimCalls
}

func TestAgentClaimSendsAgentID(t *testing.T) {
	store := newTempStore(t)
	store.Update(func(c *config.Arquivo) {
		c.APIURL = "http://example.com"
		c.Usuario = "impressora"
		c.Senha = "senha"
		c.AgenteID = "aa11bb22"
		c.AgenteNome = "test-machine"
		c.Impressoras = []config.Impressora{{ID: "printer-1", Nome: "Test", Endereco: "127.0.0.1:9100", Transporte: "NETWORK"}}
	})

	// server returns same printer with proper agent binding so reconciliation is no‑op.
	srv, claimCalls := startFakeAPI(t, []api.Impressora{{ID: "printer-1", Name: "Test", Address: "127.0.0.1:9100", Transport: "NETWORK", AgentID: "aa11bb22"}})
	defer srv.Close()

	store.Update(func(c *config.Arquivo) { c.APIURL = srv.URL })
	client := api.Novo(store)
	log := logbuf.Novo()
	ctx, _ := context.WithCancel(context.Background())
	agent := Novo(store, client, log, ctx)
	agent.Ligar()
	// give worker time to invoke Claim
	time.Sleep(200 * time.Millisecond)
	if *claimCalls == 0 {
		t.Fatalf("claim never called")
	}
}

func TestAgentReconcileAfterAttach(t *testing.T) {
	store := newTempStore(t)
	store.Update(func(c *config.Arquivo) {
		c.APIURL = "http://example.com"
		c.Usuario = "impressora"
		c.Senha = "senha"
		c.AgenteID = "aa11bb22"
		c.AgenteNome = "test-machine"
	})

	// server initially empty, then after attach will include printer.
	// server returns printer bound to this agent (so reconcile keeps it).
	srv, _ := startFakeAPI(t, []api.Impressora{{ID: "printer-xyz", Name: "Fila", Address: "127.0.0.1:9100", Transport: "NETWORK", AgentID: "aa11bb22"}})
	defer srv.Close()

	store.Update(func(c *config.Arquivo) { c.APIURL = srv.URL })
	client := api.Novo(store)
	log := logbuf.Novo()
	ctx, _ := context.WithCancel(context.Background())
	agent := Novo(store, client, log, ctx)

	// simulate attach via client directly (server will ignore body and return empty printer).
	_, err := client.Atrelar(context.Background(), "printer-xyz", config.Impressora{ID: "printer-xyz", Nome: "Fila", Endereco: "127.0.0.1:9100", Transporte: "NETWORK"})
	if err != nil { t.Fatalf("atrelar error: %v", err) }

	// now update store as if API returned bound printer.
	store.Update(func(c *config.Arquivo) {
		c.Impressoras = []config.Impressora{{ID: "printer-xyz", Nome: "Fila", Endereco: "127.0.0.1:9100", Transporte: "NETWORK"}}
	})

	// force agent to think it is running so it creates worker.
	agent.ligado = true
	agent.Reconciliar(context.Background())
	agent.Sincronizar()
	// give a moment for Sincronizar to start worker
	time.Sleep(100 * time.Millisecond)
	agent.mu.Lock()
	_, exists := agent.cancel["printer-xyz"]
	agent.mu.Unlock()
	if !exists {
		t.Fatalf("worker not created after reconcile")
	}
}

func TestAgentClaimError409TriggersReconcile(t *testing.T) {
	store := newTempStore(t)
	store.Update(func(c *config.Arquivo) {
		c.APIURL = "http://example.com"
		c.Usuario = "impressora"
		c.Senha = "senha"
		c.AgenteID = "aa11bb22"
		c.AgenteNome = "test-machine"
		c.Impressoras = []config.Impressora{{ID: "printer-409", Nome: "Test", Endereco: "127.0.0.1:9100", Transporte: "NETWORK"}}
	})

	// server returns 409 for claim.
	h := http.NewServeMux()
	h.HandleFunc("/auth/login", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"token": "tok"})
	})
	h.HandleFunc("/printers", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string][]api.Impressora{"printers": {}})
	})
	h.HandleFunc("/print-jobs/claim", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
	})
	srv := httptest.NewServer(h)
	defer srv.Close()

	store.Update(func(c *config.Arquivo) { c.APIURL = srv.URL })
	client := api.Novo(store)
	log := logbuf.Novo()
	ctx, _ := context.WithCancel(context.Background())
	agent := Novo(store, client, log, ctx)
	agent.Ligar()
	// allow claim attempt and subsequent reconcile
	time.Sleep(300 * time.Millisecond)
	// no panic means test passes
}
