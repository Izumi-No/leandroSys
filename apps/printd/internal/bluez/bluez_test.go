package bluez

import "testing"

func TestEhMACValid(t *testing.T) {
	if !EhMAC("AA:BB:CC:DD:EE:FF") {
		t.Fatalf("valid MAC not recognized")
	}
}

func TestEhMACInvalid(t *testing.T) {
	if EhMAC("invalid-mac") {
		t.Fatalf("invalid MAC recognized")
	}
}

func TestParsearCanal(t *testing.T) {
	sdp := `Service Name: Serial Port
Channel: 5
Service Name: Other
Channel: 3`
	c, err := parsearCanal(sdp)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	if c != 5 {
		t.Fatalf("expected channel 5, got %d", c)
	}
}
