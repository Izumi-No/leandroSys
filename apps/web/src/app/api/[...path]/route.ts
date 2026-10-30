type Context = {
  params: Promise<{ path: string[] }>;
};

const requestHeaders = ['accept', 'authorization', 'content-type', 'x-request-id'];
const responseHeaders = ['content-type', 'etag', 'retry-after', 'vary'];

async function encaminhar(request: Request, context: Context): Promise<Response> {
  const configuredOrigin =
    process.env.API_ORIGIN ??
    (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3001' : undefined);

  if (!configuredOrigin) {
    return Response.json(
      { error: 'A origem da API não foi configurada', code: 'API_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  let origin: URL;
  try {
    origin = new URL(configuredOrigin);
  } catch {
    return Response.json(
      { error: 'A origem da API está inválida', code: 'API_MISCONFIGURED' },
      { status: 500 },
    );
  }

  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    return Response.json(
      { error: 'API_ORIGIN deve conter apenas a origem HTTP(S)', code: 'API_MISCONFIGURED' },
      { status: 500 },
    );
  }

  const { path } = await context.params;
  const destino = new URL(`/api/${path.map(encodeURIComponent).join('/')}`, origin);
  destino.search = new URL(request.url).search;

  const headers = new Headers();
  for (const name of requestHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();

  try {
    const upstream = await fetch(destino, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
    });
    const forwardedHeaders = new Headers();
    for (const name of responseHeaders) {
      const value = upstream.headers.get(name);
      if (value) forwardedHeaders.set(name, value);
    }
    forwardedHeaders.set('cache-control', 'no-store');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: forwardedHeaders,
    });
  } catch {
    return Response.json(
      { error: 'A API está indisponível', code: 'API_UNAVAILABLE' },
      { status: 502 },
    );
  }
}

export const dynamic = 'force-dynamic';

export function GET(request: Request, context: Context) {
  return encaminhar(request, context);
}

export function POST(request: Request, context: Context) {
  return encaminhar(request, context);
}

export function PUT(request: Request, context: Context) {
  return encaminhar(request, context);
}

export function PATCH(request: Request, context: Context) {
  return encaminhar(request, context);
}

export function DELETE(request: Request, context: Context) {
  return encaminhar(request, context);
}

export function OPTIONS(request: Request, context: Context) {
  return encaminhar(request, context);
}
