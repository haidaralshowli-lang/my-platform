-- AlterTable
ALTER TABLE "Objection" ADD COLUMN     "previousStage" "ViolationStage",
ADD COLUMN     "suspendedDeadline" BOOLEAN NOT NULL DEFAULT false;

-- التسديدات المالية لا تُعدَّل ولا تُحذف؛ التصحيح بقيد عكسي معتمد
CREATE TRIGGER payment_no_update BEFORE UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION cmc_prevent_mutation();
