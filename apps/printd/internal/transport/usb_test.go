//go:build linux

package transport

import "testing"

func TestNomeUSB(t *testing.T) {
	// Simulate a by-id path
	nome := nomeUSB("/dev/serial/by-id/usb-Canon_Printer-if00", "/dev/ttyUSB0")
	if nome != "Canon Printer" {
		t.Fatalf("unexpected nome: %s", nome)
	}
}
