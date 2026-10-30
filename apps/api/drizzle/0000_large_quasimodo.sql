CREATE TYPE "public"."ComandaStatus" AS ENUM('OPEN', 'PAYING', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."ItemStatus" AS ENUM('PENDING', 'SENT', 'IN_PREP', 'READY', 'SERVED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."PaymentMethod" AS ENUM('MONEY', 'CARD', 'PIX', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."PrintJobKind" AS ENUM('ITEM', 'COMANDA', 'BILL', 'TEST');--> statement-breakpoint
CREATE TYPE "public"."PrintJobStatus" AS ENUM('PENDING', 'PRINTING', 'DONE', 'FAILED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."PrinterTransport" AS ENUM('BLUETOOTH', 'USB', 'NETWORK');--> statement-breakpoint
CREATE TYPE "public"."Role" AS ENUM('ADMIN', 'WAITER', 'CASHIER', 'CHEF');--> statement-breakpoint
CREATE TYPE "public"."TableStatus" AS ENUM('AVAILABLE', 'OCCUPIED', 'RESERVED');--> statement-breakpoint
CREATE TABLE "Aditional" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price" numeric NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "Aditional_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "Category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "Category_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "ComandaItemAditional" (
	"comandaItemId" uuid NOT NULL,
	"aditionalId" uuid NOT NULL,
	CONSTRAINT "ComandaItemAditional_comandaItemId_aditionalId_pk" PRIMARY KEY("comandaItemId","aditionalId")
);
--> statement-breakpoint
CREATE TABLE "ComandaItem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comandaId" uuid NOT NULL,
	"productId" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unitPrice" numeric NOT NULL,
	"note" text,
	"status" "ItemStatus" DEFAULT 'PENDING' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Comanda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "Comanda_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tableId" uuid NOT NULL,
	"status" "ComandaStatus" DEFAULT 'OPEN' NOT NULL,
	"waiterId" uuid,
	"total" numeric DEFAULT '0' NOT NULL,
	"paymentMethod" "PaymentMethod",
	"openedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"closedAt" timestamp with time zone,
	CONSTRAINT "Comanda_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "Table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"capacity" integer DEFAULT 4 NOT NULL,
	"label" text,
	"status" "TableStatus" DEFAULT 'AVAILABLE' NOT NULL,
	CONSTRAINT "Table_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "PrintJob" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"printerId" uuid NOT NULL,
	"comandaId" uuid,
	"comandaItemId" uuid,
	"kind" "PrintJobKind" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "PrintJobStatus" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"claimedAt" timestamp with time zone,
	"finishedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "PrintRoute" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"printerId" uuid NOT NULL,
	"productId" uuid,
	"categoryId" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Printer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"transport" "PrinterTransport" DEFAULT 'BLUETOOTH' NOT NULL,
	"columns" integer DEFAULT 32 NOT NULL,
	"codepage" integer DEFAULT 19 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"printsBill" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"agentId" text,
	"agentName" text,
	"baud" integer,
	"boundAt" timestamp with time zone,
	CONSTRAINT "Printer_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "Product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price" numeric NOT NULL,
	"categoryId" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" "Role" NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "User_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "ComandaItemAditional" ADD CONSTRAINT "ComandaItemAditional_comandaItemId_ComandaItem_id_fk" FOREIGN KEY ("comandaItemId") REFERENCES "public"."ComandaItem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ComandaItemAditional" ADD CONSTRAINT "ComandaItemAditional_aditionalId_Aditional_id_fk" FOREIGN KEY ("aditionalId") REFERENCES "public"."Aditional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ComandaItem" ADD CONSTRAINT "ComandaItem_comandaId_Comanda_id_fk" FOREIGN KEY ("comandaId") REFERENCES "public"."Comanda"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ComandaItem" ADD CONSTRAINT "ComandaItem_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Comanda" ADD CONSTRAINT "Comanda_tableId_Table_id_fk" FOREIGN KEY ("tableId") REFERENCES "public"."Table"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Comanda" ADD CONSTRAINT "Comanda_waiterId_User_id_fk" FOREIGN KEY ("waiterId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_printerId_Printer_id_fk" FOREIGN KEY ("printerId") REFERENCES "public"."Printer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_comandaId_Comanda_id_fk" FOREIGN KEY ("comandaId") REFERENCES "public"."Comanda"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_comandaItemId_ComandaItem_id_fk" FOREIGN KEY ("comandaItemId") REFERENCES "public"."ComandaItem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PrintRoute" ADD CONSTRAINT "PrintRoute_printerId_Printer_id_fk" FOREIGN KEY ("printerId") REFERENCES "public"."Printer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PrintRoute" ADD CONSTRAINT "PrintRoute_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PrintRoute" ADD CONSTRAINT "PrintRoute_categoryId_Category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_Category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ComandaItemAditional_aditionalId_idx" ON "ComandaItemAditional" USING btree ("aditionalId");--> statement-breakpoint
CREATE INDEX "PrintJob_printerId_status_idx" ON "PrintJob" USING btree ("printerId","status");--> statement-breakpoint
CREATE INDEX "PrintJob_comandaId_idx" ON "PrintJob" USING btree ("comandaId");--> statement-breakpoint
CREATE INDEX "PrintRoute_productId_idx" ON "PrintRoute" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "PrintRoute_categoryId_idx" ON "PrintRoute" USING btree ("categoryId");--> statement-breakpoint
CREATE INDEX "PrintRoute_printerId_idx" ON "PrintRoute" USING btree ("printerId");--> statement-breakpoint
CREATE INDEX "Printer_agentId_idx" ON "Printer" USING btree ("agentId");