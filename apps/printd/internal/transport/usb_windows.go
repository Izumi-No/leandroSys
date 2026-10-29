//go:build windows

package transport

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"unsafe"

	"leandrosys/printd/internal/config"
	"leandrosys/printd/internal/winreg"
)

// DispositivoUSB é um caminho local que pode receber ESC/POS.
type DispositivoUSB struct {
	Caminho string `json:"caminho"`
	Nome    string `json:"nome"`
	Classe  string `json:"classe"` // serial | printer
	Detalhe string `json:"detalhe,omitempty"`
}

// kernel32: CreateFileW / WriteFile / GetCommState / SetCommState.
var (
	kernel32, _         = syscall.LoadDLL("kernel32.dll")
	procCreateFileW     = mustProc(kernel32, "CreateFileW")
	procWriteFile       = mustProc(kernel32, "WriteFile")
	procCloseHandle     = mustProc(kernel32, "CloseHandle")
	procGetCommState    = mustProc(kernel32, "GetCommState")
	procSetCommState    = mustProc(kernel32, "SetCommState")
	procGetCommTimeouts = mustProc(kernel32, "GetCommTimeouts")
	procSetCommTimeouts = mustProc(kernel32, "SetCommTimeouts")
)

func mustProc(d *syscall.DLL, nome string) *syscall.Proc {
	p, err := d.FindProc(nome)
	if err != nil {
		panic("printd: proc " + nome + ": " + err.Error())
	}
	return p
}

// DCB (wingdi.h) — layout binário exigido pelo Get/SetCommState.
type dcb struct {
	DCBlength      uint32
	BaudRate       uint32
	Flags          uint32
	wReserved      uint16
	XonLim         uint16
	XoffLim        uint16
	ByteSize       byte
	Parity         byte
	StopBits       byte
	XonChar        byte
	XoffChar       byte
	ErrorChar      byte
	EofChar        byte
	EvtChar        byte
	wReserved1     uint16
}

// comTimeouts — WriteFile deve retornar imediatamente com o que couber.
type comTimeouts struct {
	ReadIntervalTimeout         uint32
	ReadTotalTimeoutMultiplier  uint32
	ReadTotalTimeoutConstant    uint32
	WriteTotalTimeoutMultiplier uint32
	WriteTotalTimeoutConstant   uint32
}

// constanteBaud devolve o CBR_* mais próximo para o baud pedido.
func constanteBaud(baud int) uint32 {
	switch baud {
	case 110:
		return 110
	case 300:
		return 300
	case 600:
		return 600
	case 1200:
		return 1200
	case 2400:
		return 2400
	case 4800:
		return 4800
	case 9600:
		return 9600
	case 14400:
		return 14400
	case 19200:
		return 19200
	case 38400:
		return 38400
	case 57600:
		return 57600
	case 115200:
		return 115200
	case 128000:
		return 128000
	case 256000:
		return 256000
	default:
		return uint32(baud) // driver costuma aceitar o valor bruto
	}
}

// openCOM abre a porta COM com 8N1 no baud dado (0 = deixa o atual).
func openCOM(nome string, baud int) (syscall.Handle, error) {
	alvo := nome
	if !strings.HasPrefix(alvo, `\\.\`) {
		alvo = `\\.\` + nome // COM10+ exige o prefixo \\.\ 
	}

	p, err := syscall.UTF16PtrFromString(alvo)
	if err != nil {
		return 0, err
	}

	h, _, _ := procCreateFileW.Call(
		uintptr(unsafe.Pointer(p)),
		syscall.GENERIC_READ|syscall.GENERIC_WRITE,
		0, // sem compartilhamento: exclusivo
		0,
		syscall.OPEN_EXISTING,
		0,
		0,
	)
	if h == ^uintptr(0) { // INVALID_HANDLE_VALUE
		return 0, fmt.Errorf("abrir %s: %s", nome, syscall.GetLastError())
	}
	fh := syscall.Handle(h)

	// DCB 8N1.
	var d dcb
	d.DCBlength = uint32(unsafe.Sizeof(d))
	if ok, _, _ := procGetCommState.Call(uintptr(fh), uintptr(unsafe.Pointer(&d))); ok == 0 {
		syscall.CloseHandle(fh)
		return 0, fmt.Errorf("GetCommState %s: %s", nome, syscall.GetLastError())
	}
	if baud > 0 {
		d.BaudRate = constanteBaud(baud)
	} // baud 0 → mantém a taxa atual do driver
	d.ByteSize = 8
	d.Parity = 0   // no parity
	d.StopBits = 0 // ONESTOPBIT
	// Flags: fBinary(1) | fDtrControl=ENABLE(1<<4) | fOutOn(1<<9) | fRtsControl=ENABLE(1<<12)
	d.Flags = 1 | (1 << 4) | (1 << 9) | (1 << 12)
	if ok, _, _ := procSetCommState.Call(uintptr(fh), uintptr(unsafe.Pointer(&d))); ok == 0 {
		syscall.CloseHandle(fh)
		return 0, fmt.Errorf("SetCommState %s: %s", nome, syscall.GetLastError())
	}

	// Timeouts: leitura bloqueante por pouco, escrita com teto.
	var to comTimeouts
	to.ReadIntervalTimeout = ^uint32(0)
	to.ReadTotalTimeoutConstant = 100
	to.WriteTotalTimeoutConstant = 5000
	if ok, _, _ := procGetCommTimeouts.Call(uintptr(fh), uintptr(unsafe.Pointer(&to))); ok != 0 {
		_, _, _ = procSetCommTimeouts.Call(uintptr(fh), uintptr(unsafe.Pointer(&to)))
	}
	return fh, nil
}

func closeHandle(h syscall.Handle) {
	_, _, _ = procCloseHandle.Call(uintptr(h))
}

// enviarUSB escreve os bytes crus na porta COM da impressora.
func enviarUSB(ctx context.Context, imp config.Impressora, dados []byte) Resultado {
	if imp.Endereco == "" {
		return falha("impressora USB sem endereço (re-atrelar para escolher a COM)")
	}
	return escreverCOM(imp.Endereco, imp.Baud, dados)
}

// escreverCOM abre a porta COM, escreve tudo e fecha (flush no close).
func escreverCOM(porta string, baud int, dados []byte) Resultado {
	fh, err := openCOM(porta, baud)
	if err != nil {
		return falha("%s", err)
	}
	defer closeHandle(fh)

	restante := dados
	for len(restante) > 0 {
		var written uint32
		ok, _, _ := procWriteFile.Call(
			uintptr(fh),
			uintptr(unsafe.Pointer(&restante[0])),
			uintptr(len(restante)),
			uintptr(unsafe.Pointer(&written)),
			0,
		)
		if ok == 0 {
			return falha("escrita COM %s: %s", porta, syscall.GetLastError())
		}
		if written == 0 {
			return falha("escrita COM %s: nada escrito (timeout)", porta)
		}
		restante = restante[written:]
	}
	return Resultado{Ok: true}
}

// dispositivoUSBExiste tenta abrir a COM: se abrir, o dispositivo está lá.
func dispositivoUSBExiste(endereco string) bool {
	if endereco == "" {
		return false
	}
	fh, err := openCOM(endereco, 0)
	if err != nil {
		return false
	}
	closeHandle(fh)
	return true
}

// enumerarCOM lê HKLM\SYSTEM\CurrentControlSet\Control\COM Database para
// listar as portas COM registradas (mesmo as de adaptadores USB).
func enumerarCOM() []entradaCOM {
	var out []entradaCOM
	chave, err := winreg.OpenKey(winreg.LOCAL_MACHINE,
		`SYSTEM\CurrentControlSet\Control\COM Database`, winreg.ENUMERATE_SUB_KEYS|winreg.QUERY_VALUE)
	if err != nil {
		return out
	}
	defer chave.Close()

	nomes, err := chave.ReadSubKeyNames(-1)
	if err != nil {
		return out
	}
	for _, n := range nomes {
		if !strings.HasPrefix(strings.ToUpper(n), "COM") {
			continue
		}
		out = append(out, entradaCOM{caminho: n, nome: n})
	}
	sort.Slice(out, func(i, j int) bool { return lessCOM(out[i].caminho, out[j].caminho) })
	return out
}

// lessCOM ordena COM1 < COM2 < COM10 (numérico, não lexicográfico).
func lessCOM(a, b string) bool {
	na := numeroCOM(a)
	nb := numeroCOM(b)
	if na != nb {
		return na < nb
	}
	return a < b
}

func numeroCOM(v string) int {
	v = strings.TrimPrefix(strings.ToUpper(v), "COM")
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0
	}
	return n
}

// entradaCOM é o resultado de enumerarCOM/enumerarUSB.
type entradaCOM struct {
	caminho string
	nome    string
	classe  string
}

// enumerarUSB varre HKLM\SYSTEM\CurrentControlSet\Enum\USB e devolve os
// dispositivos que expõem uma porta COM (via subchave .../Device Parameters
// PortName) ou da classe printer.
func enumerarUSB() []entradaCOM {
	var out []entradaCOM
	vistos := map[string]bool{}

	raiz, err := winreg.OpenKey(winreg.LOCAL_MACHINE,
		`SYSTEM\CurrentControlSet\Enum\USB`, winreg.ENUMERATE_SUB_KEYS)
	if err != nil {
		return out
	}
	defer raiz.Close()

	vids, _ := raiz.ReadSubKeyNames(-1)
	for _, vid := range vids {
		vp, err := winreg.OpenKey(raiz, vid, winreg.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue
		}
		insts, _ := vp.ReadSubKeyNames(-1)
		for _, inst := range insts {
			ip, err := winreg.OpenKey(vp, inst, winreg.QUERY_VALUE|winreg.ENUMERATE_SUB_KEYS)
			if err != nil {
				continue
			}
			// Nome amigável: valor "DeviceDesc" ou "FriendlyName".
			nome := valorString(ip, "FriendlyName")
			if nome == "" {
				nome = limparDeviceDesc(valorString(ip, "DeviceDesc"))
			}
			if nome == "" {
				nome = vid + "\\" + inst
			}

			// PortName (COMx) fica em Device Parameters.
			com := ""
			if dp, err := winreg.OpenKey(ip, `Device Parameters`, winreg.QUERY_VALUE); err == nil {
				com = valorString(dp, "PortName")
				dp.Close()
			}
			if com != "" && EhCOM(com) && !vistos[com] {
				vistos[com] = true
				out = append(out, entradaCOM{caminho: com, nome: nome, classe: "serial"})
			}
			ip.Close()
		}
		vp.Close()
	}
	return out
}

// EhCOM confere se v é uma porta COM plausível (COM1..COM256).
func EhCOM(v string) bool {
	if !strings.HasPrefix(strings.ToUpper(v), "COM") {
		return false
	}
	n := numeroCOM(v)
	return n >= 1 && n <= 256
}

// valorString lê um valor REG_SZ da chave.
func valorString(k winreg.Key, nome string) string {
	v, err := k.GetStringValue(nome)
	if err != nil {
		return ""
	}
	return v
}

// limparDeviceDesc extrai um nome legível do DeviceDesc do registro.
// O formato comum é a cadeia indireta "@oem12.inf,-123" (não resolvível sem
// shlwapi) → devolvemos vazio; texto literal é cortado no sufixo de idioma.
func limparDeviceDesc(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || strings.HasPrefix(v, "@") {
		return ""
	}
	if i := strings.Index(v, `\`); i > 0 {
		v = v[:i] // tira sufixo tipo "EPSON ESC/POS\x0409"
	}
	return strings.TrimSpace(v)
}

// ListarUSB encontra portas seriais COM e impressoras USB desta máquina.
// Prefere o COM Database (estável entre replugadas) e deduplica por COM.
func ListarUSB() []DispositivoUSB {
	vistos := map[string]bool{}
	var out []DispositivoUSB

	add := func(caminho, classe, nome string) {
		if caminho == "" || vistos[strings.ToUpper(caminho)] {
			return
		}
		vistos[strings.ToUpper(caminho)] = true
		out = append(out, DispositivoUSB{
			Caminho: caminho,
			Nome:    nome,
			Classe:  classe,
		})
	}

	for _, e := range enumerarCOM() {
		add(e.caminho, "serial", e.nome)
	}
	for _, d := range enumerarUSB() {
		add(d.caminho, d.classe, d.nome)
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Classe != out[j].Classe {
			return out[i].Classe < out[j].Classe // printer antes de serial
		}
		return lessCOM(out[i].Caminho, out[j].Caminho)
	})
	return out
}
