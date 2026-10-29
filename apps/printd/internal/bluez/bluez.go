package bluez

import (
	"fmt"
	"strconv"
	"strings"
)

// Dispositivo visto no adaptador local.
type Dispositivo struct {
	MAC  string `json:"mac"`
	Nome string `json:"nome"`
}

// EhMAC confere "AA:BB:CC:DD:EE:FF".
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