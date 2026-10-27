/** URL da API usada pelos clientes (web usa proxy do Vite; desktop fala direto). */
export const DEFAULT_API_URL = 'http://localhost:3000/api';

/** Caminho relativo usado pelo Vite para o proxy em dev (`/api` -> `http://localhost:3000`). */
export const API_BASE_PATH = '/api';

/** Intervalo sugerido entre claims quando a fila está vazia (ms). */
export const CLAIM_POLL_INTERVAL_MS = 2000;
