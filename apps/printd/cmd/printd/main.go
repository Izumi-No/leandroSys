// printd — daemon de impressão do leandroSys.
//
// Ele é o dono da fila: drena os jobs de todas as impressoras pareadas
// (claim → transporte → ack), expõe uma API local em 127.0.0.1 e é o que o
// Electron (UI) conversa. Nada aqui depende do Electron: roda sozinho.
//
//	go run ./cmd/printd            # ou: go build -o bin/printd ./cmd/printd
//	go run ./cmd/printd --config /tmp/printd.json --porta 7411
package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"leandrosys/printd/internal/agent"
	"leandrosys/printd/internal/api"
	"leandrosys/printd/internal/config"
	"leandrosys/printd/internal/logbuf"
	"leandrosys/printd/internal/server"
)

func main() {
	var (
		caminhoConfig = flag.String("config", "", "caminho do printd.json (padrão: ~/.config/leandrosys/printd.json)")
		porta         = flag.Int("porta", 0, "porta do servidor local (padrão: a do config, 7411)")
		apiURL        = flag.String("api", "", "sobrescreve a API configurada (http://…/api)")
	)
	flag.Parse()

	caminho := *caminhoConfig
	if caminho == "" {
		c, err := config.Caminho()
		if err != nil {
			para("config: %s", err)
		}
		caminho = c
	}

	store, err := config.Abrir(caminho)
	if err != nil {
		para("abrindo config: %s", err)
	}

	if *apiURL != "" {
		if err := store.Update(func(c *config.Arquivo) { c.APIURL = *apiURL }); err != nil {
			para("salvando API: %s", err)
		}
	}
	if *porta != 0 {
		if err := store.Update(func(c *config.Arquivo) { c.Porta = *porta }); err != nil {
			para("salvando porta: %s", err)
		}
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	log := logbuf.Novo()
	client := api.Novo(store)
	concentrador := agent.Novo(store, client, log, ctx)
	srv := server.Novo(store, concentrador, client, log)

	dados := store.Get()
	endereco := fmt.Sprintf("127.0.0.1:%d", dados.Porta)

	if store.Completo() {
		concentrador.Ligar()
		log.Add("API %s (usuário %s)", dados.APIURL, dados.Usuario)
	} else {
		log.Add("configuração inicial pendente — POST /config com o token %s", dados.Token)
	}
	log.Add("printd ouvindo em http://%s", endereco)

	httpServer := &http.Server{
		Addr:              endereco,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	pronto := make(chan struct{})
	go func() {
		close(pronto)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			para("servidor local: %s", err)
		}
	}()
	<-pronto

	// Linha única para o launcher (Electron) saber porta/token.
	fmt.Printf("printd pronto addr=%s token=%s config=%s\n", endereco, dados.Token, caminho)

	<-ctx.Done()
	fmt.Println("printd: encerrando…")

	concentrador.Desligar()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer shutdownCancel()
	_ = httpServer.Shutdown(shutdownCtx)
}

func para(formato string, args ...any) {
	fmt.Fprintf(os.Stderr, "printd: "+formato+"\n", args...)
	os.Exit(1)
}
