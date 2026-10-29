//go:build linux

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