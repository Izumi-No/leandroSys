// Package api é o cliente REST da API leandroSys, com login sob demanda
// (401 → login → repete uma vez). As credenciais vêm do config.Store, que é
// a fonte única de verdade do daemon.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"leandrosys/printd/internal/config"
)

// Job devolvido pelo claim (mesmo contrato da API).
type Job struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	Status    string  `json:"status"`
	Attempts  int     `json:"attempts"`
	Data      string  `json:"data"` // base64
	PrinterID string  `json:"printerId"`
	Columns   IntStr  `json:"columns"`
	Codepage  IntStr  `json:"codepage"`
}

type Impressora struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Address     string     `json:"address"`
	Transport   string     `json:"transport"`
	Columns     IntStr     `json:"columns"`
	Codepage    IntStr     `json:"codepage"`
	Active      BoolStr    `json:"active"`
	PendingJobs IntStr     `json:"pendingJobs"`
	Baud        IntStr     `json:"baud"`
	AgentID     string     `json:"agentId"`
	AgentName   string     `json:"agentName"`
	BoundAt     string     `json:"boundAt"` // timestamp Postgres, não RFC3339
}

// IntStr aceita tanto número quanto string no JSON (a API devolve columns/
// codepage/baud como string em alguns endpoints). Int() devolve 0 se vazio.
type IntStr int

func (i *IntStr) UnmarshalJSON(b []byte) error {
	s := strings.TrimSpace(string(b))
	if s == "" || s == "null" {
		*i = 0
		return nil
	}
	if n, err := strconv.Atoi(s); err == nil {
		*i = IntStr(n)
		return nil
	}
	*i = 0
	return nil
}

func (i IntStr) Int() int { return int(i) }

// BoolStr aceita tanto bool quanto string ("t"/"f"/"true"/"false") — o admin
// devolve active/printsBill como "t"/"f" em alguns endpoints.
type BoolStr bool

func (b *BoolStr) UnmarshalJSON(data []byte) error {
	s := strings.TrimSpace(string(data))
	switch s {
	case "true", "\"t\"", "\"true\"", "1":
		*b = true
	case "false", "\"f\"", "\"false\"", "0", "null", "":
		*b = false
	default:
		*b = false
	}
	return nil
}

func (b BoolStr) Bool() bool { return bool(b) }

type resultadoAck struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type respostaLogin struct {
	Token string `json:"token"`
}

type Erro struct {
	Status   int
	Mensagem string
	Codigo   string
}

func (e *Erro) Error() string { return fmt.Sprintf("HTTP %d: %s", e.Status, e.Mensagem) }

type Client struct {
	store *config.Store
	http  *http.Client
	mu    sync.Mutex
	token string
}

func Novo(store *config.Store) *Client {
	return &Client{
		store: store,
		http:  &http.Client{Timeout: 20 * time.Second},
	}
}

// Base devolve a base da API configurada.
func (c *Client) Base() string { return strings.TrimRight(c.store.Get().APIURL, "/") }

// Health bate no /health sem autenticação (para a UI mostrar "API ok").
func (c *Client) Health(ctx context.Context) error {
	base := c.Base()
	if base == "" {
		return fmt.Errorf("API não configurada")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil
}

// TestarCredenciais valida um conjunto candidato de credenciais SEM alterar o
// store nem a sessão atual (a UI testa antes de salvar a configuração).
func (c *Client) TestarCredenciais(ctx context.Context, apiURL, usuario, senha string) error {
	corpo, _ := json.Marshal(map[string]string{"username": usuario, "password": senha})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(apiURL, "/")+"/auth/login", bytes.NewReader(corpo))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return &Erro{Status: resp.StatusCode, Mensagem: "login recusado"}
	}
	var r respostaLogin
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return err
	}
	if r.Token == "" {
		return &Erro{Status: http.StatusUnauthorized, Mensagem: "resposta sem token"}
	}
	return nil
}

// LimparToken descarta a sessão (chamar quando as credenciais mudam).
func (c *Client) LimparToken() {
	c.mu.Lock()
	c.token = ""
	c.mu.Unlock()
}

func (c *Client) login(ctx context.Context) error {
	d := c.store.Get()
	if d.APIURL == "" || d.Usuario == "" {
		return fmt.Errorf("configuração incompleta (falta API/usuário)")
	}
	corpo, _ := json.Marshal(map[string]string{"username": d.Usuario, "password": d.Senha})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(d.APIURL, "/")+"/auth/login", bytes.NewReader(corpo))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return &Erro{Status: resp.StatusCode, Mensagem: "login recusado"}
	}
	var r respostaLogin
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return err
	}

	c.mu.Lock()
	c.token = r.Token
	c.mu.Unlock()
	return nil
}

// requisitar faz a chamada autenticada; em 401 faz login e repete uma vez.
func (c *Client) requisitar(ctx context.Context, metodo, rota string, corpo, saida any) error {
	err := c.executar(ctx, metodo, rota, corpo, saida)
	if err == nil {
		return nil
	}
	var apiErr *Erro
	if !asErro(err, &apiErr) || apiErr.Status != http.StatusUnauthorized {
		return err
	}
	// Sem token ou expirado: login e repete uma única vez.
	if errLogin := c.login(ctx); errLogin != nil {
		return errLogin
	}
	return c.executar(ctx, metodo, rota, corpo, saida)
}

func asErro(err error, alvo **Erro) bool {
	e, ok := err.(*Erro)
	if ok {
		*alvo = e
	}
	return ok
}

func (c *Client) executar(ctx context.Context, metodo, rota string, corpo, saida any) error {
	base := c.Base()
	if base == "" {
		return fmt.Errorf("API não configurada")
	}

	var leitor io.Reader
	if corpo != nil {
		bruto, err := json.Marshal(corpo)
		if err != nil {
			return err
		}
		leitor = bytes.NewReader(bruto)
	}

	req, err := http.NewRequestWithContext(ctx, metodo, base+rota, leitor)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	c.mu.Lock()
	tok := c.token
	c.mu.Unlock()
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	bruto, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 400 {
		var e struct {
			Error string `json:"error"`
			Code  string `json:"code"`
		}
		_ = json.Unmarshal(bruto, &e)
		if e.Error == "" {
			e.Error = strings.TrimSpace(string(bruto))
		}
		return &Erro{Status: resp.StatusCode, Mensagem: e.Error, Codigo: e.Code}
	}
	if saida != nil && len(bruto) > 0 {
		return json.Unmarshal(bruto, saida)
	}
	return nil
}

// Claim pega jobs da fila de uma impressora (limit padrão 8). A API recusa se
// a fila não estiver atrelada a este agente.
func (c *Client) Claim(ctx context.Context, printerID, agentID string, limit int) ([]Job, error) {
	var r struct {
		Jobs []Job `json:"jobs"`
	}
	err := c.requisitar(ctx, http.MethodPost, "/print-jobs/claim",
		map[string]any{"printerId": printerID, "agentId": agentID, "limit": limit}, &r)
	return r.Jobs, err
}

// Ack informa o resultado do envio físico (obrigatório até no erro).
func (c *Client) Ack(ctx context.Context, jobID string, ok bool, msgErro string) error {
	corpo := map[string]any{"success": ok}
	if msgErro != "" {
		if len(msgErro) > 500 {
			msgErro = msgErro[:500]
		}
		corpo["error"] = msgErro
	}
	var r resultadoAck
	return c.requisitar(ctx, http.MethodPost, "/print-jobs/"+jobID+"/ack", corpo, &r)
}

// Atrelar liga uma fila existente a este agente/dispositivo. A API guarda
// endereço, transporte e baud; a fila em si continua sendo criada no admin.
func (c *Client) Atrelar(ctx context.Context, printerID string, d config.Impressora) (Impressora, error) {
	cfg := c.store.Get()
	corpo := map[string]any{
		"agentId":   cfg.AgenteID,
		"agentName": cfg.AgenteNome,
		"address":   d.Endereco,
		"transport": d.Transporte,
	}
	if d.Transporte == "USB" {
		baud := d.Baud
		if baud == 0 {
			baud = 9600
		}
		corpo["baud"] = baud
	}

	var r struct {
		Printer Impressora `json:"printer"`
	}
	err := c.requisitar(ctx, http.MethodPost, "/printers/"+printerID+"/attach", corpo, &r)
	return r.Printer, err
}

// Desatrelar libera a fila no sistema (o daemon também a remove do config).
func (c *Client) Desatrelar(ctx context.Context, printerID string) (Impressora, error) {
	cfg := c.store.Get()
	var r struct {
		Printer Impressora `json:"printer"`
	}
	err := c.requisitar(ctx, http.MethodPost, "/printers/"+printerID+"/detach",
		map[string]any{"agentId": cfg.AgenteID}, &r)
	return r.Printer, err
}

func (c *Client) ListarImpressoras(ctx context.Context) ([]Impressora, error) {
	var r struct {
		Printers []Impressora `json:"printers"`
	}
	err := c.requisitar(ctx, http.MethodGet, "/printers", nil, &r)
	return r.Printers, err
}

func (c *Client) DeletarImpressora(ctx context.Context, id string) error {
	return c.requisitar(ctx, http.MethodDelete, "/printers/"+id, nil, nil)
}

// Get/Post/Delete genéricos (o smoke de E2E cria rotas e comandas).
func (c *Client) Get(ctx context.Context, rota string, saida any) error {
	return c.requisitar(ctx, http.MethodGet, rota, nil, saida)
}

func (c *Client) Post(ctx context.Context, rota string, corpo, saida any) error {
	return c.requisitar(ctx, http.MethodPost, rota, corpo, saida)
}

func (c *Client) Delete(ctx context.Context, rota string) error {
	return c.requisitar(ctx, http.MethodDelete, rota, nil, nil)
}
