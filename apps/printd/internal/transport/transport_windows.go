//go:build windows

package transport

import (
	"context"
	"fmt"

	"leandrosys/printd/internal/config"
)

// Disponivel diz se dá para transmitir por aqui. USB e Bluetooth precisam do
// hardware visível agora (evita queimar tentativas de job com o dispositivo
// desplugado ou despareado — no Windows o BT depende da COM virtual).
func Disponivel(imp config.Impressora) bool {
	switch imp.Transporte {
	case "NETWORK":
		return true
	case "BLUETOOTH":
		_, err := portaVirtualBluetooth(imp.Endereco)
		return err == nil
	case "USB":
		return dispositivoUSBExiste(imp.Endereco)
	default:
		return false
	}
}

func Descrever(imp config.Impressora) string {
	switch imp.Transporte {
	case "NETWORK":
		return ""
	case "BLUETOOTH":
		if _, err := portaVirtualBluetooth(imp.Endereco); err != nil {
			return fmt.Sprintf("dispositivo Bluetooth %s sem porta COM virtual (despareado?)", imp.Endereco)
		}
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
