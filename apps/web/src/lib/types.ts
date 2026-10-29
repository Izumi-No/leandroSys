/** Tipos da API que não estão em `@leandrosys/shared` (espelhados do README da API). */

import type { AuthUser, Role } from '@leandrosys/shared';

export type CategoriaDTO = {
  id: string;
  name: string;
  active: boolean;
  products: { id: string; name: string; price: string; active: boolean; categoryId: string }[];
};

export type ProdutoDTO = {
  id: string;
  name: string;
  price: string;
  active: boolean;
  category: { id: string; name: string };
};

export type AdicionalDTO = { id: string; name: string; price: string; active: boolean; categoryId?: string | null; productId?: string | null };

export type UsuarioDTO = AuthUser & { createdAt: string };

export type RotaImpressaoDTO = {
  id: string;
  priority: number;
  createdAt: string;
  printer: { id: string; name: string };
  target: { scope: 'PRODUCT' | 'CATEGORY'; id: string; name: string };
  productId: string | null;
  categoryId: string | null;
};

export type FilaResposta = { jobs: unknown[] };

/** `POST /tables/:id/take` etc. */
export type TransferenciaDTO = { transfer: { from: string; to: string } };
export type LiberacaoDTO = { released: boolean; comandaId: string; warnings: string[] };
export type EnvioDTO = {
  jobIds: string[];
  sent: number;
  unrouted: { itemId: string; product: string }[];
};
export type ContaDTO = { billJobId: string | null; warnings: string[] };

/** Corpo para criar/editar entidades do admin. */
export type Papel = Role;
