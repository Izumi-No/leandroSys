//go:build windows

package transport

import (
	"context"
	"fmt"
	"strings"
	"syscall"
	"time"

	"leandrosys/printd/internal/bluez"
	"leandrosys/printd/internal/winreg"
)

// No Windows o Bluetooth serial não expõe SDP nem socket RFCOMM usável pelo
// syscall do Go: a plataforma suportada é a **porta COM virtual** que o
// próprio Windows cria ao parear o perfil "Serial Port" (BTHPORT\Device\<MAC>
// → Device Parameters\PortName). Por isso o transporte BLUETOOTH resolve o
// MAC → COMx e reaproveita o mesmo WriteFile do USB (sem dependência nova).

// Conectar resolve o MAC para a COM virtual e abre a porta. Exportado para o
// smoke validar o pré-voo (MAC morto/não pareado → erro, nunca panic).
func Conectar(mac string, canal byte, timeout time.Duration) (int, error) {
	_ = canal // canal RFCOMM é tratado pelo Windows ao parear o perfil

	porta, err := portaVirtualBluetooth(mac)
	if err != nil {
		return -1, err
	}
	fh, err := openCOM(porta, 0)
	if err != nil {
		return -1, err
	}
	return int(fh), nil
}

// Fechar fecha um descritor devolvido por Conectar (handle de arquivo).
func Fechar(fd int) {
	closeHandle(syscall.Handle(fd))
}

// enviarRFCOMM: MAC → COM virtual do Windows → WriteFile (mesmo caminho do USB).
func enviarRFCOMM(ctx context.Context, endereco string, dados []byte) Resultado {
	mac := strings.ToUpper(strings.TrimSpace(endereco))
	if !bluez.EhMAC(mac) {
		return falha("endereço Bluetooth inválido: %q (esperado AA:BB:CC:DD:EE:FF)", endereco)
	}

	porta, err := portaVirtualBluetooth(mac)
	if err != nil {
		return falha("%s", err)
	}
	return escreverCOM(porta, 0, dados) // baud já configurado pelo emparelhamento
}

// portaVirtualBluetooth encontra a COMx que o Windows criou para o MAC.
// Varre Enum\BTHPORT\Device (perfil Serial Port) e Enum\Bluetooth (fallback),
// comparando o nome da chave no formato "aa-bb-cc-dd-ee-ff".
func portaVirtualBluetooth(mac string) (string, error) {
	chaveMAC := strings.ReplaceAll(strings.ToLower(mac), ":", "-")
	if !bluez.EhMAC(mac) || chaveMAC == strings.Repeat("-", 5) {
		return "", fmt.Errorf("MAC inválido: %q", mac)
	}

	raizes := []string{
		`SYSTEM\CurrentControlSet\Enum\BTHPORT\Device`,
		`SYSTEM\CurrentControlSet\Enum\Bluetooth`,
	}
	for _, raiz := range raizes {
		if porta := procurarCOMNaChave(raiz, chaveMAC); porta != "" {
			return porta, nil
		}
	}
	return "", fmt.Errorf("MAC %s não tem porta COM virtual — pareie a impressora "+
		"com o perfil “Serial Port” (Dispositivos → Bluetooth → Adicionar)", mac)
}

// procurarCOMNaChave abre a subchave do MAC em `raiz` e lê PortName das
// instâncias (cada instância = 1 emparelhamento/serviço).
func procurarCOMNaChave(raiz, chaveMAC string) string {
	base, err := winreg.OpenKey(winreg.LOCAL_MACHINE, raiz, winreg.ENUMERATE_SUB_KEYS)
	if err != nil {
		return ""
	}
	defer base.Close()

	alvo, err := winreg.OpenKey(base, chaveMAC, winreg.ENUMERATE_SUB_KEYS|winreg.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer alvo.Close()

	// O PortName pode estar na própria chave ou numa instância filho.
	if porta := portNameDa(alvo); EhCOM(porta) {
		return porta
	}
	instancias, err := alvo.ReadSubKeyNames(-1)
	if err != nil {
		return ""
	}
	for _, inst := range instancias {
		filha, err := winreg.OpenKey(alvo, inst, winreg.QUERY_VALUE|winreg.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue
		}
		porta := portNameDa(filha)
		filha.Close()
		if EhCOM(porta) {
			return porta
		}
	}
	return ""
}

// portNameDa lê Device Parameters\PortName (e, por garantia, PortName direto).
func portNameDa(k winreg.Key) string {
	if dp, err := winreg.OpenKey(k, `Device Parameters`, winreg.QUERY_VALUE); err == nil {
		porta := valorSTRPorta(dp)
		dp.Close()
		if porta != "" {
			return porta
		}
	}
	return valorSTRPorta(k)
}

// valorSTRPorta lê o valor REG_SZ "PortName" de uma chave.
func valorSTRPorta(k winreg.Key) string {
	v, err := k.GetStringValue("PortName")
	if err != nil {
		return ""
	}
	return v
}
