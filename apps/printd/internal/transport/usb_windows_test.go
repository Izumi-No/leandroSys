//go:build windows

package transport

import "testing"

func TestNumeroCOM(t *testing.T) {
	casos := map[string]int{"COM1": 1, "COM10": 10, "com256": 256, "COMx": 0, "": 0}
	for entrada, esperado := range casos {
		if got := numeroCOM(entrada); got != esperado {
			t.Errorf("numeroCOM(%q) = %d, esperado %d", entrada, got, esperado)
		}
	}
}

func TestLessCOMOrdemNumerica(t *testing.T) {
	// COM2 < COM10: ordenação lexicográfica erraria aqui.
	if !lessCOM("COM2", "COM10") {
		t.Fatal("COM2 deveria vir antes de COM10")
	}
	if lessCOM("COM10", "COM2") {
		t.Fatal("COM10 deveria vir depois de COM2")
	}
}

func TestEhCOM(t *testing.T) {
	if !EhCOM("COM3") || !EhCOM("com256") {
		t.Fatal("COM3/com256 deveriam ser válidas")
	}
	if EhCOM("COM0") || EhCOM("COM9999") || EhCOM("/dev/ttyUSB0") {
		t.Fatal("valores fora da faixa não deveriam ser COM")
	}
}

func TestConstanteBaud(t *testing.T) {
	if got := constanteBaud(9600); got != 9600 {
		t.Fatalf("9600 → %d", got)
	}
	if got := constanteBaud(115200); got != 115200 {
		t.Fatalf("115200 → %d", got)
	}
	// baud fora da tabela: passa o valor bruto (driver costuma aceitar)
	if got := constanteBaud(1000000); got != 1000000 {
		t.Fatalf("1000000 → %d", got)
	}
}

func TestLimparDeviceDesc(t *testing.T) {
	// "@oem42.inf,-123" (com @) → sem descritor legível
	if got := limparDeviceDesc("@oem42.inf,-123"); got != "" {
		t.Fatalf("desc com @ → %q, esperado vazio", got)
	}
	// caminho de dispositivo com sufixo "…\instancia@oem42.inf,-3" → prefixo
	if got := limparDeviceDesc(`USB\VID_04A9&PID_1234\5&123@oem42.inf,-3`); got != "USB" {
		t.Fatalf("→ %q, esperado USB", got)
	}
	if got := limparDeviceDesc(""); got != "" {
		t.Fatalf("vazio → %q", got)
	}
}

func TestPortaVirtualBluetoothMACInvalido(t *testing.T) {
	// MAC inválido → erro antes de tocar no registro.
	if _, err := portaVirtualBluetooth("nao-e-mac"); err == nil {
		t.Fatal("MAC inválido deveria dar erro")
	}
}
