// Gera DDL a partir do contract.prisma (Prisma 8 contract).
// Inclui PKs, UNIQUE, DEFAULTs, FKs e indexes.
// Campos de relação (contêm '[' ou ']') são ignorados.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', 'src', 'prisma');
const src = readFileSync(join(root, 'contract.prisma'), 'utf8');

const lines = src.split('\n');

const enums = {};
const models = {};
let cur = null;
let curKind = null;

for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith('//')) continue;

  if (line.startsWith('enum ')) {
    curKind = 'enum';
    cur = line.slice(5).trim().replace(/\s*\{$/, '');
    enums[cur] = [];
    continue;
  }
  if (line.startsWith('model ')) {
    curKind = 'model';
    cur = line.slice(6).trim().replace(/\s*\{$/, '');
    models[cur] = { fields: [], indexes: [] };
    continue;
  }
  if (line === '}' || line.startsWith('}')) {
    curKind = null;
    continue;
  }
  if (line.startsWith('@@')) {
    if (cur && curKind === 'model') models[cur].indexes.push(line);
    continue;
  }
  if (curKind === 'enum' && cur) {
    const m = line.match(/^(\w+)/);
    if (m) enums[cur].push(m[1]);
    continue;
  }
  if (curKind === 'model' && cur) {
    if (line.includes('[') || line.includes(']')) continue;
    const m = line.match(/^(\w+)\s+(\w+)(\?)?\s*(.*)$/);
    if (m) {
      const [, name, type, optional, rest] = m;
      models[cur].fields.push({ name, type, optional: !!optional, rest });
    }
  }
}

const typeMap = {
  Uuid: 'uuid',
  Int: 'integer',
  String: 'text',
  Decimal: 'numeric',
  Boolean: 'boolean',
  Json: 'jsonb',
  TimestamptzJsDate: 'timestamptz',
};

let out = '';

for (const [name, members] of Object.entries(enums)) {
  out += `CREATE TYPE "${name}" AS ENUM (${members.map(m => `'${m}'`).join(', ')});\n\n`;
}

// Track FKs to add after tables
const fks = [];

for (const [name, { fields, indexes }] of Object.entries(models)) {
  const cols = [];
  for (const f of fields) {
    let t = typeMap[f.type] || 'text';
    // Use enum type if field references an enum
    if (enums[f.type]) t = `"${f.type}"`;
    let line = `"${f.name}" ${t}`;
    if (f.optional) line += ' NULL';
    else line += ' NOT NULL';

    if (f.rest.includes('@default(now())')) {
      line += ' DEFAULT now()';
    } else if (f.rest.includes('@default(autoincrement())')) {
      line += ' GENERATED ALWAYS AS IDENTITY';
    } else if (f.rest.includes('@onCreate(uuid())') || f.rest.includes('@default(uuid())')) {
      line += ' DEFAULT gen_random_uuid()';
    } else {
      const dm = f.rest.match(/@default\((\w+)\)/);
      if (dm) {
        const val = dm[1];
        if (val === 'true' || val === 'false') line += ` DEFAULT ${val}`;
        else if (/^\d+$/.test(val)) line += ` DEFAULT ${val}`;
        else line += ` DEFAULT '${val}'`;
      }
    }

    if (f.rest.includes('@unique')) {
      line += ' UNIQUE';
    }
    if (f.rest.includes('@id')) {
      line += ' PRIMARY KEY';
    }
    cols.push(line);
  }
  out += `CREATE TABLE "${name}" (\n  ${cols.join(',\n  ')}\n);\n\n`;

  // Parse FKs from relation fields — we need to look at the model definition
  // for fields that reference other models via @relation
  // We'll extract FK info from the contract lines directly
}

// Extract FKs per-model from the raw contract lines
const modelBlocks = {};
let curM = null;
let inBlock = false;
for (const raw of lines) {
  const line = raw.trim();
  if (line.startsWith('model ')) {
    curM = line.slice(6).trim().replace(/\s*\{$/, '');
    modelBlocks[curM] = [];
    inBlock = true;
    continue;
  }
  if (inBlock && (line === '}' || line.startsWith('}'))) {
    inBlock = false;
    curM = null;
    continue;
  }
  if (inBlock && curM && line.includes('@relation')) {
    modelBlocks[curM].push(line);
  }
}

const fkRegex = /(\w+)\s+(\w+)\s+@relation\(fields:\s*\[(\w+)\],\s*references:\s*\[(\w+)\]/;
for (const [model, relLines] of Object.entries(modelBlocks)) {
  for (const rl of relLines) {
    const m = fkRegex.exec(rl);
    if (m) {
      fks.push({ model, localField: m[3], refModel: m[2], refField: m[4] });
    }
  }
}

for (const fk of fks) {
  out += `ALTER TABLE "${fk.model}" ADD CONSTRAINT "${fk.model}_${fk.localField}_fk" FOREIGN KEY ("${fk.localField}") REFERENCES "${fk.refModel}" ("${fk.refField}");\n`;
}

// indexes
for (const [name, { indexes }] of Object.entries(models)) {
  for (const idx of indexes) {
    const m = idx.match(/@@index\(\[(.+)\]\)/);
    if (m) {
      const cols2 = m[1].split(',').map(c => `"${c.trim()}"`);
      const idxName = `${name}_${m[1].replace(/,/g, '_').replace(/\s/g, '')}_idx`.slice(0, 60);
      out += `CREATE INDEX "${idxName}" ON "${name}" (${cols2.join(', ')});\n`;
    }
  }
}

const outPath = join(__dirname, '..', 'prisma', 'schema.sql');
writeFileSync(outPath, out);
console.log(out);