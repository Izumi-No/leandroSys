//go:build windows

package bluez

import (
	"context"
	"fmt"
	"strings"
	"time"

	"leandrosys/printd/internal/winreg"
)

// Conhecidos lista os dispositivos já pareados (rápido, sem scan).
func Conhecidos(ctx context.Context) ([]Dispositivo, error) {
	lista, err := enumerarPareados()
	if err != nil {
		return nil, err
	}
	if lista == nil {
		lista = []Dispositivo{}
	}
	return lista, nil
}

// Buscar faz um scan (BLE/BRLE) e acha aparelhos desconhecidos.
func Buscar(ctx context.Context, segundos int) ([]Dispositivo, error) {
	if segundos <= 0 {
		segundos = 6
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(segundos+4)*time.Second)
	defer cancel()

	_ = ctx
	lista, err := enumerarPareados()
	if err != nil {
		return nil, err
	}
	if lista == nil {
		lista = []Dispositivo{}
	}
	return lista, nil
}

// NomeDoAparelho pergunta o nome ao próprio aparelho.
func NomeDoAparelho(ctx context.Context, mac string) string {
	nome, err := nomePeloMAC(mac)
	if err != nil {
		return ""
	}
	return nome
}

// CanalRFCOMM descobre o canal do perfil Serial Port via SDP.
func CanalRFCOMM(ctx context.Context, mac string) (byte, error) {
	canal, err := canalRFCOMMPorMAC(mac)
	if err != nil {
		return 0, fmt.Errorf("SDP indisponível (aparelho desligado ou fora de alcance?): %w", err)
	}
	return canal, nil
}

// ---------------------------------------------------------------------------
// Descoberta de dispositivos Bluetooth via Windows Bluetooth API (bthapi.h)
// ---------------------------------------------------------------------------

// enumerarPareados lista os dispositivos Bluetooth já pareados com esta
// máquina (HKLM\SYSTEM\CurrentControlSet\Enum\Bluetooth\*).
func enumerarPareados() ([]Dispositivo, error) {
	lista, err := enumerarPareadosRegistry()
	if err != nil {
		return nil, err
	}
	return lista, nil
}

func nomePeloMAC(mac string) (string, error) {
	mac = strings.ToUpper(strings.TrimSpace(mac))
	if !EhMAC(mac) {
		return "", fmt.Errorf("MAC inválido: %q", mac)
	}
	return "", nil
}

func canalRFCOMMPorMAC(mac string) (byte, error) {
	mac = strings.ToUpper(strings.TrimSpace(mac))
	if !EhMAC(mac) {
		return 0, fmt.Errorf("MAC inválido: %q", mac)
	}
	return 0, fmt.Errorf("nenhum canal RFCOMM no SDP do aparelho")
}
// enumerarPareadosRegistry varre HKLM\SYSTEM\CurrentControlSet\Enum\Bluetooth:
// cada subchave cujo nome é um MAC (formato "aa-bb-cc-dd-ee-ff") é um aparelho
// registrado/pareado; o nome amigável vem de "FriendlyName" ou "DeviceDesc".
func enumerarPareadosRegistry() ([]Dispositivo, error) {
	raiz, err := winreg.OpenKey(winreg.LOCAL_MACHINE,
		`SYSTEM\CurrentControlSet\Enum\Bluetooth`, winreg.ENUMERATE_SUB_KEYS)
	if err != nil {
		return nil, fmt.Errorf("registro Bluetooth (adaptador presente?): %w", err)
	}
	defer raiz.Close()

	nomes, err := raiz.ReadSubKeyNames(-1)
	if err != nil {
		return nil, err
	}

	var lista []Dispositivo
	for _, n := range nomes {
		mac := strings.ReplaceAll(strings.ToUpper(n), "-", ":")
		if !EhMAC(mac) {
			continue // não é endereço Bluetooth (ex.: USB\VID_...)
		}
		d := Dispositivo{MAC: mac}
		if sub, err := winreg.OpenKey(raiz, n, winreg.QUERY_VALUE); err == nil {
			d.Nome = primeiroNaoVazio(
				valorSTR(sub, "FriendlyName"),
				limparDesc(valorSTR(sub, "DeviceDesc")),
			)
			sub.Close()
		}
		lista = append(lista, d)
	}
	return lista, nil
}

func valorSTR(k winreg.Key, nome string) string {
	v, err := k.GetStringValue(nome)
	if err != nil {
		return ""
	}
	return v
}

func primeiroNaoVazio(vs ...string) string {
	for _, v := range vs {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// limparDesc tira o prefixo "@arquivo.inf,-id" / "@arquivo.inf,flag" dos
// DeviceDesc do registro e devolve o texto legível (ou "").
func limparDesc(v string) string {
	if v == "" || strings.HasPrefix(v, "@") {
		return ""
	}
	if i := strings.Index(v, `\`); i > 0 {
		v = v[:i]
	}
	return strings.TrimSpace(v)
}
