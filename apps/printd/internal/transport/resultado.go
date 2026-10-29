// Package transport envia os bytes ESC/POS para o hardware.
//
//   - NETWORK: TCP (porta padrão 9100) — em qualquer SO.
//   - BLUETOOTH: socket RFCOMM (AF_BLUETOOTH) — BlueZ no Linux, WinSock no
//     Windows, sem módulo nativo: é a vantagem do daemon em Go.
//   - USB: porta serial 8N1 — ttyUSB/ttyACM no Linux, COMx no Windows — ou
//     char device da classe printer (/dev/usb/lp*), só no Linux.
package transport

import "fmt"

type Resultado struct {
	Ok   bool   `json:"ok"`
	Erro string `json:"erro,omitempty"`
}

func falha(formato string, args ...any) Resultado {
	return Resultado{Ok: false, Erro: fmt.Sprintf(formato, args...)}
}
