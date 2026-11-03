import { LinkButton } from "@/components/ui";

export const metadata = { title: "غير مصرح" };

export default function Forbidden() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="max-w-md rounded-lg border border-line bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-brand">غير مصرح</h1>
        <p className="mt-3 text-sm text-muted">لا تملك صلاحية الاطلاع على هذه الصفحة. راجع مدير النظام إذا كنت بحاجة إليها.</p>
        <LinkButton href="/home" className="mt-6">العودة إلى الصفحة الرئيسية</LinkButton>
      </div>
    </main>
  );
}
