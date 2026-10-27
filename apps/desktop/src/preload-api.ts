/**
 * Contratos do daemon printd (API local em 127.0.0.1) e do preload. O renderer
 * não tem token nem fetch: tudo passa pelo main, que é o cliente do daemon.
 */

export type EstadoImpressora = {
  id: string;
  nome: string;
  endereco: string;
  transporte: string;
  baud?: number;
  estado: 'ociosa' | 'imprimindo' | 'sem-transporte' | 'backoff' | 'parada';
  ultimoJob?: string;
  ultimoResultado?: 'ok' | 'falha';
  ultimoErro?: string;
  impressos: number;
  falhas: number;
  /** epoch ms da próxima tentativa (só em backoff). */
  proximaTentativaEm?: number;
};

export type LinhaLog = { hora: string; texto: string };

export type ConfigInicial = {
  apiUrl: string;
  usuario: string;
  senha: string;
};

export type EstadoDaemon = {
  /** false = a UI mostra a tela de configuração (digitada uma única vez). */
  configurado: boolean;
  config: ConfigInicial;
  /** Identidade estável desta máquina (quem reivindica as filas na API). */
  agenteId: string;
  agenteNome: string;
  ligado: boolean;
  api: string;
  apiOk: boolean;
  estados: EstadoImpressora[];
  log: LinhaLog[];
};

export type DispositivoBT = { mac: string; nome: string };

export type DispositivoUSB = {
  caminho: string;
  nome: string;
  classe: 'serial' | 'printer';
  /** Caminho real quando o listado é um symlink de /dev/serial/by-id. */
  detalhe?: string;
};

/** Fila cadastrada no admin (a mesma que o daemon pode atrelar ao hardware). */
export type FilaImpressao = {
  id: string;
  name: string;
  address: string;
  transport: 'BLUETOOTH' | 'USB' | 'NETWORK';
  columns: number;
  codepage: number;
  active: boolean;
  pendingJobs: number;
  baud: number | null;
  agentId: string | null;
  agentName: string | null;
  boundAt: string | null;
};

export type Transporte = 'BLUETOOTH' | 'USB' | 'NETWORK';

/** Dispositivo físico escolhido na descoberta local. */
export type DispositivoAtrelavel = {
  endereco: string;
  nome?: string;
  transporte: Transporte;
  baud?: number;
};

export type PedidoAtrelar = {
  printerId: string;
  endereco: string;
  transporte: Transporte;
  baud?: number;
};

export type ImpAtrelada = {
  id: string;
  nome: string;
  endereco: string;
  transporte: string;
  baud?: number;
  colunas: number;
  codepage: number;
};

/** Contrato exposto pelo preload ao renderer (`window.leandro`). */
export type LeandroApi = {
  versions: { electron?: string; node?: string; chrome?: string };

  daemon: () => Promise<{ base: string; disponivel: boolean }>;
  /** Snapshot do daemon (null = offline). */
  estado: () => Promise<EstadoDaemon | null>;
  onEstado: (callback: (estado: EstadoDaemon | null) => void) => void;

  salvarConfig: (config: ConfigInicial) => Promise<{ ok: boolean; configurado: boolean }>;

  /** Filas cadastradas no admin, com o agente atualmente vinculado. */
  filas: () => Promise<{ filas: FilaImpressao[] }>;
  /** Atrela uma fila existente a um dispositivo local descoberto. */
  atrelar: (pedido: PedidoAtrelar) => Promise<{ impressora: ImpAtrelada }>;
  /** Libera a fila (some da API e do printd.json). */
  desatrelar: (printerId: string) => Promise<{ ok: boolean }>;

  /** Lista aparelhos Bluetooth; com scan=true faz varredura (~10s). */
  buscaBt: (scan: boolean) => Promise<{ dispositivos: DispositivoBT[] }>;
  /** Lista portas seriais USB e impressoras /dev/usb/lp*. */
  buscaUsb: () => Promise<{ dispositivos: DispositivoUSB[] }>;

  testar: (id: string) => Promise<{ jobId: string }>;
  iniciarDaemon: () => Promise<boolean>;

  log: (mensagem: string) => void;
  onLog: (callback: (mensagem: string) => void) => void;
};
