// Package transport envia os bytes ESC/POS para o hardware.
//
//   - NETWORK: TCP (porta padrão 9100) — em processo.
//   - BLUETOOTH: socket RFCOMM do kernel (AF_BLUETOOTH), sem módulo nativo —
//     é a vantagem do daemon em Go: nada de ABI/compilar contra o Electron.
//   - USB: porta serial 8N1 (ttyUSB/ttyACM/by-id) ou char device da classe
//     printer (/dev/usb/lp*), via termios do próprio kernel.
package transport

import (
	"context"
	"fmt"

	"leandrosys/printd/internal/config"
)

type Resultado struct {
	Ok   bool   `json:"ok"`
	Erro string `json:"erro,omitempty"`
}

func falha(formato string, args ...any) Resultado {
	return Resultado{Ok: false, Erro: fmt.Sprintf(formato, args...)}
}

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
