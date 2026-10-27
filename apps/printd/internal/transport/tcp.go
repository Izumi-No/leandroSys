package transport

import (
	"context"
	"net"
	"time"
)

const (
	portaPadrao  = "9100" // porta padrão ESC/POS
	tempoConexao = 15 * time.Second
)

// enviarTCP escreve os bytes crus na impressora de rede e fecha a conexão.
func enviarTCP(ctx context.Context, endereco string, dados []byte) Resultado {
	alvo := endereco
	if _, _, err := net.SplitHostPort(endereco); err != nil {
		// Sem porta informada → 9100 (padrão ESC/POS).
		alvo = net.JoinHostPort(endereco, portaPadrao)
	}

	dialer := net.Dialer{Timeout: tempoConexao}
	con, err := dialer.DialContext(ctx, "tcp", alvo)
	if err != nil {
		return falha("conexão com %s: %s", alvo, err)
	}
	defer con.Close()

	prazo := time.Now().Add(tempoConexao)
	if dl, ok := ctx.Deadline(); ok && dl.Before(prazo) {
		prazo = dl
	}
	_ = con.SetDeadline(prazo)

	if _, err := con.Write(dados); err != nil {
		return falha("envio para %s: %s", alvo, err)
	}
	// Fechamento gracioso: o kernel descarrega o que restou no buffer.
	return Resultado{Ok: true}
}
