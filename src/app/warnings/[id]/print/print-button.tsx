"use client";

import { buttonClass } from "@/components/ui";

export function PrintButton() {
  return (
    <button type="button" className={buttonClass("primary")} onClick={() => window.print()}>
      طباعة أو حفظ PDF
    </button>
  );
}
