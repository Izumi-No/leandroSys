// Package server expõe a API local do daemon em 127.0.0.1 — é o que o
// Electron (ou qualquer cliente na máquina) usa para observar e configurar.
// Todas as rotas exigem o header X-Printd-Token (gerado no 1º start).
package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"leandrosys/printd/internal/agent"
	"leandrosys/printd/internal/api"
	"leandrosys/printd/internal/bluez"
	"leandrosys/printd/internal/config"
	"leandrosys/printd/internal/logbuf"
	"leandrosys/printd/internal/transport"
)

type Server struct {
	store  *config.Store
	ag     *agent.Agent
	client *api.Client
	log    *logbuf.Ring

	mu        sync.Mutex
	healthOk  bool
	healthAte time.Time
}

func Novo(store *config.Store, ag *agent.Agent, client *api.Client, log *logbuf.Ring) *Server {
	return &Server{store: store, ag: ag, client: client, log: log}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /estado", s.estado)
	mux.HandleFunc("POST /config", s.salvarConfig)
	mux.HandleFunc("GET /dispositivos", s.dispositivos)
	mux.HandleFunc("GET /dispositivos/usb", s.dispositivosUSB)
	mux.HandleFunc("GET /filas", s.filas)
	mux.HandleFunc("POST /atrelar", s.atrelar)
	mux.HandleFunc("POST /desatrelar", s.desatrelar)
	mux.HandleFunc("POST /impressoras/{id}/teste", s.testar)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Header.Get("X-Printd-Token") != s.store.Get().Token {
			erroJSON(w, http.StatusUnauthorized, "token do daemon inválido")
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// -----------------------------------------------------------------------
// Estado (o que a UI faz polling a cada segundo)
// -----------------------------------------------------------------------

type estadoResposta struct {
	Configurado bool           `json:"configurado"`
	Config      configResumo   `json:"config"`
	AgenteID    string         `json:"agenteId"`
	AgenteNome  string         `json:"agenteNome"`
	Ligado      bool           `json:"ligado"`
	API         string         `json:"api"`
	APIOk       bool           `json:"apiOk"`
	Impressos   []agent.Estado `json:"estados"`
	Log         []logbuf.Linha `json:"log"`
}

type configResumo struct {
	APIURL  string `json:"apiUrl"`
	Usuario string `json:"usuario"`
	Senha   string `json:"senha"`
}

func (s *Server) estado(w http.ResponseWriter, _ *http.Request) {
	cfg := s.store.Get()
	snap := s.ag.Snapshot()

	resposta := estadoResposta{
		Configurado: s.store.Completo(),
		Config: configResumo{
			APIURL:  cfg.APIURL,
			Usuario: cfg.Usuario,
			Senha:   cfg.Senha,
		},
		AgenteID:   cfg.AgenteID,
		AgenteNome: cfg.AgenteNome,
		Ligado:     snap.Ligado,
		API:        snap.API,
		APIOk:      s.saudeAPI(),
		Impressos:  snap.Estados,
		Log:        s.log.Ultimas(60),
	}
	okJSON(w, http.StatusOK, resposta)
}

// saudeAPI bate no /health com cache curto (a UI faz polling a cada segundo).
func (s *Server) saudeAPI() bool {
	s.mu.Lock()
	if time.Now().Before(s.healthAte) {
		ok := s.healthOk
		s.mu.Unlock()
		return ok
	}
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	err := s.client.Health(ctx)
	cancel()

	s.mu.Lock()
	s.healthOk = err == nil
	s.healthAte = time.Now().Add(3 * time.Second)
	ok := s.healthOk
	s.mu.Unlock()
	return ok
}

// -----------------------------------------------------------------------
// Configuração inicial (uma única vez)
// -----------------------------------------------------------------------

func (s *Server) salvarConfig(w http.ResponseWriter, r *http.Request) {
	var pedido struct {
		APIURL  string `json:"apiUrl"`
		Usuario string `json:"usuario"`
		Senha   string `json:"senha"`
	}
	if !lerJSON(w, r, &pedido) {
		return
	}
	if pedido.APIURL == "" || pedido.Usuario == "" || pedido.Senha == "" {
		erroJSON(w, http.StatusBadRequest, "preencha API, usuário e senha")
		return
	}

	// Valida as credenciais ANTES de gravar qualquer coisa.
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	err := s.client.TestarCredenciais(ctx, pedido.APIURL, pedido.Usuario, pedido.Senha)
	cancel()
	if err != nil {
		erroJSON(w, http.StatusBadGateway, "credenciais recusadas pela API: "+erroTexto(err))
		return
	}

	if err := s.store.Update(func(c *config.Arquivo) {
		c.APIURL = strings.TrimRight(pedido.APIURL, "/")
		c.Usuario, c.Senha = pedido.Usuario, pedido.Senha
	}); err != nil {
		erroJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.client.LimparToken() // a sessão antiga não vale mais

	s.log.Add("configuração salva (API %s, usuário %s)", s.store.Get().APIURL, pedido.Usuario)
	if s.store.Completo() {
		s.ag.Ligar()
		// Reconfigurar a API pode mudar os vínculos; confere no servidor.
		go s.ag.Reconciliar(context.Background())
	}
	okJSON(w, http.StatusOK, map[string]any{"ok": true, "configurado": s.store.Completo()})
}

// -----------------------------------------------------------------------
// Descoberta local
// -----------------------------------------------------------------------

func (s *Server) dispositivos(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	conhecidos, err := bluez.Conhecidos(ctx)
	if err != nil {
		conhecidos = nil
	}

	lista := conhecidos
	if r.URL.Query().Get("scan") == "1" {
		achados, errScan := bluez.Buscar(ctx, 6)
		if errScan == nil {
			lista = juntarDispositivos(conhecidos, achados)
		}
		// ignore scan errors, keep known list
	}

	if lista == nil {
		lista = []bluez.Dispositivo{}
	}
	okJSON(w, http.StatusOK, map[string]any{"dispositivos": lista, "scan": r.URL.Query().Get("scan") == "1"})
}

func juntarDispositivos(a, b []bluez.Dispositivo) []bluez.Dispositivo {
	vistos := map[string]bool{}
	var out []bluez.Dispositivo
	for _, lista := range [][]bluez.Dispositivo{a, b} {
		for _, d := range lista {
			if vistos[d.MAC] {
				continue
			}
			vistos[d.MAC] = true
			out = append(out, d)
		}
	}
	return out
}

func (s *Server) dispositivosUSB(w http.ResponseWriter, _ *http.Request) {
	lista := transport.ListarUSB()
	if lista == nil {
		lista = []transport.DispositivoUSB{}
	}
	okJSON(w, http.StatusOK, map[string]any{"dispositivos": lista})
}

// filas devolve as filas cadastradas no admin, com o vínculo atual. A UI usa
// para escolher qual fila atrelar ao dispositivo selecionado.
func (s *Server) filas(w http.ResponseWriter, _ *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	lista, err := s.client.ListarImpressoras(ctx)
	if err != nil {
		erroJSON(w, http.StatusBadGateway, erroTexto(err))
		return
	}
	if lista == nil {
		lista = []api.Impressora{}
	}
	okJSON(w, http.StatusOK, map[string]any{"filas": lista})
}

// -----------------------------------------------------------------------
// Atrelar / desatrelar (a fila nasce no admin; aqui só ligamos o hardware)
// -----------------------------------------------------------------------

func (s *Server) atrelar(w http.ResponseWriter, r *http.Request) {
	var pedido struct {
		PrinterID  string `json:"printerId"`
		Endereco   string `json:"endereco"`
		Transporte string `json:"transporte"`
		Baud       int    `json:"baud"`
	}
	if !lerJSON(w, r, &pedido) {
		return
	}

	printerID := strings.TrimSpace(pedido.PrinterID)
	endereco := strings.TrimSpace(pedido.Endereco)
	if printerID == "" || endereco == "" {
		erroJSON(w, http.StatusBadRequest, "informe a fila e o endereço do dispositivo")
		return
	}

	transporte := strings.ToUpper(strings.TrimSpace(pedido.Transporte))
	if transporte == "" {
		inferido, err := inferirTransporte(endereco)
		if err != nil {
			erroJSON(w, http.StatusBadRequest, err.Error())
			return
		}
		transporte = inferido
	}
	switch transporte {
	case "BLUETOOTH", "NETWORK", "USB":
	default:
		erroJSON(w, http.StatusBadRequest, "transporte inválido: use BLUETOOTH, NETWORK ou USB")
		return
	}

	baud := 0
	if transporte == "USB" {
		baud = pedido.Baud
		if baud == 0 {
			baud = 9600
		}
		if baud < 1200 || baud > 115200 {
			erroJSON(w, http.StatusBadRequest, "baud inválido (1200–115200)")
			return
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	printer, err := s.client.Atrelar(ctx, printerID, config.Impressora{
		Endereco:   endereco,
		Transporte: transporte,
		Baud:       baud,
	})
	if err != nil {
		erroJSON(w, statusDoErro(err), erroTexto(err))
		return
	}

	imp := config.Impressora{
		ID:         printer.ID,
		Nome:       printer.Name,
		Endereco:   printer.Address,
		Transporte: printer.Transport,
		Colunas:    printer.Columns.Int(),
		Codepage:   printer.Codepage.Int(),
		Baud:       printer.Baud.Int(),
	}
	if err := s.store.Update(func(c *config.Arquivo) {
		substituida := false
		for i, existente := range c.Impressoras {
			if existente.ID == imp.ID {
				c.Impressoras[i] = imp
				substituida = true
			}
		}
		if !substituida {
			c.Impressoras = append(c.Impressoras, imp)
		}
	}); err != nil {
		erroJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.ag.Sincronizar()

	s.log.Add("%s atrelada (%s · %s)", imp.Nome, imp.Transporte, imp.Endereco)
	okJSON(w, http.StatusOK, map[string]any{"impressora": imp})
}

func (s *Server) desatrelar(w http.ResponseWriter, r *http.Request) {
	var pedido struct {
		PrinterID string `json:"printerId"`
	}
	if !lerJSON(w, r, &pedido) {
		return
	}
	printerID := strings.TrimSpace(pedido.PrinterID)
	if printerID == "" {
		erroJSON(w, http.StatusBadRequest, "informe a fila")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	_, err := s.client.Desatrelar(ctx, printerID)
	var apiErr *api.Erro
	if err != nil && !(errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound) {
		erroJSON(w, statusDoErro(err), erroTexto(err))
		return
	}

	if err := s.store.Update(func(c *config.Arquivo) {
		var sobrando []config.Impressora
		for _, imp := range c.Impressoras {
			if imp.ID != printerID {
				sobrando = append(sobrando, imp)
			}
		}
		c.Impressoras = sobrando
	}); err != nil {
		erroJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.ag.Sincronizar()
	s.log.Add("fila %s desatrelada desta máquina", curto(printerID))
	okJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// testar enfileira um cupom de teste pelo sistema (POST /printers/:id/test).
func (s *Server) testar(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var resp struct {
		JobID string `json:"jobId"`
	}
	if err := s.client.Post(ctx, "/printers/"+r.PathValue("id")+"/test", map[string]any{}, &resp); err != nil {
		erroJSON(w, statusDoErro(err), erroTexto(err))
		return
	}
	s.log.Add("cupom de teste enfileirado (%s)", curto(resp.JobID))
	okJSON(w, http.StatusOK, map[string]any{"jobId": resp.JobID})
}

// -----------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------

// inferirTransporte: /dev/... ou COMn → USB; MAC → Bluetooth; IP/host[:porta] → rede.
func inferirTransporte(endereco string) (string, error) {
	if strings.HasPrefix(endereco, "/dev/") || ehPortaCOM(endereco) {
		return "USB", nil
	}
	if bluez.EhMAC(endereco) {
		return "BLUETOOTH", nil
	}
	host := endereco
	if h, _, err := net.SplitHostPort(endereco); err == nil {
		host = h
	} else if i := strings.LastIndex(endereco, ":"); i > 0 {
		host = endereco[:i]
	}
	if net.ParseIP(host) != nil || strings.Contains(host, ".") || host == "localhost" {
		return "NETWORK", nil
	}
	return "", fmt.Errorf("não reconheci %q — use um caminho /dev/…, COMn (Windows), MAC (AA:BB:CC:DD:EE:FF) ou IP[:porta]", endereco)
}

// ehPortaCOM confere "COM1".."COM256" (porta serial do Windows).
func ehPortaCOM(v string) bool {
	if len(v) < 4 || len(v) > 7 {
		return false
	}
	if !strings.EqualFold(v[:3], "COM") {
		return false
	}
	n, err := strconv.Atoi(v[3:])
	return err == nil && n >= 1 && n <= 256
}

func statusDoErro(err error) int {
	var apiErr *api.Erro
	if errors.As(err, &apiErr) && apiErr.Status >= 400 && apiErr.Status < 500 {
		return apiErr.Status
	}
	return http.StatusBadGateway
}

func lerJSON(w http.ResponseWriter, r *http.Request, alvo any) bool {
	if err := json.NewDecoder(r.Body).Decode(alvo); err != nil {
		erroJSON(w, http.StatusBadRequest, "JSON inválido: "+err.Error())
		return false
	}
	return true
}

func okJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func erroJSON(w http.ResponseWriter, status int, mensagem string) {
	okJSON(w, status, map[string]string{"error": mensagem})
}

func erroTexto(err error) string {
	if apiErr, ok := err.(*api.Erro); ok {
		return apiErr.Mensagem
	}
	return err.Error()
}

func curto(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}
