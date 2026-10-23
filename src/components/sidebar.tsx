"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { Brand, cn } from "./ui";

type Item = { href: string; label: string; icon: string };

function Icon({ name }: { name: string }) {
  const C = (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.Circle;
  return <C className="h-4 w-4 shrink-0" aria-hidden />;
}

export function Sidebar({ items }: { items: Item[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const active = (href: string) =>
    pathname === href || (pathname.startsWith(`${href}/`) && !items.some((i) => i.href !== href && i.href.startsWith(href) && pathname.startsWith(i.href)));

  return (
    <>
      <button
        type="button"
        className="no-print fixed top-3 start-3 z-40 rounded-md bg-brand p-2 text-white shadow lg:hidden"
        aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
        aria-expanded={open}
        aria-controls="main-nav"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <Icons.X className="h-5 w-5" /> : <Icons.Menu className="h-5 w-5" />}
      </button>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        id="main-nav"
        className={cn(
          "no-print fixed inset-y-0 start-0 z-40 flex w-72 flex-col bg-brand text-white transition-transform lg:sticky lg:top-0 lg:h-dvh",
          open ? "translate-x-0" : "translate-x-full lg:translate-x-0",
        )}
      >
        <div className="border-b-4 border-accent px-4 py-4">
          <Brand />
        </div>
        <nav aria-label="القائمة الرئيسية" className="flex-1 overflow-y-auto px-2 py-3">
          <ul className="flex flex-col gap-0.5">
            {items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={active(i.href) ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
                    active(i.href) ? "bg-white/15 font-semibold" : "text-white/85 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <Icon name={i.icon} />
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}
