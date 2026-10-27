import { swrFetcher } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root não encontrado');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <SWRConfig value={{ fetcher: swrFetcher, revalidateOnFocus: false }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </SWRConfig>
    </BrowserRouter>
  </StrictMode>,
);
