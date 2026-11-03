"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "./ui";

export function PrintButton({ label = "طباعة / حفظ PDF" }: { label?: string }) {
  return (
    <button type="button" className={buttonClass("secondary")} onClick={() => window.print()}>
      <Printer className="h-4 w-4" aria-hidden /> {label}
    </button>
  );
}
