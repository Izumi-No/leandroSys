'use client';

import dynamic from 'next/dynamic';

const AplicacaoLegada = dynamic(() => import('../legacy-web-root'), {
  ssr: false,
  loading: () => (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      Carregando o sistema…
    </p>
  ),
});

export function WebRuntime() {
  return <AplicacaoLegada />;
}
