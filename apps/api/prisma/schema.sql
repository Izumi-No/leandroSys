CREATE TYPE "Role" AS ENUM ('ADMIN', 'WAITER', 'CASHIER', 'CHEF');

CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED');

CREATE TYPE "ComandaStatus" AS ENUM ('OPEN', 'PAYING', 'CLOSED');

CREATE TYPE "PaymentMethod" AS ENUM ('MONEY', 'CARD', 'PIX', 'OTHER');

CREATE TYPE "ItemStatus" AS ENUM ('PENDING', 'SENT', 'IN_PREP', 'READY', 'SERVED', 'CANCELED');

CREATE TYPE "PrinterTransport" AS ENUM ('BLUETOOTH', 'USB', 'NETWORK');

CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'PRINTING', 'DONE', 'FAILED', 'CANCELED');

CREATE TYPE "PrintJobKind" AS ENUM ('ITEM', 'COMANDA', 'BILL', 'TEST');

CREATE TABLE "User" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "username" text NOT NULL UNIQUE,
  "password" text NOT NULL,
  "role" "Role" NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Category" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "name" text NOT NULL UNIQUE,
  "active" boolean NOT NULL DEFAULT true
);

CREATE TABLE "Product" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "name" text NOT NULL,
  "price" numeric NOT NULL,
  "categoryId" uuid NOT NULL,
  "active" boolean NOT NULL DEFAULT true
);

CREATE TABLE "Aditional" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "name" text NOT NULL UNIQUE,
  "price" numeric NOT NULL,
  "active" boolean NOT NULL DEFAULT true
);

CREATE TABLE "Table" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "number" integer NOT NULL UNIQUE,
  "capacity" integer NOT NULL DEFAULT 4,
  "label" text NULL,
  "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE'
);

CREATE TABLE "Comanda" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "number" integer NOT NULL GENERATED ALWAYS AS IDENTITY UNIQUE,
  "tableId" uuid NOT NULL,
  "status" "ComandaStatus" NOT NULL DEFAULT 'OPEN',
  "waiterId" uuid NULL,
  "total" numeric NOT NULL DEFAULT 0,
  "paymentMethod" "PaymentMethod" NULL,
  "openedAt" timestamptz NOT NULL DEFAULT now(),
  "closedAt" timestamptz NULL
);

CREATE TABLE "ComandaItem" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "comandaId" uuid NOT NULL,
  "productId" uuid NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "unitPrice" numeric NOT NULL,
  "note" text NULL,
  "status" "ItemStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "ComandaItemAditional" (
  "comandaItemId" uuid NOT NULL,
  "aditionalId" uuid NOT NULL
);

CREATE TABLE "Printer" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "name" text NOT NULL UNIQUE,
  "address" text NOT NULL,
  "transport" "PrinterTransport" NOT NULL DEFAULT 'BLUETOOTH',
  "columns" integer NOT NULL DEFAULT 32,
  "codepage" integer NOT NULL DEFAULT 19,
  "active" boolean NOT NULL DEFAULT true,
  "printsBill" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "agentId" text NULL,
  "agentName" text NULL,
  "baud" integer NULL,
  "boundAt" timestamptz NULL
);

CREATE TABLE "PrintRoute" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "printerId" uuid NOT NULL,
  "productId" uuid NULL,
  "categoryId" uuid NULL,
  "priority" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "PrintJob" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "printerId" uuid NOT NULL,
  "comandaId" uuid NULL,
  "comandaItemId" uuid NULL,
  "kind" "PrintJobKind" NOT NULL,
  "payload" jsonb NOT NULL,
  "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 0,
  "lastError" text NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "claimedAt" timestamptz NULL,
  "finishedAt" timestamptz NULL
);

ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fk" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id");
ALTER TABLE "Comanda" ADD CONSTRAINT "Comanda_tableId_fk" FOREIGN KEY ("tableId") REFERENCES "Table" ("id");
ALTER TABLE "ComandaItem" ADD CONSTRAINT "ComandaItem_comandaId_fk" FOREIGN KEY ("comandaId") REFERENCES "Comanda" ("id");
ALTER TABLE "ComandaItem" ADD CONSTRAINT "ComandaItem_productId_fk" FOREIGN KEY ("productId") REFERENCES "Product" ("id");
ALTER TABLE "ComandaItemAditional" ADD CONSTRAINT "ComandaItemAditional_comandaItemId_fk" FOREIGN KEY ("comandaItemId") REFERENCES "ComandaItem" ("id");
ALTER TABLE "ComandaItemAditional" ADD CONSTRAINT "ComandaItemAditional_aditionalId_fk" FOREIGN KEY ("aditionalId") REFERENCES "Aditional" ("id");
ALTER TABLE "PrintRoute" ADD CONSTRAINT "PrintRoute_printerId_fk" FOREIGN KEY ("printerId") REFERENCES "Printer" ("id");
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_printerId_fk" FOREIGN KEY ("printerId") REFERENCES "Printer" ("id");
CREATE INDEX "ComandaItemAditional_aditionalId_idx" ON "ComandaItemAditional" ("aditionalId");
CREATE INDEX "Printer_agentId_idx" ON "Printer" ("agentId");
CREATE INDEX "PrintRoute_productId_idx" ON "PrintRoute" ("productId");
CREATE INDEX "PrintRoute_categoryId_idx" ON "PrintRoute" ("categoryId");
CREATE INDEX "PrintRoute_printerId_idx" ON "PrintRoute" ("printerId");
CREATE INDEX "PrintJob_printerId_status_idx" ON "PrintJob" ("printerId", "status");
CREATE INDEX "PrintJob_comandaId_idx" ON "PrintJob" ("comandaId");
