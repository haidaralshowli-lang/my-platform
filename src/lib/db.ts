import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    // المعاملات التفاعلية تتضمن عدة استعلامات؛ مع بُعد الخادم عن قاعدة البيانات (مثلاً دوال Netlify وSupabase في منطقتين)
    // لا تكفي المهلة الافتراضية (5 ثوانٍ). الأقفال قصيرة لأن كل معاملة تقفل صف المخالفة المعنية فقط.
    transactionOptions: { maxWait: 10_000, timeout: 30_000 },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
