import { LinkButton } from "@/components/ui";

export default function Forbidden() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="max-w-md rounded-lg border border-line bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-brand">غير مصرح بالوصول</h1>
        <p className="mt-3 text-sm text-muted">لا تملك صلاحية الاطلاع على هذه الصفحة. إذا كنت تعتقد أن ذلك خطأ، راجع مدير النظام.</p>
        <LinkButton href="/dashboard" className="mt-6">العودة إلى لوحة المعلومات</LinkButton>
      </div>
    </main>
  );
}
