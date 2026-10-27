import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * O printd (daemon em Go) é o dono da fila: ele fala com a API, drena os jobs
 * e transmite para as impressoras. O Electron é só um cliente de UI — este
 * módulo garante que o daemon esteja de pé (lê porta/token do printd.json,
 * responde ping, e spawna o binário se ninguém estiver ouvindo).
 */

type ConfigPrintd = { porta?: number; token?: string };

const espera = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Caminho do config, alinhado com o do daemon (os.UserConfigDir()). */
function caminhoConfig(): string {
  if (process.env['PRINTD_CONFIG']) return process.env['PRINTD_CONFIG'];
  const base = process.env['XDG_CONFIG_HOME'] ?? path.join(os.homedir(), '.config');
  return path.join(base, 'leandrosys', 'printd.json');
}

export class GerenciadorDaemon {
  private base = 'http://127.0.0.1:7411';
  private token = '';
  private processo: ChildProcess | null = null;
  private ultimaTentativa = 0;
  private disponivel = false;
  private readonly log: (mensagem: string) => void;

  constructor(log: (mensagem: string) => void) {
    this.log = log;
  }

  get endereco(): string {
    return this.base;
  }

  get estaDisponivel(): boolean {
    return this.disponivel;
  }

  /** Relê porta/token do config e testa /estado. */
  async pingar(): Promise<boolean> {
    let config: ConfigPrintd = {};
    try {
      config = JSON.parse(readFileSync(caminhoConfig(), 'utf8')) as ConfigPrintd;
    } catch {
      // daemon ainda não rodou nesta máquina
    }
    this.base = `http://127.0.0.1:${config.porta ?? 7411}`;
    this.token = config.token ?? '';
    if (!this.token) {
      this.disponivel = false;
      return false;
    }

    try {
      const resposta = await fetch(`${this.base}/estado`, {
        headers: { 'X-Printd-Token': this.token },
        signal: AbortSignal.timeout(1500),
      });
      this.disponivel = resposta.ok;
    } catch {
      this.disponivel = false;
    }
    return this.disponivel;
  }

  /** Garante o daemon vivo: pinga; se cair, tenta subir (com intervalo mínimo). */
  async garantir(): Promise<boolean> {
    if (await this.pingar()) return true;

    const agora = Date.now();
    if (agora - this.ultimaTentativa < 5000) return false;
    this.ultimaTentativa = agora;
    return this.iniciar();
  }

  /** Chamada do daemon local (o token vem do próprio printd.json). */
  async chamar<T>(metodo: string, rota: string, corpo?: unknown): Promise<T> {
    const resposta = await fetch(`${this.base}${rota}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'X-Printd-Token': this.token },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(30_000),
    });

    const dados = (await resposta.json().catch(() => ({}))) as { error?: string };
    if (!resposta.ok) throw new Error(dados.error ?? `HTTP ${resposta.status}`);
    return dados as T;
  }

  /** Encerra a referência ao filho (o daemon é desanexado e continua vivo:
   * fechar a UI não pode parar a impressão — ele é um serviço). */
  esquecerProcesso(): void {
    this.processo = null;
    this.ultimaTentativa = 0;
  }

  // -------------------------------------------------------------------------

  private candidatosBinario(): string[] {
    const lista: string[] = [];
    if (process.env['PRINTD_BIN']) lista.push(process.env['PRINTD_BIN']);
    // dev: apps/printd/bin/printd ao lado deste app (dist/main.js → ../../printd/bin/printd)
    lista.push(path.join(__dirname, '..', '..', 'printd', 'bin', 'printd'));
    lista.push(path.join(process.cwd(), 'apps', 'printd', 'bin', 'printd'));
    lista.push('printd'); // PATH do sistema (instalação global)
    return lista;
  }

  private async iniciar(): Promise<boolean> {
    for (const binario of this.candidatosBinario()) {
      const processo = this.spawnar(binario);

      // O spawn é assíncrono: binário inexistente vira evento 'error'.
      const situacao = await Promise.race([
        new Promise<string>((resolve) => {
          processo.once('spawn', () => resolve('ok'));
          processo.once('error', (erro: NodeJS.ErrnoException) =>
            resolve(erro.code === 'ENOENT' ? 'ausente' : `erro: ${erro.message}`),
          );
        }),
        espera(2000).then(() => 'timeout'),
      ]);
      if (situacao !== 'ok') {
        if (situacao !== 'ausente') this.log(`binário ${binario}: ${situacao}`);
        continue;
      }

      this.processo = processo;
      for (let i = 0; i < 50; i += 1) {
        if (await this.pingar()) {
          this.log(`daemon printd iniciado em ${this.base} (sobrevive a este app)`);
          return true;
        }
        await espera(200);
      }
      this.log(`binário ${binario} não respondeu em ${this.base}`);
      processo.kill('SIGTERM');
      this.processo = null;
    }

    this.log('printd não encontrado — rode `pnpm --filter @leandrosys/printd build`');
    return false;
  }

  private spawnar(binario: string): ChildProcess {
    // Desanexado (detached + unref): vira serviço da máquina. stdio 'ignore'
    // evita SIGPIPE caso o terminal do Electron feche com o daemon em background.
    const filho = spawn(binario, [], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    filho.unref();

    filho.on('exit', (codigo, sinal) => {
      if (this.processo !== filho) return;
      this.processo = null;
      this.disponivel = false;
      this.log(`printd encerrou (código ${codigo ?? sinal})`);
    });
    return filho;
  }
}
