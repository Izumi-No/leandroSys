//go:build linux

package transport

import (
	"context"
	"fmt"

	"leandrosys/printd/internal/config"
)

// Disponivel diz se dá para transmitir por aqui. No USB o dispositivo precisa
// existir agora (evita queimar tentativas de job com a impressora desplugada).
func Disponivel(imp config.Impressora) bool {
	switch imp.Transporte {
	case "NETWORK", "BLUETOOTH":
		return true
	case "USB":
		return dispositivoUSBExiste(imp.Endereco)
	default:
		return false
	}
}

func Descrever(imp config.Impressora) string {
	switch imp.Transporte {
	case "NETWORK", "BLUETOOTH":
		return ""
	case "USB":
		if imp.Endereco == "" {
			return "endereço USB vazio"
		}
		return fmt.Sprintf("dispositivo USB %s não encontrado (desplugado? sem permissão?)", imp.Endereco)
	default:
		return fmt.Sprintf("transporte %s sem suporte neste build (use NETWORK, BLUETOOTH ou USB)", imp.Transporte)
	}
}

// Enviar transmite os dados para a impressora indicada.
func Enviar(ctx context.Context, imp config.Impressora, dados []byte) Resultado {
	switch imp.Transporte {
	case "NETWORK":
		return enviarTCP(ctx, imp.Endereco, dados)
	case "BLUETOOTH":
		return enviarRFCOMM(ctx, imp.Endereco, dados)
	case "USB":
		return enviarUSB(ctx, imp, dados)
	default:
		return falha("%s", Descrever(imp))
	}
}
