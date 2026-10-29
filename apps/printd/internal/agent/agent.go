// Package agent é o concentrador: um worker goroutine por impressora drenando
// a própria fila (claim → transmitir → ack), com dedup de job e backoff.
// Espelha o "daemon" do edge-printer do tablemanager.
package agent

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math/rand"
	"reflect"
	"sort"
	"sync"
	"time"

	"leandrosys/printd/internal/api"
	"leandrosys/printd/internal/config"
	"leandrosys/printd/internal/logbuf"
	"leandrosys/printd/internal/transport"
)

const (
	intervaloPoll   = 2 * time.Second
	intervaloOcioso = 15 * time.Second // impressora sem transporte ou parada
	limiteDedup     = 200
)

// Estado de uma impressora pareada (exposto para a UI).
type Estado struct {
	ID                 string `json:"id"`
	Nome               string `json:"nome"`
	Endereco           string `json:"endereco"`
	Transporte         string `json:"transporte"`
	Baud               int    `json:"baud,omitempty"`
	Estado             string `json:"estado"` // ociosa | imprimindo | sem-transporte | backoff | parada
	UltimoJob          string `json:"ultimoJob,omitempty"`
	UltimoResultado    string `json:"ultimoResultado,omitempty"` // ok | falha
	UltimoErro         string `json:"ultimoErro,omitempty"`
	Impressos          int    `json:"impressos"`
	Falhas             int    `json:"falhas"`
	ProximaTentativaEm int64  `json:"proximaTentativaEm,omitempty"` // epoch ms
}

type Snapshot struct {
	Ligado  bool     `json:"ligado"`
	API     string   `json:"api"`
	Estados []Estado `json:"estados"`
}

type Agent struct {
	store  *config.Store
	client *api.Client
	log    *logbuf.Ring

	mu         sync.Mutex
	estados    map[string]*Estado
	cancel     map[string]context.CancelFunc
	finais     map[string]struct{}
	filaFinais []string
	ligado     bool
	ctx        context.Context
	reconMu    sync.Mutex
}

func Novo(store *config.Store, client *api.Client, log *logbuf.Ring, ctx context.Context) *Agent {
	return &Agent{
		store:   store,
		client:  client,
		log:     log,
		estados: map[string]*Estado{},
		cancel:  map[string]context.CancelFunc{},
		finais:  map[string]struct{}{},
		ctx:     ctx,
	}
}

// Ligar liga os workers de todas as impressoras pareadas.
func (a *Agent) Ligar() {
	a.mu.Lock()
	if a.ligado {
		a.mu.Unlock()
		return
	}
	a.ligado = true
	a.mu.Unlock()

	a.log.Add("concentrador ligado")
	a.Sincronizar()
	go a.Reconciliar(a.ctx)
}

// Desligar para todos os workers.
func (a *Agent) Desligar() {
	a.mu.Lock()
	a.ligado = false
	for id, cancel := range a.cancel {
		cancel()
		delete(a.cancel, id)
	}
	a.mu.Unlock()
	a.log.Add("concentrador parado")
}

// Sincroniza os workers com a lista do config (chamada após atrelar/desatrelar).
func (a *Agent) Sincronizar() {
	a.mu.Lock()
	defer a.mu.Unlock()

	lista := a.store.Get().Impressoras
	vivas := make(map[string]config.Impressora, len(lista))
	for _, imp := range lista {
		vivas[imp.ID] = imp
	}

	// Para workers de impressoras que saíram da lista.
	for id, cancel := range a.cancel {
		if _, ok := vivas[id]; ok {
			continue
		}
		cancel()
		delete(a.cancel, id)
		delete(a.estados, id)
	}

	// Cria/Atualiza o estado de cada uma e garante o worker.
	for id, imp := range vivas {
		est, ok := a.estados[id]
		if !ok {
			est = &Estado{ID: id, Estado: "parada"}
			a.estados[id] = est
		}
		est.Nome, est.Endereco, est.Transporte = imp.Nome, imp.Endereco, imp.Transporte
		est.Baud = imp.Baud

		if !a.ligado {
			continue
		}
		if _, rodando := a.cancel[id]; rodando {
			continue
		}
		ctx, cancel := context.WithCancel(a.ctx)
		a.cancel[id] = cancel
		go a.rodar(ctx, id)
	}
}

func (a *Agent) Snapshot() Snapshot {
	a.mu.Lock()
	defer a.mu.Unlock()

	s := Snapshot{
		Ligado:  a.ligado,
		API:     a.store.Get().APIURL,
		Estados: make([]Estado, 0, len(a.estados)),
	}
	for _, est := range a.estados {
		s.Estados = append(s.Estados, *est)
	}
	return s
}

// -----------------------------------------------------------------------
// Reconciliação com a API (fonte de verdade dos vínculos)
// -----------------------------------------------------------------------

// Reconciliar traz do servidor as filas atreladas a este agente. Também faz a
// migração de instalações antigas: filas locais sem vínculo na API passam a
// pertencer a esta máquina.
func (a *Agent) Reconciliar(ctx context.Context) {
	cfg := a.store.Get()
	if cfg.APIURL == "" || cfg.AgenteID == "" {
		return
	}

	lista, err := a.client.ListarImpressoras(ctx)
	if err != nil {
		if ctx.Err() == nil {
			a.log.Add("reconciliação: %s", erroTexto(err))
		}
		return
	}

	porID := make(map[string]api.Impressora, len(lista))
	for _, p := range lista {
		porID[p.ID] = p
	}

	// Migração legada: se a fila local ainda não tem agente na API, atrela.
	for _, local := range cfg.Impressoras {
		p, ok := porID[local.ID]
		if !ok || p.AgentID != "" || local.Endereco == "" {
			continue
		}
		anexada, errAtrelar := a.client.Atrelar(ctx, local.ID, local)
		if errAtrelar != nil {
			a.log.Add("reconciliação: não atrelei %s: %s", local.Nome, erroTexto(errAtrelar))
			continue
		}
		porID[local.ID] = anexada
		a.log.Add("%s: fila antiga atrelada a esta máquina", local.Nome)
	}

	finais := make([]config.Impressora, 0, len(porID))
	for _, p := range porID {
		if p.AgentID != cfg.AgenteID {
			continue
		}
		finais = append(finais, config.Impressora{
			ID:         p.ID,
			Nome:       p.Name,
			Endereco:   p.Address,
			Transporte: p.Transport,
			Colunas:    p.Columns.Int(),
			Codepage:   p.Codepage.Int(),
			Baud:       p.Baud.Int(),
		})
	}

	// A ordem do arquivo é irrelevante; ordena para comparar sem ruído.
	atuais := append([]config.Impressora(nil), cfg.Impressoras...)
	sort.Slice(atuais, func(i, j int) bool { return atuais[i].ID < atuais[j].ID })
	sort.Slice(finais, func(i, j int) bool { return finais[i].ID < finais[j].ID })

	if reflect.DeepEqual(atuais, finais) {
		return
	}

	if err := a.store.Update(func(c *config.Arquivo) { c.Impressoras = finais }); err != nil {
		a.log.Add("reconciliação: salvando config: %s", err)
		return
	}
	a.Sincronizar()
	a.log.Add("reconciliação concluída: %d fila(s) nesta máquina", len(finais))
}

func (a *Agent) reconciliarEmSegundoPlano() {
	if !a.reconMu.TryLock() {
		return
	}
	go func() {
		defer a.reconMu.Unlock()
		a.Reconciliar(a.ctx)
	}()
}

// -----------------------------------------------------------------------
// Workers
// -----------------------------------------------------------------------

func (a *Agent) rodar(ctx context.Context, id string) {
	falhas := 0
	agenteID := a.store.Get().AgenteID

	for {
		if ctx.Err() != nil {
			return
		}
		imp, ok := a.impressora(id)
		if !ok {
			return // despareada
		}

		if !transport.Disponivel(imp) {
			a.definir(id, "sem-transporte", mapa{erro: transport.Descrever(imp)})
			if !dormir(ctx, intervaloOcioso) {
				return
			}
			continue
		}

		jobs, err := a.client.Claim(ctx, id, agenteID, 8)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			falhas++
			msg := erroTexto(err)

			// Impressora inativa/inexistente: para de pollar (volta a reavaliar
			// daqui a pouco, caso o admin reative).
			var apiErr *api.Erro
			if errors.As(err, &apiErr) && (apiErr.Status == 409 || apiErr.Status == 404) {
				falhas = 0
				a.definir(id, "parada", mapa{erro: msg})
				// Fila inativa/removida ou desatrelada no admin: confere a
				// verdade no servidor e ajusta a lista local.
				a.reconciliarEmSegundoPlano()
				if !dormir(ctx, intervaloOcioso) {
					return
				}
				continue
			}

			espera := backoff(falhas)
			a.definir(id, "backoff", mapa{
				erro:    msg,
				proxima: time.Now().Add(espera).UnixMilli(),
			})
			a.log.Add("%s: API indisponível (%s) — nova tentativa em %ds",
				imp.Nome, msg, int(espera.Seconds()))
			if !dormir(ctx, espera) {
				return
			}
			continue
		}

		falhas = 0
		if len(jobs) == 0 {
			a.definir(id, "ociosa", mapa{})
			if !dormir(ctx, intervaloPoll+tempoJitter(500*time.Millisecond)) {
				return
			}
			continue
		}

		a.log.Add("%s: %d job(s) recebidos", imp.Nome, len(jobs))
		for _, job := range jobs {
			if ctx.Err() != nil {
				return
			}
			a.processar(ctx, id, imp, job)
		}
	}
}

func (a *Agent) processar(ctx context.Context, id string, imp config.Impressora, job api.Job) {
	a.definir(id, "imprimindo", mapa{job: rotuloJob(job)})

	// At-least-once: job já impresso nesta sessão não imprime de novo — só confirma.
	if a.jaFinalizado(job.ID) {
		_ = a.client.Ack(ctx, job.ID, true, "")
		a.log.Add("%s: job já impresso (%s) — ack repetido", imp.Nome, curto(job.ID))
		return
	}

	dados, err := base64.StdEncoding.DecodeString(job.Data)
	if err != nil {
		a.definir(id, "ociosa", mapa{job: rotuloJob(job), resultado: "falha", erro: "payload inválido"})
		_ = a.client.Ack(ctx, job.ID, false, "payload inválido")
		a.contar(id, "falhas")
		return
	}

	res := transport.Enviar(ctx, imp, dados)

	// O ack é obrigatório até no caminho de erro: é ele que devolve o job à
	// fila ou o leva a FAILED na 3ª tentativa.
	if err := a.client.Ack(ctx, job.ID, res.Ok, res.Erro); err != nil {
		a.log.Add("%s: ack falhou (%s)", imp.Nome, erroTexto(err))
	}

	if res.Ok {
		a.marcarFinal(job.ID)
		a.contar(id, "impressos")
		a.definir(id, "ociosa", mapa{job: rotuloJob(job), resultado: "ok"})
		a.log.Add("%s: %s impresso (tentativa %d)", imp.Nome, job.Kind, job.Attempts)
		return
	}

	a.contar(id, "falhas")
	a.definir(id, "ociosa", mapa{job: rotuloJob(job), resultado: "falha", erro: res.Erro})
	a.log.Add("%s: falha ao imprimir %s — %s", imp.Nome, job.Kind, res.Erro)
}

// -----------------------------------------------------------------------
// Estado e dedup
// -----------------------------------------------------------------------

type mapa struct {
	job       string
	resultado string
	erro      string
	proxima   int64
	zerarErro bool
}

func (a *Agent) definir(id, estado string, m mapa) {
	a.mu.Lock()
	defer a.mu.Unlock()

	est, ok := a.estados[id]
	if !ok {
		return
	}
	est.Estado = estado
	if m.job != "" {
		est.UltimoJob = m.job
	}
	if m.resultado != "" {
		est.UltimoResultado = m.resultado
	}
	switch estado {
	case "backoff":
		if m.erro != "" {
			est.UltimoErro = m.erro
		}
		est.ProximaTentativaEm = m.proxima
	default:
		if m.erro != "" {
			est.UltimoErro = m.erro
		} else {
			est.UltimoErro = ""
		}
		est.ProximaTentativaEm = 0
	}
}

func (a *Agent) contar(id, campo string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if est, ok := a.estados[id]; ok {
		if campo == "impressos" {
			est.Impressos++
		} else {
			est.Falhas++
		}
	}
}

func (a *Agent) impressora(id string) (config.Impressora, bool) {
	for _, imp := range a.store.Get().Impressoras {
		if imp.ID == id {
			return imp, true
		}
	}
	return config.Impressora{}, false
}

func (a *Agent) jaFinalizado(jobID string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	_, ok := a.finais[jobID]
	return ok
}

func (a *Agent) marcarFinal(jobID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.finais[jobID]; ok {
		return
	}
	a.finais[jobID] = struct{}{}
	a.filaFinais = append(a.filaFinais, jobID)
	if len(a.filaFinais) > limiteDedup {
		maisAntigo := a.filaFinais[0]
		a.filaFinais = a.filaFinais[1:]
		delete(a.finais, maisAntigo)
	}
}

// -----------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------

func backoff(falhas int) time.Duration {
	exp := min(falhas, 5)
	base := time.Duration(1<<exp) * 2 * time.Second // 4s, 8s, 16s… (teto 64s→60s)
	if base > 60*time.Second {
		base = 60 * time.Second
	}
	return tempoJitter(base)
}

// tempoJitter aplica ±20% para duas casas não sincronizarem na queda da API.
func tempoJitter(base time.Duration) time.Duration {
	return time.Duration(float64(base) * (0.8 + rand.Float64()*0.4))
}

// dormir respeita o cancelamento do contexto (false = ctx cancelado).
func dormir(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

func erroTexto(err error) string {
	var apiErr *api.Erro
	if errors.As(err, &apiErr) {
		return apiErr.Mensagem
	}
	return err.Error()
}

func rotuloJob(job api.Job) string {
	return fmt.Sprintf("%s · %s", job.Kind, time.Now().Format("15:04:05"))
}

func curto(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}
