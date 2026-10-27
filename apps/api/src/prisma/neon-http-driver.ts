import type {
  DatabaseConnection,
  Dialect,
  Driver,
  QueryResult,
} from 'kysely';
import type { CompiledQuery } from 'kysely';
import { PostgresQueryCompiler, PostgresAdapter, PostgresIntrospector } from 'kysely';

interface NeonHttpOptions {
  host: string;
  database: string;
  user: string;
  password: string;
}

/**
 * Driver Kysely para Neon via HTTP (fetch) — único suporte no Cloudflare Workers.
 * Transações interativas não existem em HTTP, então BEGIN/COMMIT/ROLLBACK são
 * emitidos como statements separados (todos no mesmo contexto de conexão Neon).
 */
export class NeonHttpDriver implements Driver {
  #connection: NeonHttpConnection | null = null;

  constructor(private options: NeonHttpOptions) {}

  async init(): Promise<void> {
    this.#connection = new NeonHttpConnection(this.options);
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    if (!this.#connection) await this.init();
    return this.#connection!;
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery({ sql: 'BEGIN', parameters: [] } as unknown as CompiledQuery);
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery({ sql: 'COMMIT', parameters: [] } as unknown as CompiledQuery);
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery({ sql: 'ROLLBACK', parameters: [] } as unknown as CompiledQuery);
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {
    this.#connection = null;
  }
}

class NeonHttpConnection implements DatabaseConnection {
  #url: string;
  #connectionString: string;

  constructor(private options: NeonHttpOptions) {
    this.#url = `https://${options.host}/sql`;
    this.#connectionString = `postgresql://${options.user}:${options.password}@${options.host}/${options.database}?sslmode=require&channel_binding=require`;
  }

  async executeQuery(compiledQuery: CompiledQuery): Promise<QueryResult<any>> {
    const { sql, parameters } = compiledQuery;
    const res = await fetch(this.#url, {
      method: 'POST',
      headers: {
        'Neon-Connection-String': this.#connectionString,
        'Neon-Raw-Text-Output': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql, params: parameters }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Neon HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    return { rows: data.rows ?? [] };
  }

  streamQuery(): AsyncIterableIterator<QueryResult<any>> {
    throw new Error('NeonHttpDriver does not support streaming');
  }
}

export class NeonHttpDialect implements Dialect {
  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver(): Driver {
    return new NeonHttpDriver(this.options);
  }

  createIntrospector(db: import('kysely').Kysely<any>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }

  constructor(private options: NeonHttpOptions) {}
}