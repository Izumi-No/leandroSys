package transport

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"leandrosys/printd/internal/config"
)

// Constantes Linux (asm-generic) que não são exportadas pelo pacote syscall.
const (
	cbaud   = 0x100F // máscara da velocidade em termios
	tcsbrk  = 0x5409 // TCSBRK: arg 1 = tcdrain()
	crtscts = 0x80000000
)

// DispositivoUSB é um caminho local que pode receber ESC/POS.
type DispositivoUSB struct {
	Caminho string `json:"caminho"`
	Nome    string `json:"nome"`
	Classe  string `json:"classe"` // serial | printer
	Detalhe string `json:"detalhe,omitempty"`
}

// ListarUSB encontra portas seriais USB e impressoras USB (classe printer).
// Prefere /dev/serial/by-id (estável entre replugadas) e deduplica os symlinks.
func ListarUSB() []DispositivoUSB {
	vistos := map[string]bool{}
	var out []DispositivoUSB

	add := func(caminho, classe string) {
		real, err := filepath.EvalSymlinks(caminho)
		if err != nil {
			return
		}
		info, err := os.Stat(real)
		if err != nil || info.Mode()&os.ModeCharDevice == 0 {
			return
		}
		if vistos[real] {
			return
		}
		vistos[real] = true

		dispositivo := DispositivoUSB{
			Caminho: caminho,
			Nome:    nomeUSB(caminho, real),
			Classe:  classe,
		}
		if real != caminho {
			dispositivo.Detalhe = real
		}
		out = append(out, dispositivo)
	}

	if porID, err := filepath.Glob("/dev/serial/by-id/*"); err == nil {
		for _, caminho := range porID {
			add(caminho, "serial")
		}
	}
	for _, padrao := range []string{"/dev/ttyUSB*", "/dev/ttyACM*"} {
		if encontrados, err := filepath.Glob(padrao); err == nil {
			for _, caminho := range encontrados {
				add(caminho, "serial")
			}
		}
	}
	if impressoras, err := filepath.Glob("/dev/usb/lp*"); err == nil {
		for _, caminho := range impressoras {
			add(caminho, "printer")
		}
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Classe != out[j].Classe {
			return out[i].Classe < out[j].Classe // printer antes de serial
		}
		return out[i].Caminho < out[j].Caminho
	})
	return out
}

func nomeUSB(caminho, real string) string {
	base := filepath.Base(caminho)
	if strings.HasPrefix(caminho, "/dev/serial/by-id/") {
		// Nome do fabricante/modelo, sem o prefixo e o sufixo de interface.
		nome := strings.TrimPrefix(base, "usb-")
		nome = strings.TrimSuffix(nome, "-if00")
		return strings.ReplaceAll(nome, "_", " ")
	}

	realBase := filepath.Base(real)
	sys := "/sys/class/tty/" + realBase
	if strings.Contains(caminho, "/usb/lp") {
		sys = "/sys/class/usbmisc/" + realBase
	}
	for _, rel := range []string{"device/../product", "device/../../product", "device/product"} {
		if bruto, err := os.ReadFile(filepath.Join(sys, rel)); err == nil {
			if produto := strings.TrimSpace(string(bruto)); produto != "" {
				return fmt.Sprintf("%s (%s)", produto, realBase)
			}
		}
	}
	if strings.Contains(caminho, "/usb/lp") {
		return "Impressora USB " + realBase
	}
	return "Serial USB " + realBase
}

// dispositivoUSBExiste confere o char device antes do claim.
func dispositivoUSBExiste(endereco string) bool {
	info, err := os.Stat(endereco)
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

// enviarUSB abre a porta serial (8N1) ou o char device da impressora e escreve.
func enviarUSB(ctx context.Context, imp config.Impressora, dados []byte) Resultado {
	caminho := strings.TrimSpace(imp.Endereco)
	if caminho == "" {
		return falha("endereço USB vazio")
	}

	lp := strings.Contains(caminho, "/usb/lp")
	flags := syscall.O_RDWR | syscall.O_NOCTTY | syscall.O_NONBLOCK
	if lp {
		flags = syscall.O_WRONLY | syscall.O_NOCTTY | syscall.O_NONBLOCK
	}

	fd, err := syscall.Open(caminho, flags, 0)
	if err != nil {
		return falha("abrindo %s: %s", caminho, err)
	}
	defer syscall.Close(fd)

	if !lp {
		if err := configurarSerial(fd, imp.Baud); err != nil {
			return falha("configurando %s: %s (usuário no grupo dialout?)", caminho, err)
		}
	}

	prazo := time.Now().Add(20 * time.Second)
	if dl, ok := ctx.Deadline(); ok && dl.Before(prazo) {
		prazo = dl
	}
	if err := escreverFD(ctx, fd, dados, prazo); err != nil {
		return falha("envio USB para %s: %s", caminho, err)
	}

	if !lp {
		// Espera o hardware drenar o buffer antes de fechar.
		if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), tcsbrk, 1); errno != 0 {
			return falha("aguardando %s drenar: %s", caminho, errno)
		}
	}
	return Resultado{Ok: true}
}

func configurarSerial(fd int, baud int) error {
	var tio syscall.Termios
	if err := ioctl(fd, syscall.TCGETS, unsafe.Pointer(&tio)); err != nil {
		return fmt.Errorf("TCGETS: %w", err)
	}

	// Raw 8N1, sem eco/controle de linha e sem flow control de hardware.
	tio.Iflag &^= syscall.IGNBRK | syscall.BRKINT | syscall.PARMRK | syscall.ISTRIP |
		syscall.INLCR | syscall.IGNCR | syscall.ICRNL | syscall.IXON | syscall.IXOFF | syscall.IXANY
	tio.Oflag &^= syscall.OPOST
	tio.Lflag &^= syscall.ECHO | syscall.ECHONL | syscall.ICANON | syscall.ISIG | syscall.IEXTEN
	tio.Cflag &^= syscall.CSIZE | syscall.PARENB | syscall.CSTOPB | crtscts
	tio.Cflag |= syscall.CS8 | syscall.CREAD | syscall.CLOCAL

	velocidade := constanteBaud(baud)
	tio.Cflag = (tio.Cflag &^ cbaud) | velocidade
	tio.Ispeed = velocidade
	tio.Ospeed = velocidade
	tio.Cc[syscall.VMIN] = 1
	tio.Cc[syscall.VTIME] = 0

	if err := ioctl(fd, syscall.TCSETS, unsafe.Pointer(&tio)); err != nil {
		return fmt.Errorf("TCSETS: %w", err)
	}
	return nil
}

func constanteBaud(baud int) uint32 {
	switch baud {
	case 1200:
		return syscall.B1200
	case 2400:
		return syscall.B2400
	case 4800:
		return syscall.B4800
	case 19200:
		return syscall.B19200
	case 38400:
		return syscall.B38400
	case 57600:
		return syscall.B57600
	case 115200:
		return syscall.B115200
	default:
		return syscall.B9600
	}
}

func ioctl(fd int, req uintptr, arg unsafe.Pointer) error {
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), req, uintptr(arg))
	if errno != 0 {
		return errno
	}
	return nil
}

func escreverFD(ctx context.Context, fd int, dados []byte, prazo time.Time) error {
	restante := dados
	for len(restante) > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}

		n, err := syscall.Write(fd, restante)
		if n > 0 {
			restante = restante[n:]
		}
		if err == nil {
			continue
		}
		if err != syscall.EAGAIN && err != syscall.EWOULDBLOCK && err != syscall.EINTR {
			return err
		}

		espera := time.Until(prazo)
		if espera <= 0 {
			return fmt.Errorf("timeout na escrita")
		}
		var set syscall.FdSet
		set.Bits[fd/64] |= int64(1) << uint(fd%64)
		tv := syscall.NsecToTimeval(int64(espera))
		n, errSel := syscall.Select(fd+1, nil, &set, nil, &tv)
		if errSel == syscall.EINTR {
			continue
		}
		if errSel != nil {
			return errSel
		}
		if n == 0 {
			return fmt.Errorf("timeout na escrita")
		}
	}
	return nil
}
