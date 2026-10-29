package server

import "testing"

func TestInferirTransporte(t *testing.T) {
	casos := []struct {
		endereco string
		esperado string
		querErro bool
	}{
		{"/dev/usb/lp0", "USB", false},
		{"/dev/ttyUSB0", "USB", false},
		{"/dev/serial/by-id/usb-Canon-if00", "USB", false},
		{"COM3", "USB", false},          // porta serial do Windows
		{"com12", "USB", false},         // case-insensitive
		{"AA:BB:CC:DD:EE:FF", "BLUETOOTH", false},
		{"192.168.1.10", "NETWORK", false},
		{"192.168.1.10:9100", "NETWORK", false},
		{"caixa.local", "NETWORK", false},
		{"localhost", "NETWORK", false},
		{"COM0", "", true},    // fora da faixa
		{"COM9999", "", true}, // fora da faixa
		{"COMx", "", true},    // sem número
		{"bluetooth", "", true},
		{"", "", true},
	}

	for _, c := range casos {
		got, err := inferirTransporte(c.endereco)
		if c.querErro {
			if err == nil {
				t.Errorf("%q: esperava erro, veio %q", c.endereco, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("%q: erro inesperado: %v", c.endereco, err)
			continue
		}
		if got != c.esperado {
			t.Errorf("%q: esperado %s, veio %s", c.endereco, c.esperado, got)
		}
	}
}

func TestEhPortaCOM(t *testing.T) {
	validas := []string{"COM1", "COM9", "COM10", "COM256", "com3", "COM255"}
	invalidas := []string{"COM0", "COM257", "COM", "COMx", "COM1234", "PORTA COM1", "1COM1"}

	for _, v := range validas {
		if !ehPortaCOM(v) {
			t.Errorf("%q deveria ser porta COM", v)
		}
	}
	for _, v := range invalidas {
		if ehPortaCOM(v) {
			t.Errorf("%q não deveria ser porta COM", v)
		}
	}
}
