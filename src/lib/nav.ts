import type { PermissionCode } from "@/lib/rbac/catalog";
import type { Actor } from "@/lib/rbac/actor";

export type NavItem = {
  href: string;
  label: string;
  /// يظهر العنصر إذا امتلك المستخدم أياً من هذه الصلاحيات
  anyOf: PermissionCode[];
  icon: string;
  /// الجزء الذي يُنفَّذ فيه القسم؛ الأقسام غير المنفذة بعد لا تظهر (لا صفحات شكلية)
  part: number;
};

/// رقم آخر جزء مكتمل من خطة التنفيذ
export const IMPLEMENTED_PART = 8;

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "لوحة المعلومات", anyOf: ["dashboard.view"], icon: "LayoutDashboard", part: 1 },
  { href: "/violations/new", label: "تسجيل مخالفة جديدة", anyOf: ["violation.create"], icon: "FilePlus2", part: 2 },
  { href: "/violations", label: "جميع المخالفات", anyOf: ["violation.view"], icon: "Files", part: 2 },
  { href: "/queues/approval", label: "المخالفات بانتظار المصادقة", anyOf: ["approval.final_registration"], icon: "Stamp", part: 3 },
  { href: "/queues/technical", label: "الموقف الفني", anyOf: ["technical.prepare", "technical.review"], icon: "Wrench", part: 3 },
  { href: "/queues/legal", label: "المصادقات القانونية", anyOf: ["legal.prepare", "legal.approve"], icon: "Scale", part: 3 },
  { href: "/warnings", label: "الإنذارات", anyOf: ["warning.approve_issue", "warning.prepare", "warning.upload_signed"], icon: "FileWarning", part: 3 },
  { href: "/deliveries", label: "التبليغات ووصولات الاستلام", anyOf: ["delivery.record"], icon: "Send", part: 4 },
  { href: "/deadlines", label: "المدد القانونية والتنبيهات", anyOf: ["deadline.view"], icon: "Timer", part: 4 },
  { href: "/responses", label: "الاستجابات", anyOf: ["response.record", "response.decide"], icon: "MessageSquareReply", part: 5 },
  { href: "/financial", label: "الملفات المالية والتسديدات", anyOf: ["financial.view", "financial.record"], icon: "Banknote", part: 5 },
  { href: "/responses/technical", label: "ملفات الاستجابة الفنية", anyOf: ["response.technical_verify"], icon: "ClipboardCheck", part: 5 },
  { href: "/objections", label: "الاعتراضات والطعون", anyOf: ["objection.record", "objection.decide"], icon: "Gavel", part: 5 },
  { href: "/criminal-cases", label: "الدعوى الجزائية", anyOf: ["criminal.view", "criminal.manage"], icon: "Landmark", part: 6 },
  { href: "/judgments", label: "ملفات الأحكام القضائية", anyOf: ["criminal.view", "judgment.record"], icon: "BookMarked", part: 6 },
  { href: "/archive", label: "الأرشيف والمخالفات المغلقة", anyOf: ["violation.view"], icon: "Archive", part: 6 },
  { href: "/legal-library", label: "اللوائح والقوانين والتعليمات", anyOf: ["legal_library.view"], icon: "Library", part: 3 },
  { href: "/templates", label: "قوالب الكتب والإنذارات", anyOf: ["template.manage"], icon: "FileText", part: 3 },
  { href: "/reports", label: "التقارير والإحصائيات", anyOf: ["reports.view"], icon: "BarChart3", part: 7 },
  { href: "/audit", label: "سجل التدقيق", anyOf: ["audit.view"], icon: "ShieldCheck", part: 7 },
  { href: "/admin/users", label: "إدارة المستخدمين والصلاحيات", anyOf: ["users.manage", "roles.manage"], icon: "Users", part: 1 },
  { href: "/admin/system", label: "إعدادات النظام", anyOf: ["settings.manage"], icon: "Settings", part: 7 },
  { href: "/admin/settings", label: "القوائم المرجعية", anyOf: ["reference.manage"], icon: "ListChecks", part: 2 },
];

export function visibleNav(actor: Actor): NavItem[] {
  return NAV_ITEMS.filter((i) => i.part <= IMPLEMENTED_PART && i.anyOf.some((p) => actor.permissions.has(p)));
}
