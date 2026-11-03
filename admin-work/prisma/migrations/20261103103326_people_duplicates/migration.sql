-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "mergedIntoId" UUID;

-- CreateTable
CREATE TABLE "PersonDistinctPair" (
    "aId" UUID NOT NULL,
    "bId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "PersonDistinctPair_pkey" PRIMARY KEY ("aId","bId")
);

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- البحث التقريبي عن الأسماء المتشابهة (pg_trgm إضافة موثوقة يستطيع مالك قاعدة البيانات تفعيلها، ومتاحة في Supabase)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Person_normalizedName_trgm_idx" ON "Person" USING gin ("normalizedName" gin_trgm_ops);
