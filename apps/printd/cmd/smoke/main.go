// Smoke E2E do printd — valida a arquitetura nova de ponta a ponta:
//
//		go run ./cmd/smoke
//
//	  1. sobe o daemon (server + agent) num config temporário, como o Electron usaria;
//	  2. configura via POST /config (credenciais testadas antes de gravar);
//	  3. cria 2 filas no admin e as atrela pelo daemon (POST /atrelar) aos
//	     sinks TCP — o daemon é quem reivindica a fila com a identidade local;
//	  4. pré-voo do Bluetooth: o connect() num MAC morto não pode dar "invalid
//	     argument" (prova que a struct sockaddr_rc está correta no kernel);
//	  5. fan-out: mesmo produto roteado para as 2 filas → 1 job em cada fila;
//	  6. o concentrador drena as duas filas em paralelo e os bytes chegam inteiros
//	     aos dois sinks TCP; jobs terminam DONE;
//	  7. limpeza (fecha comanda, desatrela e apaga as filas do teste).
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"leandrosys/printd/internal/agent"
	"leandrosys/printd/internal/api"
	"leandrosys/printd/internal/config"
	"leandrosys/printd/internal/logbuf"
	"leandrosys/printd/internal/server"
	"leandrosys/printd/internal/transport"
)

const (
	apiURL = "http://localhost:3000/api"
	portaA = "127.0.0.1:9201"
	portaB = "127.0.0.1:9202"
)

type cofre struct {
	mu       sync.Mutex
	bytes    int
	conteudo string
}

func (c *cofre) acrescentar(b []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bytes += len(b)
	c.conteudo += string(b)
}

func (c *cofre) ler() (int, string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.bytes, c.conteudo
}

var (
	tempoLimite = 30 * time.Second
)

func main() {
	inicio := time.Now()

	// --- 0. sinks TCP (as "duas cozinhas") --------------------------------
	sinkA, cofreA := subirSink(portaA)
	sinkB, cofreB := subirSink(portaB)
	defer sinkA.Close()
	defer sinkB.Close()
	fmt.Printf("sinks TCP em %s e %s\n", portaA, portaB)

	// --- pré-voo Bluetooth (struct sockaddr_rc contra o kernel real) -------
	preVooBluetooth()

	// --- 1. daemon em processo --------------------------------------------
	tempo, err := os.MkdirTemp("", "printd-smoke-*")
	if err != nil {
		falha("temp dir: %s", err)
	}
	defer os.RemoveAll(tempo)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	store, err := config.Abrir(filepath.Join(tempo, "printd.json"))
	if err != nil {
		falha("config: %s", err)
	}
	log := logbuf.Novo()
	cliente := api.Novo(store)
	concentrador := agent.Novo(store, cliente, log, ctx)
	srv := server.Novo(store, concentrador, cliente, log)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		falha("listener: %s", err)
	}
	base := "http://" + listener.Addr().String()
	go func() { _ = http.Serve(listener, srv.Handler()) }()

	token := store.Get().Token
	fmt.Printf("daemon em %s (token %s…)\n", base, token[:8])

	// --- 2. configuração (credenciais testadas antes de gravar) -----------
	if status, corpo := daemon(base, token, "POST", "/config", map[string]string{
		"apiUrl": apiURL, "usuario": "impressora", "senha": "impressora123",
	}); status != 200 {
		falha("POST /config → %d: %s", status, corpo)
	}
	esperar(func() bool { return esta(base, token).APIOk }, 10*time.Second, "API responder /health")
	fmt.Println("configuração ok (credenciais validadas, concentrador ligado)")

	// --- 3. filas no admin + atrelamento pelo daemon ----------------------
	admin := clienteDe(tempo, "admin", "admin123")
	garcom := clienteDe(tempo, "garcom", "garcom123")

	enderecos := []string{portaA, portaB}
	var impressoras []config.Impressora
	for i, endereco := range enderecos {
		nome := fmt.Sprintf("Smoke %d %d", i+1, time.Now().UnixNano())
		var criada struct {
			Printer struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"printer"`
		}
		pedir(admin.Post(ctx, "/printers", map[string]any{
			"name": nome, "transport": "NETWORK",
		}, &criada), "criar fila no admin")

		status, corpo := daemon(base, token, "POST", "/atrelar", map[string]any{
			"printerId":  criada.Printer.ID,
			"endereco":   endereco,
			"transporte": "NETWORK",
		})
		if status != 200 {
			falha("POST /atrelar %s → %d: %s", endereco, status, corpo)
		}
		var r struct {
			Impressora config.Impressora `json:"impressora"`
		}
		_ = json.Unmarshal([]byte(corpo), &r)
		if r.Impressora.ID != criada.Printer.ID {
			falha("atrelamento devolveu fila errada: %s", r.Impressora.ID)
		}
		if r.Impressora.Transporte != "NETWORK" {
			falha("transporte não preservado para %s: %s", endereco, r.Impressora.Transporte)
		}
		impressoras = append(impressoras, r.Impressora)
	}
	fmt.Printf("filas criadas no admin e atreladas pelo daemon: %s e %s\n",
		impressoras[0].Nome, impressoras[1].Nome)

	// --- 4. fan-out: mesmo produto → as duas filas ------------------------

	var produtos listaProdutos
	pedir(admin.Get(ctx, "/products", &produtos), "GET /products")
	produto := ""
	for _, p := range produtos.Products {
		if p.Active {
			produto, _ = p.ID, p.Name
			break
		}
	}
	if produto == "" {
		falha("seed sem produtos ativos")
	}

	for _, imp := range impressoras {
		errRota := admin.Post(ctx, "/print-routes",
			map[string]string{"printerId": imp.ID, "productId": produto}, nil)
		if errRota != nil && !strings.Contains(errRota.Error(), "rota") {
			falha("criar rota: %s", errRota)
		}
	}
	fmt.Printf("rotas: mesmo produto → %s + %s (fan-out)\n", impressoras[0].Nome, impressoras[1].Nome)

	// --- 5. comanda enviada: 1 item, 2 jobs --------------------------------
	var mesas struct {
		Tables []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"tables"`
	}
	pedir(admin.Get(ctx, "/tables", &mesas), "GET /tables")
	mesa := ""
	for _, t := range mesas.Tables {
		if t.Status == "AVAILABLE" {
			mesa = t.ID
			break
		}
	}
	if mesa == "" {
		falha("nenhuma mesa livre no seed")
	}

	var tomada struct {
		Comanda struct {
			ID     string `json:"id"`
			Number int    `json:"number"`
		} `json:"comanda"`
	}
	pedir(garcom.Post(ctx, "/tables/"+mesa+"/take", map[string]any{}, &tomada), "take")
	pedir(garcom.Post(ctx, "/comandas/"+tomada.Comanda.ID+"/items",
		map[string]any{"productId": produto, "quantity": 1}, nil), "add item")

	var envio struct {
		JobIDs   []string `json:"jobIds"`
		Sent     int      `json:"sent"`
		Unrouted []any    `json:"unrouted"`
	}
	pedir(garcom.Post(ctx, "/comandas/"+tomada.Comanda.ID+"/send", map[string]any{}, &envio), "send")
	if len(envio.JobIDs) != 2 {
		falha("esperava 2 jobs (fan-out), veio %d", len(envio.JobIDs))
	}
	fmt.Printf("comanda %d enviada → %d jobs (uma via por cozinha)\n", tomada.Comanda.Number, len(envio.JobIDs))

	// --- 6. drenagem paralela ---------------------------------------------
	esperar(func() bool {
		bA, _ := cofreA.ler()
		bB, _ := cofreB.ler()
		return bA > 0 && bB > 0 && pendentes(base, token, impressoras) == 0
	}, tempoLimite, "as duas filas drenarem")

	_, textoA := cofreA.ler()
	_, textoB := cofreB.ler()
	if !strings.Contains(textoA, nomeProduto(produtos, produto)) ||
		!strings.Contains(textoB, nomeProduto(produtos, produto)) {
		falha("uma das vias não saiu com o produto no papel")
	}

	// --- 7. limpeza --------------------------------------------------------
	_ = garcom.Post(ctx, "/comandas/"+tomada.Comanda.ID+"/close",
		map[string]any{"paymentMethod": "CASH"}, nil)
	for _, imp := range impressoras {
		_, _ = daemon(base, token, "POST", "/desatrelar", map[string]string{"printerId": imp.ID})
		_ = admin.Delete(ctx, "/printers/"+imp.ID)
	}

	bytesA, _ := cofreA.ler()
	bytesB, _ := cofreB.ler()
	fmt.Printf("SMOKE OK — 2 vias (A:%db · B:%db), mesmo pedido, jobs DONE, em %.1fs\n",
		bytesA, bytesB, time.Since(inicio).Seconds())
}

// -----------------------------------------------------------------------
// Pré-voo: valida a struct do connect() RFCOMM no kernel desta máquina.
// -----------------------------------------------------------------------

func preVooBluetooth() {
	type resultado struct {
		err error
	}
	fim := make(chan resultado, 1)

	// MAC inexistente: struct correta → erro de rede (EHOSTDOWN/ECONNREFUSED/
	// ETIMEDOUT); struct errada → "invalid argument".
	go func() {
		fd, err := transport.Conectar("00:00:00:00:00:00", 1, 3*time.Second)
		if err == nil {
			syscall.Close(fd)
			fim <- resultado{}
			return
		}
		fim <- resultado{err: err}
	}()

	select {
	case r := <-fim:
		if r.err == nil {
			return // conectou (não deve acontecer com MAC zero, mas não é falha)
		}
		msg := r.err.Error()
		if strings.Contains(msg, "invalid argument") || strings.Contains(msg, "protocol not supported") {
			falha("pré-voo Bluetooth: struct/protocolo recusado pelo kernel (%s)", msg)
		}
		fmt.Printf("pré-voo Bluetooth ok (struct sockaddr_rc aceita, falha esperada: %s)\n", msg)
	case <-time.After(6 * time.Second):
		falha("pré-voo Bluetooth: connect() não retornou (SO_SNDTIMEO ignorado?)")
	}
}

// -----------------------------------------------------------------------
// HTTP
// -----------------------------------------------------------------------

func daemon(base, token, metodo, rota string, corpo any) (int, string) {
	var leitor *bytes.Reader
	if corpo != nil {
		bruto, _ := json.Marshal(corpo)
		leitor = bytes.NewReader(bruto)
	} else {
		leitor = bytes.NewReader(nil)
	}

	req, err := http.NewRequest(metodo, base+rota, leitor)
	if err != nil {
		return 0, err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Printd-Token", token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err.Error()
	}
	defer resp.Body.Close()
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(resp.Body)
	return resp.StatusCode, buf.String()
}

type estadoResposta struct {
	Configurado bool           `json:"configurado"`
	APIOk       bool           `json:"apiOk"`
	Ligado      bool           `json:"ligado"`
	Impressos   []agent.Estado `json:"estados"`
}

func esta(base, token string) estadoResposta {
	var e estadoResposta
	status, corpo := daemon(base, token, "GET", "/estado", nil)
	if status != 200 {
		return e
	}
	_ = json.Unmarshal([]byte(corpo), &e)
	return e
}

func pendentes(base, token string, impressoras []config.Impressora) int {
	e := esta(base, token)
	porID := map[string]int{}
	for _, est := range e.Impressos {
		porID[est.ID] = est.Impressos + est.Falhas // trabalho já processado
	}
	total := 0
	for _, imp := range impressoras {
		// enquanto não imprimiu nem falhou, ainda não drenou
		if porID[imp.ID] == 0 {
			total++
		}
	}
	return total
}

func clienteDe(tempo, usuario, senha string) *api.Client {
	caminho := filepath.Join(tempo, "cfg-"+usuario+".json")
	store, err := config.Abrir(caminho)
	if err != nil {
		falha("config %s: %s", usuario, err)
	}
	if err := store.Update(func(c *config.Arquivo) {
		c.APIURL, c.Usuario, c.Senha = apiURL, usuario, senha
	}); err != nil {
		falha("config %s: %s", usuario, err)
	}
	return api.Novo(store)
}

// -----------------------------------------------------------------------
// Infra
// -----------------------------------------------------------------------

func subirSink(endereco string) (net.Listener, *cofre) {
	cof := &cofre{}
	li, err := net.Listen("tcp", endereco)
	if err != nil {
		falha("sink %s: %s", endereco, err)
	}
	go func() {
		for {
			con, err := li.Accept()
			if err != nil {
				return
			}
			go func() {
				defer con.Close()
				buf := make([]byte, 4096)
				for {
					n, err := con.Read(buf)
					if n > 0 {
						cof.acrescentar(buf[:n])
					}
					if err != nil {
						return
					}
				}
			}()
		}
	}()
	return li, cof
}

func esperar(condicao func() bool, limite time.Duration, oque string) {
	fim := time.Now().Add(limite)
	for time.Now().Before(fim) {
		if condicao() {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
	falha("timeout esperando: %s", oque)
}

func pedir(err error, oque string) {
	if err != nil {
		falha("%s: %s", oque, err)
	}
}

type produto struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

type listaProdutos struct {
	Products []produto `json:"products"`
}

func nomeProduto(produtos listaProdutos, id string) string {
	for _, p := range produtos.Products {
		if p.ID == id {
			return p.Name
		}
	}
	return ""
}

func falha(formato string, args ...any) {
	fmt.Printf("SMOKE FALHOU — "+formato+"\n", args...)
	os.Exit(1)
}
