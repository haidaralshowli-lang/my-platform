-- CreateTable
CREATE TABLE "StoredBlob" (
    "key" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredBlob_pkey" PRIMARY KEY ("key")
);

-- محتوى الملفات لا يُستبدل ولا يُحذف
CREATE TRIGGER stored_blob_no_update BEFORE UPDATE OR DELETE ON "StoredBlob"
  FOR EACH ROW EXECUTE FUNCTION cmc_prevent_mutation();
