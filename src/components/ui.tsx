import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Tone } from "@/lib/workflow/labels";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const BUTTON_VARIANTS = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "border border-line bg-white text-ink hover:bg-band",
  danger: "bg-tone-danger text-white hover:opacity-90",
  ghost: "text-brand hover:bg-brand-soft",
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
    size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
    BUTTON_VARIANTS[variant],
  );
}

export function LinkButton({ variant = "primary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <Link className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-line bg-surface shadow-xs", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="text-base font-semibold text-brand">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-brand sm:text-2xl">{title}</h1>
        <div className="mt-2 h-1 w-16 rounded bg-accent" aria-hidden />
        {description && <p className="mt-3 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONES: Record<Tone, string> = {
  neutral: "bg-tone-neutral-bg text-tone-neutral",
  info: "bg-tone-info-bg text-tone-info",
  warning: "bg-tone-warning-bg text-tone-warning",
  danger: "bg-tone-danger-bg text-tone-danger",
  success: "bg-tone-success-bg text-tone-success",
  legal: "bg-tone-legal-bg text-tone-legal",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone])}>{children}</span>;
}

export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-md border px-4 py-3 text-sm", TONES[tone], "border-current/20")}>
      {children}
    </div>
  );
}

export function Field({ label, htmlFor, required, error, hint, children, className }: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string | string[];
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const err = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
        {required && <span className="ms-1 text-tone-danger" aria-hidden>*</span>}
      </label>
      {children}
      {hint && !err && <p className="text-xs text-muted">{hint}</p>}
      {err && <p id={`${htmlFor}-error`} className="text-xs text-tone-danger">{err}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

/// جدول متجاوب: على الشاشات الصغيرة يتمرر أفقياً داخل حاويته دون تمرير الصفحة كلها
export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="min-w-full divide-y divide-line text-sm [&_td]:px-3 [&_td]:py-2.5 [&_th]:bg-brand [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-start [&_th]:font-medium [&_th]:whitespace-nowrap [&_th]:text-white [&_tbody_tr:nth-child(even)]:bg-band/60">
        {children}
      </table>
    </div>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  const logo = process.env.NEXT_PUBLIC_LOGO_PATH;
  return (
    <div className="flex items-center gap-3">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="شعار هيئة الإعلام والاتصالات" className="h-10 w-10 object-contain" />
      ) : (
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-accent bg-white text-xs font-bold text-brand">
          هـ.إ.ا
        </span>
      )}
      {!compact && (
        <div className="leading-tight">
          <div className="text-sm font-bold">منصة إدارة المخالفات</div>
          <div className="text-xs opacity-80">هيئة الإعلام والاتصالات العراقية</div>
        </div>
      )}
    </div>
  );
}
