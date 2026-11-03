"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { X } from "lucide-react";
import { searchPeopleAction, type PersonOption } from "@/app/(app)/shared/actions";

/// اختيار شخص من قاعدة البيانات بالبحث بالاسم أو الرقم التسلسلي. يرسل معرّفه في حقل مخفي.
export function PersonPicker({
  name,
  id,
  initial,
  onPick,
  placeholder = "ابحث بالاسم أو الرقم التسلسلي",
  required,
}: {
  name: string;
  id: string;
  initial?: { id: string; serial: number; fullName: string } | null;
  onPick?: (p: PersonOption | null) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [selected, setSelected] = useState<{ id: string; serial: number; fullName: string } | null>(initial ?? null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PersonOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const search = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!v.trim()) return setResults([]);
      start(async () => {
        setResults(await searchPeopleAction(v));
        setActive(0);
        setOpen(true);
      });
    }, 300);
  };

  const pick = (p: PersonOption) => {
    setSelected(p);
    setOpen(false);
    setQ("");
    setResults([]);
    onPick?.(p);
  };

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-brand-soft px-3 py-2 text-sm">
        <input type="hidden" name={name} value={selected.id} />
        <span>
          <span className="ltr-num text-muted">#{selected.serial}</span> {selected.fullName}
        </span>
        <button
          type="button"
          className="rounded p-1 text-muted hover:bg-white hover:text-tone-danger"
          aria-label="إلغاء الاختيار"
          onClick={() => {
            setSelected(null);
            onPick?.(null);
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value="" />
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-required={required}
        autoComplete="off"
        value={q}
        placeholder={placeholder}
        className="field-input"
        onChange={(e) => search(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !results.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-white py-1 shadow-lg">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">{pending ? "جارٍ البحث…" : "لا توجد نتائج"}</li>}
          {results.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-brand-soft" : "hover:bg-band"}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
            >
              <span className="ltr-num text-muted">#{p.serial}</span> {p.fullName}
              <span className="text-xs text-muted">
                {" "}
                — {p.regionName ?? "دون منطقة"}
                {p.availableForWork && <span className="text-tone-success"> · متاح للتعاون</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
