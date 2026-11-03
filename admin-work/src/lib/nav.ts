import { can, type Actor, type Permission } from "@/lib/rbac";

/// المرحلة المنفذة حالياً. لا يظهر أي قسم في القائمة قبل تنفيذه فعلياً (لا واجهات تجريبية).
export const IMPLEMENTED_PHASE = 4;

type NavItem = { href: string; label: string; icon: string; perm?: Permission; phase: number };

const NAV: NavItem[] = [
  { href: "/home", label: "الرئيسية", icon: "House", phase: 1 },
  { href: "/dashboard", label: "لوحة المتابعة", icon: "LayoutDashboard", perm: "dashboard.view", phase: 2 },
  { href: "/people", label: "قاعدة بيانات الأشخاص", icon: "Users", perm: "people.view", phase: 2 },
  { href: "/requests", label: "الطلبات", icon: "Inbox", perm: "requests.view", phase: 3 },
  { href: "/tasks", label: "المهام", icon: "ListChecks", perm: "tasks.view", phase: 3 },
  { href: "/notifications", label: "التنبيهات", icon: "Bell", phase: 4 },
  { href: "/reports", label: "التقارير", icon: "FileBarChart", perm: "reports.view", phase: 4 },
  { href: "/users", label: "المستخدمون والصلاحيات", icon: "UserCog", perm: "users.manage", phase: 1 },
  { href: "/settings", label: "القوائم والإعدادات", icon: "Settings", perm: "lists.manage", phase: 1 },
  { href: "/audit", label: "سجل التدقيق", icon: "ScrollText", perm: "audit.view", phase: 1 },
];

export function navFor(actor: Actor) {
  return NAV.filter((i) => i.phase <= IMPLEMENTED_PHASE && (!i.perm || can(actor, i.perm))).map(({ href, label, icon }) => ({ href, label, icon }));
}
