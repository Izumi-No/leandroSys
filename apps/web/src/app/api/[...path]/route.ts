async function criarAplicacao() {
  const { createApp } = await import('@leandrosys/api/app');
  return createApp();
}

type ApiApp = Awaited<ReturnType<typeof criarAplicacao>>;

let appPromise: Promise<ApiApp> | undefined;

async function encaminhar(request: Request): Promise<Response> {
  appPromise ??= criarAplicacao();
  const app = await appPromise;
  const response = await app.fetch(request);
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = encaminhar;
export const HEAD = encaminhar;
export const POST = encaminhar;
export const PUT = encaminhar;
export const PATCH = encaminhar;
export const DELETE = encaminhar;
export const OPTIONS = encaminhar;
