// Package bluez empacota os utilitários do BlueZ que rodam sem root:
// listagem/scan de dispositivos e descoberta do canal RFCOMM via SDP.
package bluez

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Dispositivo visto no adaptador local.
type Dispositivo struct {
	MAC  string `json:"mac"`
	Nome string `json:"nome"`
}

// Conhecidos lista os dispositivos já conhecidos do BlueZ (rápido, sem scan).
func Conhecidos(ctx context.Context) ([]Dispositivo, error) {
	out, err := executar(ctx, 8*time.Second, "bluetoothctl", "devices")
	if err != nil {
		return nil, err
	}
	var lista []Dispositivo
	for _, linha := range strings.Split(out, "\n") {
		campos := strings.SplitN(strings.TrimSpace(linha), " ", 3)
		if len(campos) < 2 || campos[0] != "Device" {
			continue
		}
		d := Dispositivo{MAC: campos[1]}
		if len(campos) == 3 {
			d.Nome = campos[2]
		}
		lista = append(lista, d)
	}
	return lista, nil
}

// Buscar faz um scan (hcitool) — leva ~8s e acha aparelhos desconhecidos.
func Buscar(ctx context.Context, segundos int) ([]Dispositivo, error) {
	if segundos <= 0 {
		segundos = 6
	}
	out, err := executar(ctx, time.Duration(segundos+6)*time.Second,
		"hcitool", "scan", "--length="+strconv.Itoa(segundos))
	if err != nil {
		return nil, fmt.Errorf("scan bluetooth: %w", err)
	}

	var lista []Dispositivo
	for _, linha := range strings.Split(out, "\n") {
		linha = strings.TrimSpace(linha)
		if !strings.Contains(linha, ":") || strings.HasPrefix(linha, "Scanning") {
			continue
		}
		campos := strings.SplitN(linha, "\t", 2)
		mac := strings.TrimSpace(campos[0])
		if !EhMAC(mac) {
			continue
		}
		d := Dispositivo{MAC: mac}
		if len(campos) == 2 {
			if nome := strings.TrimSpace(campos[1]); nome != "" && nome != "n/a" {
				d.Nome = nome
			}
		}
		lista = append(lista, d)
	}
	if len(lista) == 0 {
		return nil, fmt.Errorf("nenhum dispositivo encontrado")
	}
	return lista, nil
}

// NomeDoAparelho pergunta o nome ao próprio aparelho (hcitool info, ~2s).
func NomeDoAparelho(ctx context.Context, mac string) string {
	out, err := executar(ctx, 6*time.Second, "hcitool", "info", mac)
	if err != nil {
		return ""
	}
	for _, linha := range strings.Split(out, "\n") {
		if t := strings.TrimSpace(linha); strings.HasPrefix(t, "Name:") {
			return strings.TrimSpace(strings.TrimPrefix(t, "Name:"))
		}
	}
	return ""
}

// CanalRFCOMM descobre o canal do perfil Serial Port via SDP (sdptool browse).
func CanalRFCOMM(ctx context.Context, mac string) (byte, error) {
	out, err := executar(ctx, 15*time.Second, "sdptool", "browse", mac)
	if err != nil {
		return 0, fmt.Errorf("SDP indisponível (aparelho desligado ou fora de alcance?): %w", err)
	}
	return parsearCanal(out)
}

// parsearCanal acha "Channel: N": prefere o bloco do Serial Port, senão o
// primeiro canal RFCOMM que aparecer.
func parsearCanal(out string) (byte, error) {
	linhas := strings.Split(out, "\n")

	procurar := func(apenasSerialPort bool) (byte, bool) {
		noBloco := !apenasSerialPort
		for _, linha := range linhas {
			t := strings.TrimSpace(linha)
			if strings.HasPrefix(t, "Service Name:") {
				noBloco = !apenasSerialPort || strings.Contains(t, "Serial Port")
				continue
			}
			if !noBloco || !strings.HasPrefix(t, "Channel:") {
				continue
			}
			if n, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(t, "Channel:"))); err == nil && n > 0 && n < 31 {
				return byte(n), true
			}
		}
		return 0, false
	}

	if canal, ok := procurar(true); ok {
		return canal, nil
	}
	if canal, ok := procurar(false); ok {
		return canal, nil
	}
	return 0, fmt.Errorf("nenhum canal RFCOMM no SDP do aparelho")
}

func EhMAC(v string) bool {
	campos := strings.Split(v, ":")
	if len(campos) != 6 {
		return false
	}
	for _, c := range campos {
		if len(c) != 2 {
			return false
		}
		if _, err := strconv.ParseUint(c, 16, 8); err != nil {
			return false
		}
	}
	return true
}

func executar(ctx context.Context, timeout time.Duration, nome string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, nome, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s: %s", nome, msg)
	}
	return stdout.String(), nil
}
