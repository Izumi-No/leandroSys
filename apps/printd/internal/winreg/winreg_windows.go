//go:build windows

// Package winreg é um shim mínimo do registro do Windows (advapi32) para o
// printd listar portas COM/dispositivos sem puxar dependências externas.
package winreg

import (
	"fmt"
	"syscall"
	"unsafe"
)

// Chaves-mestre e direitos usados pelo daemon.
const (
	LOCAL_MACHINE Key = 0x80000002

	QUERY_VALUE         = 0x0001
	ENUMERATE_SUB_KEYS  = 0x0009
	KEY_READ            = 0x20019
)

// Key é um handle de chave aberta.
type Key uintptr

var (
	advapi32         = mustLoad("advapi32.dll")
	procRegOpenKeyEx = mustProc(advapi32, "RegOpenKeyExW")
	procRegCloseKey  = mustProc(advapi32, "RegCloseKey")
	procRegEnumKeyEx = mustProc(advapi32, "RegEnumKeyExW")
	procRegQueryVal  = mustProc(advapi32, "RegQueryValueExW")
)

func mustLoad(nome string) *syscall.DLL {
	d, err := syscall.LoadDLL(nome)
	if err != nil {
		panic("winreg: " + nome + ": " + err.Error())
	}
	return d
}

func mustProc(d *syscall.DLL, nome string) *syscall.Proc {
	p, err := d.FindProc(nome)
	if err != nil {
		panic("winreg: " + nome + ": " + err.Error())
	}
	return p
}

func errnoErro(r uintptr) error {
	if r == 0 { // ERROR_SUCCESS
		return nil
	}
	return syscall.Errno(r)
}

// OpenKey abre uma subchave (relativa a k) com o acesso pedido.
func OpenKey(k Key, caminho string, acesso uint32) (Key, error) {
	p, err := syscall.UTF16PtrFromString(caminho)
	if err != nil {
		return 0, err
	}
	var out uintptr
	r, _, _ := procRegOpenKeyEx.Call(
		uintptr(k),
		uintptr(unsafe.Pointer(p)),
		0,
		uintptr(acesso),
		uintptr(unsafe.Pointer(&out)),
	)
	if e := errnoErro(r); e != nil {
		return 0, fmt.Errorf("abrir chave %s: %w", caminho, e)
	}
	return Key(out), nil
}

// Close fecha a chave.
func (k Key) Close() error {
	if k == 0 {
		return nil
	}
	r, _, _ := procRegCloseKey.Call(uintptr(k))
	return errnoErro(r)
}

// ReadSubKeyNames lista os nomes das subchaves (n < 0 = todas).
func (k Key) ReadSubKeyNames(n int) ([]string, error) {
	var out []string
	for i := 0; ; i++ {
		if n >= 0 && i >= n {
			break
		}
		buf := make([]uint16, 256)
		tam := uintptr(len(buf))
		r, _, _ := procRegEnumKeyEx.Call(
			uintptr(k),
			uintptr(i),
			uintptr(unsafe.Pointer(&buf[0])),
			uintptr(unsafe.Pointer(&tam)),
			0, 0, 0, 0,
		)
		if r == 259 { // ERROR_NO_MORE_ITEMS
			break
		}
		if e := errnoErro(r); e != nil {
			return out, e
		}
		out = append(out, syscall.UTF16ToString(buf))
	}
	return out, nil
}

// GetStringValue lê um valor REG_SZ/EXPAND_SZ.
func (k Key) GetStringValue(nome string) (string, error) {
	p, err := syscall.UTF16PtrFromString(nome)
	if err != nil {
		return "", err
	}
	var tipo uint32
	var tam uint32
	r, _, _ := procRegQueryVal.Call(
		uintptr(k),
		uintptr(unsafe.Pointer(p)),
		0,
		uintptr(unsafe.Pointer(&tipo)),
		0,
		uintptr(unsafe.Pointer(&tam)),
	)
	if e := errnoErro(r); e != nil {
		return "", e
	}
	if tam == 0 {
		return "", nil
	}
	buf := make([]byte, tam)
	r, _, _ = procRegQueryVal.Call(
		uintptr(k),
		uintptr(unsafe.Pointer(p)),
		0,
		uintptr(unsafe.Pointer(&tipo)),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&tam)),
	)
	if e := errnoErro(r); e != nil {
		return "", e
	}
	u := make([]uint16, len(buf)/2)
	for i := range u {
		u[i] = uint16(buf[2*i]) | uint16(buf[2*i+1])<<8
	}
	return syscall.UTF16ToString(u), nil
}
