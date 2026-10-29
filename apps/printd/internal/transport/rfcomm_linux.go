//go:build linux

package transport

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"leandrosys/printd/internal/bluez"
)

// Constantes do kernel BlueZ (linux).
const (
	afBluetooth = 31 // AF_BLUETOOTH
	protoRFCOMM = 3  // BTPROTO_RFCOMM
)

// sockaddr_rc do kernel — layout {u16 family; u8[6] bdaddr; u8 channel}.
// bdaddr é little-endian: o primeiro octeto do "AA:BB:…" vai em b[5]
// (mesma convenção de str2ba do BlueZ).
type sockaddrRC struct {
	Familia uint16
	Bdaddr  [6]byte
	Canal   uint8
}

// enviarRFCOMM: SDP (canal) → socket AF_BLUETOOTH → connect → write → close.
func enviarRFCOMM(ctx context.Context, endereco string, dados []byte) Resultado {
	mac := strings.ToUpper(strings.TrimSpace(endereco))
	if !bluez.EhMAC(mac) {
		return falha("endereço Bluetooth inválido: %q (esperado AA:BB:CC:DD:EE:FF)", endereco)
	}

	// 1) descobre o canal do perfil Serial Port (SDP via sdptool).
	ctxSDP, cancelar := context.WithTimeout(ctx, 15*time.Second)
	canal, err := bluez.CanalRFCOMM(ctxSDP, mac)
	cancelar()
	if err != nil {
		return falha("%s", err)
	}

	// 2) conecta (conexão bloqueante com teto via SO_SNDTIMEO).
	fd, err := Conectar(mac, canal, 20*time.Second)
	if err != nil {
		return falha("%s", err)
	}
	defer syscall.Close(fd)

	// 3) escreve tudo; close() faz o flush gracioso do restante.
	restante := dados
	for len(restante) > 0 {
		n, erroEscrita := syscall.Write(fd, restante)
		if erroEscrita != nil {
			return falha("escrita bluetooth: %s", erroEscrita)
		}
		if n == 0 {
			return falha("escrita bluetooth: conexão fechada no meio")
		}
		restante = restante[n:]
	}

	return Resultado{Ok: true}
}

// Conectar abre o socket RFCOMM e conecta no canal dado. Exportado para o
// smoke validar a struct (um endereço morto deve dar erro de rede, nunca
// "invalid argument").
func Conectar(mac string, canal byte, timeout time.Duration) (int, error) {
	fd, err := syscall.Socket(afBluetooth, syscall.SOCK_STREAM, protoRFCOMM)
	if err != nil {
		return -1, fmt.Errorf("socket bluetooth: %s", err)
	}

	// Teto de espera (o kernel RFCOMM nem sempre honra SO_SNDTIMEO; o
	// esperarConnettacao abaixo tem o próprio prazo).
	tv := syscall.NsecToTimeval(int64(timeout))
	_ = syscall.SetsockoptTimeval(fd, syscall.SOL_SOCKET, syscall.SO_SNDTIMEO, &tv)

	sa := sockaddrRC{
		Familia: afBluetooth,
		Bdaddr:  inverterMAC(mac),
		Canal:   canal,
	}

	_, _, errno := syscall.Syscall(
		syscall.SYS_CONNECT,
		uintptr(fd),
		uintptr(unsafe.Pointer(&sa)),
		unsafe.Sizeof(sa),
	)

	switch {
	case errno == 0:
		return fd, nil

	case errno == syscall.EINPROGRESS || errno == syscall.EALREADY:
		// O kernel enfileira o link ACL e devolve EINPROGRESS mesmo em socket
		// bloqueante: espera a conclusão (sucesso ou erro) via Select/SO_ERROR.
		if err := esperarConcao(fd, timeout); err != nil {
			syscall.Close(fd)
			return -1, fmt.Errorf("conexão RFCOMM %s (canal %d): %s", mac, canal, err)
		}
		_ = syscall.SetNonblock(fd, false) // escritas simples em modo bloqueante
		return fd, nil

	default:
		syscall.Close(fd)
		return -1, fmt.Errorf("conexão RFCOMM %s (canal %d): %s", mac, canal, errno)
	}
}

// esperarConcao aguarda o connect() terminar: socket liberado para escrita →
// SO_ERROR diz se conectou (0) ou qual foi a falha.
func esperarConcao(fd int, timeout time.Duration) error {
	prazo := time.Now().Add(timeout)
	for {
		restante := time.Until(prazo)
		if restante <= 0 {
			return fmt.Errorf("timeout na conexão")
		}
		if restante > 250*time.Millisecond {
			restante = 250 * time.Millisecond
		}

		var set syscall.FdSet
		set.Bits[fd/64] |= int64(1) << uint(fd%64)

		tv := syscall.NsecToTimeval(int64(restante))
		n, err := syscall.Select(fd+1, nil, &set, nil, &tv)
		if err != nil {
			if err == syscall.EINTR {
				continue
			}
			return err
		}
		if n == 0 {
			continue // fatia de tempo esgotada, prazo ainda vale
		}

		erroConnetcao, err := syscall.GetsockoptInt(fd, syscall.SOL_SOCKET, syscall.SO_ERROR)
		if err != nil {
			return err
		}
		if erroConnetcao != 0 {
			return syscall.Errno(erroConnetcao)
		}
		return nil
	}
}

// inverterMAC converte "AA:BB:CC:DD:EE:FF" para a ordem little-endian do kernel.
func inverterMAC(mac string) [6]byte {
	var b [6]byte
	campos := strings.Split(mac, ":")
	for i := 0; i < 6 && i < len(campos); i++ {
		v, err := strconv.ParseUint(campos[i], 16, 8)
		if err != nil {
			continue // ehMAC já validou antes
		}
		b[5-i] = byte(v)
	}
	return b
}
// Fechar fecha um descritor devolvido por Conectar (socket no kernel).
func Fechar(fd int) {
	_ = syscall.Close(fd)
}
