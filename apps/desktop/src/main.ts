import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { GerenciadorDaemon } from './daemon';
import type {
  ConfigInicial,
  DispositivoBT,
  DispositivoUSB,
  EstadoDaemon,
  FilaImpressao,
  ImpAtrelada,
  PedidoAtrelar,
} from './preload-api';

/**
 * Electron = cliente fino do printd (daemon em Go, dono da fila). Aqui a UI
 * só observa e manda intenções; quem fala com a API e transmite para as
 * impressoras é o daemon local em 127.0.0.1.
 */

let janela: BrowserWindow | null = null;

const log = (mensagem: string): void => {
  console.log(`[desktop] ${mensagem}`);
  janela?.webContents.send('desktop:log', mensagem);
};

const daemon = new GerenciadorDaemon(log);

function criarJanela(): BrowserWindow {
  const nova = new BrowserWindow({
    width: 1080,
    height: 760,
    title: 'leandroSys — Impressão',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void nova.loadFile(path.join(__dirname, 'renderer/index.html'));
  nova.on('closed', () => {
    janela = null;
  });
  return nova;
}

// ---------------------------------------------------------------------------
// IPC — a UI fala com o daemon local via main.
// ---------------------------------------------------------------------------

ipcMain.handle('desktop:daemon', () => ({ base: daemon.endereco, disponivel: daemon.estaDisponivel }));

ipcMain.handle('desktop:estado', async (): Promise<EstadoDaemon | null> => {
  await daemon.garantir();
  try {
    return await daemon.chamar<EstadoDaemon>('GET', '/estado');
  } catch {
    return null;
  }
});

ipcMain.handle('desktop:salvar-config', (_evento, config: ConfigInicial) =>
  daemon.chamar<{ ok: boolean; configurado: boolean }>('POST', '/config', config),
);

ipcMain.handle('desktop:filas', () =>
  daemon.chamar<{ filas: FilaImpressao[] }>('GET', '/filas'),
);

ipcMain.handle('desktop:atrelar', (_evento, pedido: PedidoAtrelar) =>
  daemon.chamar<{ impressora: ImpAtrelada }>('POST', '/atrelar', pedido),
);

ipcMain.handle('desktop:desatrelar', (_evento, alvo: { printerId: string }) =>
  daemon.chamar<{ ok: boolean }>('POST', '/desatrelar', alvo),
);

ipcMain.handle('desktop:busca-bt', async (_evento, opcoes: { scan?: boolean }) => {
  await daemon.garantir();
  try {
    return await daemon.chamar<{ dispositivos: DispositivoBT[] }>(
      'GET',
      `/dispositivos${opcoes?.scan ? '?scan=1' : ''}`,
    );
  } catch {
    return { dispositivos: [] };
  }
});

ipcMain.handle('desktop:busca-usb', () =>
  daemon.chamar<{ dispositivos: DispositivoUSB[] }>('GET', '/dispositivos/usb'),
);

ipcMain.handle('desktop:testar', (_evento, alvo: { id: string }) =>
  daemon.chamar<{ jobId: string }>('POST', `/impressoras/${alvo.id}/teste`, {}),
);

ipcMain.handle('desktop:iniciar-daemon', () => {
  daemon.esquecerProcesso(); // zera o intervalo mínimo e tenta de novo
  return daemon.garantir();
});

// ---------------------------------------------------------------------------
// Bootstrap: janela + daemon + polling de 1s empurrado para o renderer.
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  janela = criarJanela();

  const iniciado = await daemon.garantir();
  log(iniciado ? `daemon em ${daemon.endereco}` : 'daemon offline — a UI mostra o botão de iniciar');

  setInterval(async () => {
    if (!janela) return;
    await daemon.garantir();

    let estado: EstadoDaemon | null = null;
    try {
      estado = await daemon.chamar<EstadoDaemon>('GET', '/estado');
    } catch {
      estado = null;
    }
    janela.webContents.send('desktop:estado', estado);
  }, 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) janela = criarJanela();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
