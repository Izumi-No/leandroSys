// Package config persiste a configuração local do daemon: credenciais da API,
// identidade do agente e as filas atreladas a esta máquina.
package config

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Porta do servidor local (o Electron só fala com 127.0.0.1).
const PortaPadrao = 7411

// Impressora (fila) atrelada a um dispositivo desta máquina.
type Impressora struct {
	ID         string `json:"id"`
	Nome       string `json:"nome"`
	Endereco   string `json:"endereco"`
	Transporte string `json:"transporte"` // NETWORK | BLUETOOTH | USB
	Colunas    int    `json:"colunas"`
	Codepage   int    `json:"codepage"`
	Baud       int    `json:"baud,omitempty"` // só USB (8N1)
}

type Arquivo struct {
	Porta       int          `json:"porta"`
	Token       string       `json:"token"`
	AgenteID    string       `json:"agenteId"`
	AgenteNome  string       `json:"agenteNome"`
	APIURL      string       `json:"apiUrl"`
	Usuario     string       `json:"usuario"`
	Senha       string       `json:"senha"`
	Impressoras []Impressora `json:"impressoras"`
}

// Caminho padrão: ~/.config/leandrosys/printd.json (XDG-aware).
func Caminho() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("dir de configuração: %w", err)
	}
	return filepath.Join(base, "leandrosys", "printd.json"), nil
}

// Store é a fonte única de verdade do daemon (guarda e persiste sob mutex).
type Store struct {
	mu    sync.Mutex
	path  string
	dados Arquivo
}

// Abrir carrega o arquivo (ou cria um novo com token, identidade e porta padrão).
func Abrir(path string) (*Store, error) {
	s := &Store{path: path}
	s.dados = Arquivo{Porta: PortaPadrao}

	bruto, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, err
		}
		s.dados.Token = novoToken()
		s.dados.AgenteID, s.dados.AgenteNome = identidade()
		return s, s.Salvar()
	}

	var lido Arquivo
	if err := json.Unmarshal(bruto, &lido); err != nil {
		return nil, fmt.Errorf("config inválida em %s: %w", path, err)
	}

	precisaSalvar := false
	if lido.Token == "" {
		lido.Token = novoToken()
		precisaSalvar = true
	}
	if lido.Porta == 0 {
		lido.Porta = PortaPadrao
		precisaSalvar = true
	}
	if lido.AgenteID == "" || lido.AgenteNome == "" {
		// Identidade estável desta máquina (usada para reivindicar as filas).
		lido.AgenteID, lido.AgenteNome = identidade()
		precisaSalvar = true
	}

	s.dados = lido
	if precisaSalvar {
		return s, s.Salvar()
	}
	return s, nil
}

// Get devolve uma cópia consistente dos dados.
func (s *Store) Get() Arquivo {
	s.mu.Lock()
	defer s.mu.Unlock()
	copia := s.dados
	copia.Impressoras = append([]Impressora(nil), s.dados.Impressoras...)
	return copia
}

// Update aplica uma mutação e persiste no disco.
func (s *Store) Update(fn func(*Arquivo)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.dados)
	return s.salvarTrava()
}

func (s *Store) Salvar() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.salvarTrava()
}

func (s *Store) salvarTrava() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	bruto, err := json.MarshalIndent(s.dados, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(bruto, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// Completo diz se dá para operar (falta alguma configuração inicial?).
func (s *Store) Completo() bool {
	d := s.Get()
	return d.APIURL != "" && d.Usuario != "" && d.Senha != ""
}

func novoToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// identidade deriva um ID estável de /etc/machine-id + hostname. Se não houver
// machine-id, cai para um ID aleatório (persistido no printd.json).
func identidade() (string, string) {
	host, _ := os.Hostname()
	host = strings.TrimSpace(host)
	if host == "" {
		host = "printd"
	}

	semente := host
	if bruto, err := os.ReadFile("/etc/machine-id"); err == nil {
		if id := strings.TrimSpace(string(bruto)); id != "" {
			semente = id + ":" + host
		}
	}

	if semente == host {
		// Sem machine-id: identidade aleatória, mas estável porque o resultado
		// fica gravado no printd.json.
		return novoToken(), host
	}

	sum := sha256.Sum256([]byte(semente))
	return hex.EncodeToString(sum[:16]), host
}
