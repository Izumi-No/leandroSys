// Package logbuf guarda as últimas linhas do log do daemon para a UI ler
// junto do snapshot (sem SSE: a UI só faz polling de /estado).
package logbuf

import (
	"fmt"
	"sync"
	"time"
)

const capacidade = 300

type Linha struct {
	Hora  string `json:"hora"`
	Texto string `json:"texto"`
}

type Ring struct {
	mu     sync.Mutex
	linhas []Linha
	max    int
}

func Novo() *Ring { return &Ring{max: capacidade} }

func (r *Ring) Add(formato string, args ...any) {
	l := Linha{
		Hora:  time.Now().Format("15:04:05"),
		Texto: fmt.Sprintf(formato, args...),
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.linhas = append(r.linhas, l)
	if len(r.linhas) > r.max {
		r.linhas = r.linhas[len(r.linhas)-r.max:]
	}
}

// Ultimas devolve as N últimas linhas (mais recentes no fim).
func (r *Ring) Ultimas(n int) []Linha {
	r.mu.Lock()
	defer r.mu.Unlock()
	if n >= len(r.linhas) {
		return append([]Linha(nil), r.linhas...)
	}
	return append([]Linha(nil), r.linhas[len(r.linhas)-n:]...)
}
