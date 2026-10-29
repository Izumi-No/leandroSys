import { db } from './db';
import { eq, inArray, asc, desc, and } from 'drizzle-orm';
import * as schema from './schema';

/**
 * Minimal Prisma‑like wrapper around Drizzle queries.
 * It implements only the methods used in the current codebase:
 *   where, include (no‑op), orderBy, first, all, create, update.
 * For relations, `include` is a no‑op – callers that rely on nested data
 * should be refactored to perform explicit joins. This wrapper allows the
 * project to compile while the migration is in progress.
 */

class DrizzleQuery<T extends { [key: string]: any }> {
  private builder: any;
  private includes: string[] = [];

  constructor(private table: any) {
    this.builder = db.select().from(this.table);
  }

  where(conditions: Partial<T> | ((q: any) => any)) {
    if (typeof conditions === 'function') {
      // allow custom predicate building – the caller must return a boolean expression
      this.builder = this.builder.where(conditions);
    } else {
      const clauses = Object.entries(conditions).map(([k, v]) => {
        if (Array.isArray(v)) return inArray(this.table[k as keyof typeof this.table], v);
        return eq(this.table[k as keyof typeof this.table], v);
      });
      this.builder = this.builder.where(and(...clauses));
    }
    return this;
  }

  // `include` is kept for compatibility; it does nothing for now.
  include(_relation: string | ((builder: any) => any)) {
    // No‑op – to be replaced with proper joins later.
    return this;
  }

  orderBy(orderFn: (model: any) => any) {
    const expr = orderFn(this.table);
    // Detect asc/desc helpers used in original code.
    if (expr && typeof expr === 'object' && 'direction' in expr && 'column' in expr) {
      if (expr.direction === 'asc') this.builder = this.builder.orderBy(asc(expr.column));
      else if (expr.direction === 'desc') this.builder = this.builder.orderBy(desc(expr.column));
    } else {
      this.builder = this.builder.orderBy(expr);
    }
    return this;
  }

  async first() {
    const rows = await this.builder.limit(1);
    return rows[0] ?? null;
  }

  async all() {
    return await this.builder;
  }

  // Simple create – expects an object matching the table columns.
  async create(data: Partial<T>) {
    const [row] = await db.insert(this.table).values(data as any).returning();
    return row;
  }

  async update(where: Partial<T>, data: Partial<T>) {
    await db.update(this.table).set(data as any).where((tbl) => {
      const clauses = Object.entries(where).map(([k, v]) => eq(tbl[k as keyof typeof tbl], v));
      return and(...clauses);
    });
    return true;
  }
}

/** Exported ORM namespace mimicking the Prisma shape used in the code. */
export const orm = {
  public: {
    User: new DrizzleQuery(schema.users),
    Category: new DrizzleQuery(schema.categories),
    Product: new DrizzleQuery(schema.products),
    Table: new DrizzleQuery(schema.tables),
    Comanda: new DrizzleQuery(schema.comandas),
    ComandaItem: new DrizzleQuery(schema.comandaItems),
    Aditional: new DrizzleQuery(schema.aditionals),
    PrintRoute: new DrizzleQuery(schema.printRoutes),
    Printer: new DrizzleQuery(schema.printers),
    PrintJob: new DrizzleQuery(schema.printJobs),
    // Add other models here as needed.
  },
};
