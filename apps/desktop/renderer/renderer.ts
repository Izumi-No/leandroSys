import type {
  DispositivoAtrelavel,
  DispositivoBT,
  DispositivoUSB,
  EstadoDaemon,
  EstadoImpressora,
  FilaImpressao,
  PedidoAtrelar,
} from '../src/preload-api';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const no = document.getElementById(id);
  if (!no) throw new Error(`#${id} não encontrado`);
  return no as T;
};

const api = window.leandro;

const daemonEl = el('daemon');
const apiEl = el('api-status');
const concEl = el('concentrador');
const enderecoEl = el('daemon-endereco');
const agenteNomeEl = el('agente-nome');
const agenteIdEl = el('agente-id');
const offlineEl = el('offline');
const iniciarBtn = el<HTMLButtonElement>('iniciar-daemon');

const configSection = el('config');
const configForm = el<HTMLFormElement>('config-form');
const configErroEl = el('config-erro');

const dispositivosSection = el('dispositivos-secao');
const buscarBtBtn = el<HTMLButtonElement>('buscar-bt');
const buscarUsbBtn = el<HTMLButtonElement>('buscar-usb');
const dispositivosBtEl = el<HTMLUListElement>('dispositivos-bt');
const dispositivosUsbEl = el<HTMLUListElement>('dispositivos-usb');
const redeForm = el<HTMLFormElement>('rede-form');
const dispositivosErroEl = el('dispositivos-erro');

const atrelarSection = el('atrelar-secao');
const atrelarDispositivoEl = el('atrelar-dispositivo');
const baudWrap = el('baud-wrap');
const baudSelect = el<HTMLSelectElement>('atrelar-baud');
const filasLista = el('filas-lista');
const atrelarErroEl = el('atrelar-erro');
const confirmarAtrelarBtn = el<HTMLButtonElement>('confirmar-atrelar');
const cancelarAtrelarBtn = el<HTMLButtonElement>('cancelar-atrelar');

const atreladasSection = el('atreladas-secao');
const impressorasEl = el<HTMLUListElement>('impressoras');
const vazioEl = el('vazio');
const logEl = el<HTMLUListElement>('log');
const versoesEl = el('versoes');

const texto = (valor: unknown): string => (valor instanceof Error ? valor.message : String(valor));

let configJaPreenchida = false;
let ultimoEstado: EstadoDaemon | null = null;
let dispositivoPendente: DispositivoAtrelavel | null = null;
let filasCache: FilaImpressao[] = [];
let buscouUsb = false;

function logLocal(mensagem: string): void {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} — ${mensagem}`;
  logEl.prepend(item);
}

const rotulos: Record<EstadoImpressora['estado'], string> = {
  ociosa: 'ociosa',
  imprimindo: 'imprimindo',
  'sem-transporte': 'sem transporte',
  backoff: 'API indisponível',
  parada: 'parada',
};

const rotulosTransporte: Record<string, string> = {
  BLUETOOTH: 'Bluetooth',
  USB: 'USB',
  NETWORK: 'Rede',
};

// ---------------------------------------------------------------------------
// Render (estado do daemon, 1x por segundo)
// ---------------------------------------------------------------------------

function renderizar(estado: EstadoDaemon | null): void {
  ultimoEstado = estado;

  if (!estado) {
    daemonEl.textContent = 'daemon offline';
    daemonEl.className = 'badge erro';
    apiEl.textContent = '—';
    apiEl.className = 'badge';
    concEl.textContent = '—';
    concEl.className = 'badge';
    offlineEl.hidden = false;
    configSection.hidden = true;
    dispositivosSection.hidden = true;
    atrelarSection.hidden = true;
    atreladasSection.hidden = true;
    return;
  }

  offlineEl.hidden = true;

  daemonEl.textContent = 'daemon online';
  daemonEl.className = 'badge ok';
  apiEl.textContent = estado.apiOk ? 'API conectada' : 'API indisponível';
  apiEl.className = `badge ${estado.apiOk ? 'ok' : 'erro'}`;
  concEl.textContent = estado.ligado ? 'concentrador ligado' : 'concentrador parado';
  concEl.className = `badge ${estado.ligado ? 'ok' : ''}`;

  agenteNomeEl.textContent = estado.agenteNome || '—';
  agenteIdEl.textContent = estado.agenteId || '—';

  // Configuração: só aparece enquanto não estiver completa (1x na vida).
  configSection.hidden = estado.configurado;
  dispositivosSection.hidden = !estado.configurado;
  atreladasSection.hidden = !estado.configurado;
  atrelarSection.hidden = !estado.configurado || !dispositivoPendente;

  if (!estado.configurado && !configJaPreenchida) {
    preencherConfig(estado.config);
    configJaPreenchida = true;
  }

  renderizarImpressoras(estado);
  renderizarLog(estado);

  if (estado.configurado && !buscouUsb) {
    buscouUsb = true;
    void buscarUsb();
  }
}

function preencherConfig(config: EstadoDaemon['config']): void {
  const campos: Record<string, string> = {
    apiUrl: config.apiUrl || 'http://localhost:3001/api',
    usuario: config.usuario || 'impressora',
    senha: config.senha,
  };
  for (const [nome, valor] of Object.entries(campos)) {
    const campo = configForm.elements.namedItem(nome);
    if (campo instanceof HTMLInputElement) campo.value = valor;
  }
}

function renderizarImpressoras(estado: EstadoDaemon): void {
  impressorasEl.replaceChildren(...estado.estados.map(criarItem));
  vazioEl.hidden = estado.estados.length > 0;
}

function criarItem(imp: EstadoImpressora): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'impressora';

  const nome = document.createElement('span');
  nome.className = 'nome';
  nome.textContent = imp.nome;

  const detalhe = document.createElement('span');
  detalhe.className = 'detalhe';
  const baud = imp.transporte === 'USB' && imp.baud ? ` · ${imp.baud} baud` : '';
  detalhe.textContent = `${imp.transporte} · ${imp.endereco}${baud}`;

  const estadoNo = document.createElement('span');
  estadoNo.className = `estado ${imp.estado}`;
  estadoNo.textContent = rotulos[imp.estado];

  item.append(nome, detalhe, estadoNo);

  if (imp.impressos > 0 || imp.falhas > 0) {
    const contagem = document.createElement('span');
    contagem.className = 'contagem';
    contagem.textContent = `✓ ${imp.impressos} · ⚠ ${imp.falhas}`;
    item.append(contagem);
  }

  if (imp.ultimoErro) {
    const falha = document.createElement('span');
    falha.className = 'falha';
    falha.textContent = imp.ultimoErro;
    item.append(falha);
  }

  const acoes = document.createElement('span');
  acoes.className = 'acoes';

  const teste = document.createElement('button');
  teste.type = 'button';
  teste.textContent = 'Cupom de teste';
  teste.addEventListener('click', () => void testarImpressora(imp));

  const tirar = document.createElement('button');
  tirar.type = 'button';
  tirar.className = 'secundario';
  tirar.textContent = 'Desatrelar';
  tirar.addEventListener('click', () => void desatrelar(imp));

  acoes.append(teste, tirar);
  item.append(acoes);
  return item;
}

function renderizarLog(estado: EstadoDaemon): void {
  const fragmento = document.createDocumentFragment();
  for (const linha of [...estado.log].reverse()) {
    const item = document.createElement('li');
    item.textContent = `${linha.hora} — ${linha.texto}`;
    fragmento.append(item);
  }
  logEl.replaceChildren(fragmento);
}

// ---------------------------------------------------------------------------
// Descoberta de dispositivos
// ---------------------------------------------------------------------------

async function buscarBt(): Promise<void> {
  dispositivosErroEl.textContent = '';
  buscarBtBtn.disabled = true;
  buscarBtBtn.textContent = 'buscando… (~10s)';

  try {
    const r = await api.buscaBt(true);
    renderizarDispositivosBt(r.dispositivos);
    logLocal(`${r.dispositivos.length} aparelho(s) Bluetooth encontrado(s)`);
  } catch (erro) {
    dispositivosErroEl.textContent = texto(erro);
    logLocal(`busca Bluetooth falhou: ${texto(erro)}`);
  } finally {
    buscarBtBtn.disabled = false;
    buscarBtBtn.textContent = 'Buscar aparelhos (~10s)';
  }
}

function renderizarDispositivosBt(dispositivos: DispositivoBT[]): void {
  if (dispositivos.length === 0) {
    const item = document.createElement('li');
    item.className = 'vazio-lista';
    item.textContent = 'Nenhum aparelho encontrado. Confira o Bluetooth ligado.';
    dispositivosBtEl.replaceChildren(item);
    return;
  }

  const fragmento = document.createDocumentFragment();
  for (const d of dispositivos) {
    const item = document.createElement('li');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'dispositivo';
    botao.textContent = `${d.nome || 'Sem nome'} — ${d.mac}`;
    botao.addEventListener('click', () => {
      escolherDispositivo({
        endereco: d.mac,
        nome: d.nome || undefined,
        transporte: 'BLUETOOTH',
      });
    });
    item.append(botao);
    fragmento.append(item);
  }
  dispositivosBtEl.replaceChildren(fragmento);
}

async function buscarUsb(): Promise<void> {
  dispositivosErroEl.textContent = '';
  buscarUsbBtn.disabled = true;
  buscarUsbBtn.textContent = 'Atualizando…';

  try {
    const r = await api.buscaUsb();
    renderizarDispositivosUsb(r.dispositivos);
  } catch (erro) {
    dispositivosErroEl.textContent = texto(erro);
    logLocal(`busca USB falhou: ${texto(erro)}`);
  } finally {
    buscarUsbBtn.disabled = false;
    buscarUsbBtn.textContent = 'Atualizar USB';
  }
}

function renderizarDispositivosUsb(dispositivos: DispositivoUSB[]): void {
  if (dispositivos.length === 0) {
    const item = document.createElement('li');
    item.className = 'vazio-lista';
    item.textContent = 'Nenhuma porta serial ou impressora USB encontrada.';
    dispositivosUsbEl.replaceChildren(item);
    return;
  }

  const fragmento = document.createDocumentFragment();
  for (const d of dispositivos) {
    const item = document.createElement('li');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'dispositivo';
    const classe = d.classe === 'printer' ? 'impressora USB' : 'serial USB';
    botao.textContent = `${d.nome} — ${d.caminho}`;
    botao.title = `${classe}${d.detalhe ? ` → ${d.detalhe}` : ''}`;
    botao.addEventListener('click', () => {
      escolherDispositivo({
        endereco: d.caminho,
        nome: d.nome,
        transporte: 'USB',
      });
    });
    item.append(botao);
    fragmento.append(item);
  }
  dispositivosUsbEl.replaceChildren(fragmento);
}

function escolherDispositivo(dispositivo: DispositivoAtrelavel): void {
  dispositivoPendente = dispositivo;
  atrelarErroEl.textContent = '';
  atrelarDispositivoEl.textContent = `${dispositivo.nome ?? rotulosTransporte[dispositivo.transporte]} · ${dispositivo.endereco}`;
  baudWrap.hidden = dispositivo.transporte !== 'USB';
  baudSelect.value = String(dispositivo.baud ?? 9600);
  atrelarSection.hidden = false;
  filasLista.replaceChildren();
  void carregarFilas();
  atrelarSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------------------------------------------------------------------------
// Atrelar uma fila do admin ao dispositivo escolhido
// ---------------------------------------------------------------------------

async function carregarFilas(): Promise<void> {
  atrelarErroEl.textContent = '';
  const carregando = document.createElement('p');
  carregando.className = 'ajuda';
  carregando.textContent = 'carregando filas do admin…';
  filasLista.replaceChildren(carregando);

  try {
    const r = await api.filas();
    filasCache = r.filas;
    renderizarFilas();
  } catch (erro) {
    filasCache = [];
    filasLista.replaceChildren();
    atrelarErroEl.textContent = texto(erro);
  }
}

function renderizarFilas(): void {
  if (filasCache.length === 0) {
    const vazio = document.createElement('p');
    vazio.className = 'ajuda';
    vazio.textContent =
      'Nenhuma fila cadastrada. Crie a fila no admin (Impressoras) e volte aqui.';
    filasLista.replaceChildren(vazio);
    return;
  }

  const fragmento = document.createDocumentFragment();
  let primeiroLivre: HTMLInputElement | null = null;

  for (const fila of filasCache) {
    const minha = Boolean(
      fila.agentId && ultimoEstado && fila.agentId === ultimoEstado.agenteId,
    );
    const deOutro = Boolean(fila.agentId && !minha);

    const rotulo = document.createElement('label');
    rotulo.className = `fila-opcao${deOutro ? ' indisponivel' : ''}`;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'fila';
    radio.value = fila.id;
    radio.disabled = deOutro;

    const corpo = document.createElement('span');
    corpo.className = 'fila-corpo';

    const nome = document.createElement('span');
    nome.className = 'fila-nome';
    nome.textContent = fila.name;

    const meta = document.createElement('span');
    meta.className = 'fila-meta';
    const pendentes = fila.pendingJobs > 0 ? ` · ${fila.pendingJobs} pendente(s)` : '';
    meta.textContent = `${rotulosTransporte[fila.transport] ?? fila.transport} · ${
      fila.address || 'sem dispositivo'
    }${pendentes}`;

    const situacao = document.createElement('span');
    situacao.className = 'fila-situacao';
    if (deOutro) {
      situacao.textContent = `atrelada a ${fila.agentName ?? 'outro agente'}`;
    } else if (minha) {
      situacao.textContent = 'nesta máquina';
    } else {
      situacao.textContent = 'livre';
    }
    if (!fila.active) situacao.textContent += ' · inativa';

    corpo.append(nome, meta);
    rotulo.append(radio, corpo, situacao);

    if (!deOutro && !primeiroLivre) primeiroLivre = radio;
    fragmento.append(rotulo);
  }

  filasLista.replaceChildren(fragmento);
  if (primeiroLivre) primeiroLivre.checked = true;
}

async function confirmarAtrelar(): Promise<void> {
  if (!dispositivoPendente) return;

  const selecionado = filasLista.querySelector<HTMLInputElement>('input[name="fila"]:checked');
  if (!selecionado) {
    atrelarErroEl.textContent = 'Escolha uma fila livre para atrelar.';
    return;
  }

  atrelarErroEl.textContent = '';
  confirmarAtrelarBtn.disabled = true;
  confirmarAtrelarBtn.textContent = 'Atrelando…';

  const pedido: PedidoAtrelar = {
    printerId: selecionado.value,
    endereco: dispositivoPendente.endereco,
    transporte: dispositivoPendente.transporte,
  };
  if (dispositivoPendente.transporte === 'USB') {
    pedido.baud = Number(baudSelect.value) || 9600;
  }

  try {
    const r = await api.atrelar(pedido);
    logLocal(`${r.impressora.nome} atrelada a ${dispositivoPendente.endereco}`);
    dispositivoPendente = null;
    filasCache = [];
    filasLista.replaceChildren();
    atrelarSection.hidden = true;
    await recarregarEstado();
  } catch (erro) {
    atrelarErroEl.textContent = texto(erro);
    logLocal(`falha ao atrelar: ${texto(erro)}`);
  } finally {
    confirmarAtrelarBtn.disabled = false;
    confirmarAtrelarBtn.textContent = 'Atrelar fila';
  }
}

function cancelarAtrelar(): void {
  dispositivoPendente = null;
  filasCache = [];
  filasLista.replaceChildren();
  atrelarErroEl.textContent = '';
  atrelarSection.hidden = true;
}

// ---------------------------------------------------------------------------
// Ações das filas atreladas
// ---------------------------------------------------------------------------

async function testarImpressora(imp: EstadoImpressora): Promise<void> {
  try {
    const r = await api.testar(imp.id);
    logLocal(`cupom de teste enfileirado para ${imp.nome} (job ${r.jobId.slice(0, 8)}…)`);
  } catch (erro) {
    logLocal(`falha no cupom de teste: ${texto(erro)}`);
  }
}

async function desatrelar(imp: EstadoImpressora): Promise<void> {
  try {
    await api.desatrelar(imp.id);
    logLocal(`${imp.nome} desatrelada desta máquina`);
    await recarregarEstado();
  } catch (erro) {
    logLocal(`falha ao desatrelar: ${texto(erro)}`);
  }
}

async function recarregarEstado(): Promise<void> {
  try {
    renderizar(await api.estado());
  } catch {
    renderizar(null);
  }
}

// ---------------------------------------------------------------------------
// Formulários
// ---------------------------------------------------------------------------

configForm.addEventListener('submit', (evento) => {
  evento.preventDefault();
  const dados = new FormData(configForm);
  configErroEl.textContent = '';

  void (async () => {
    try {
      await api.salvarConfig({
        apiUrl: String(dados.get('apiUrl') ?? ''),
        usuario: String(dados.get('usuario') ?? ''),
        senha: String(dados.get('senha') ?? ''),
      });
      logLocal('configuração salva e credenciais validadas — concentrador ligado');
      await recarregarEstado();
    } catch (erro) {
      configErroEl.textContent = texto(erro);
    }
  })();
});

redeForm.addEventListener('submit', (evento) => {
  evento.preventDefault();
  dispositivosErroEl.textContent = '';

  const dados = new FormData(redeForm);
  const host = String(dados.get('host') ?? '').trim();
  const porta = String(dados.get('porta') ?? '').trim() || '9100';
  if (!host) {
    dispositivosErroEl.textContent = 'informe o host ou IP da impressora';
    return;
  }

  const endereco = host.includes(':') || porta === '9100' ? host : `${host}:${porta}`;
  escolherDispositivo({ endereco, nome: `Rede ${host}`, transporte: 'NETWORK' });
});

buscarBtBtn.addEventListener('click', () => void buscarBt());
buscarUsbBtn.addEventListener('click', () => void buscarUsb());
confirmarAtrelarBtn.addEventListener('click', () => void confirmarAtrelar());
cancelarAtrelarBtn.addEventListener('click', cancelarAtrelar);

iniciarBtn.addEventListener('click', () => {
  iniciarBtn.disabled = true;
  iniciarBtn.textContent = 'iniciando…';
  void (async () => {
    const ok = await api.iniciarDaemon();
    logLocal(ok ? 'daemon iniciado' : 'não consegui iniciar o printd — veja o log');
    await atualizarEndereco();
    iniciarBtn.disabled = false;
    iniciarBtn.textContent = 'Iniciar daemon';
  })();
});

async function atualizarEndereco(): Promise<void> {
  try {
    const info = await api.daemon();
    enderecoEl.textContent = info.base;
  } catch {
    enderecoEl.textContent = '—';
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

versoesEl.textContent = `electron ${api.versions.electron ?? '?'} · node ${api.versions.node ?? '?'} · chrome ${api.versions.chrome ?? '?'}`;
void atualizarEndereco();

api.onLog((mensagem) => {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} — ${mensagem}`;
  logEl.prepend(item);
});
api.onEstado(renderizar);
void api.estado().then(renderizar);
