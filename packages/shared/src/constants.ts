/** URL local da API usada pelo desktop e daemon de impressão. */
export const DEFAULT_API_URL = 'http://localhost:3001/api';

/** Caminho same-origin encaminhado pelo proxy Route Handler do Next.js. */
export const API_BASE_PATH = '/api';

/** Intervalo sugerido entre claims quando a fila está vazia (ms). */
export const CLAIM_POLL_INTERVAL_MS = 2000;
