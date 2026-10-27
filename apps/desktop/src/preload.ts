import { contextBridge, ipcRenderer } from 'electron';
import type {
  ConfigInicial,
  EstadoDaemon,
  LeandroApi,
  PedidoAtrelar,
} from './preload-api';

/**
 * Única ponte entre o renderer (sem Node, sem token) e o processo principal,
 * que é o cliente do daemon printd.
 */
const api: LeandroApi = {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },

  daemon: () => ipcRenderer.invoke('desktop:daemon'),
  estado: () => ipcRenderer.invoke('desktop:estado'),
  onEstado: (callback) => {
    ipcRenderer.on('desktop:estado', (_evento, estado: EstadoDaemon | null) => callback(estado));
  },

  salvarConfig: (config: ConfigInicial) => ipcRenderer.invoke('desktop:salvar-config', config),

  filas: () => ipcRenderer.invoke('desktop:filas'),
  atrelar: (pedido: PedidoAtrelar) => ipcRenderer.invoke('desktop:atrelar', pedido),
  desatrelar: (printerId: string) => ipcRenderer.invoke('desktop:desatrelar', { printerId }),

  buscaBt: (scan: boolean) => ipcRenderer.invoke('desktop:busca-bt', { scan }),
  buscaUsb: () => ipcRenderer.invoke('desktop:busca-usb'),

  testar: (id: string) => ipcRenderer.invoke('desktop:testar', { id }),
  iniciarDaemon: () => ipcRenderer.invoke('desktop:iniciar-daemon'),

  log: (mensagem) => ipcRenderer.send('desktop:log', mensagem),
  onLog: (callback) => {
    ipcRenderer.on('desktop:log', (_evento, mensagem: string) => callback(mensagem));
  },
};

contextBridge.exposeInMainWorld('leandro', api);
