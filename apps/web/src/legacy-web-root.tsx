'use client';

import { swrFetcher } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { StrictMode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { App } from './App';

export default function LegacyWebRoot() {
  return (
    <StrictMode>
      <BrowserRouter>
        <SWRConfig value={{ fetcher: swrFetcher, revalidateOnFocus: false }}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </SWRConfig>
      </BrowserRouter>
    </StrictMode>
  );
}
