// زرع البيانات الأساسية فقط: المحافظات العراقية والإعدادات الافتراضية.
// لا يُنشئ أي حساب أو بيانات أشخاص أو طلبات. آمن للتكرار ولا يعيد كتابة تعديلات الإدارة.
import { PrismaClient } from "@prisma/client";
import { SETTING_DEFAULTS } from "../src/lib/settings";

const GOVERNORATES = [
  "بغداد", "البصرة", "نينوى", "أربيل", "النجف", "كربلاء", "ذي قار", "بابل", "الأنبار", "ديالى",
  "كركوك", "صلاح الدين", "واسط", "ميسان", "المثنى", "القادسية", "دهوك", "السليمانية", "حلبجة",
];

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const [i, name] of GOVERNORATES.entries()) {
      await prisma.region.upsert({ where: { name }, create: { name, sortOrder: i + 1 }, update: {} });
    }
    for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
      await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} });
    }
    console.log(`تمت التهيئة: ${GOVERNORATES.length} محافظة، ${Object.keys(SETTING_DEFAULTS).length} إعدادات`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
