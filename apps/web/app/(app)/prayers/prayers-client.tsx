"use client";

import { useMemo, useState, useTransition } from "react";
import { normalizeSacredText } from "@parvaordo/shared";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { addPrayerAction, deletePrayerAction, editPrayerSubmissionAction, overridePrayerAction } from "./actions";

export interface PrayerItem {
  id: string;
  title: string;
  prayerText: string;
  latinText: string | null;
  category: string | null;
  context: string | null;
  attribution: string | null;
  isLocal: boolean;
  overrideNote: string | null;
}

interface FormState {
  title: string;
  prayerText: string;
  latinText: string;
  category: string;
  context: string;
  attribution: string;
}
const empty = (): FormState => ({ title: "", prayerText: "", latinText: "", category: "", context: "", attribution: "" });
const fromItem = (p: PrayerItem): FormState => ({
  title: p.title, prayerText: p.prayerText, latinText: p.latinText ?? "", category: p.category ?? "", context: p.context ?? "", attribution: p.attribution ?? "",
});

export function PrayersClient({ prayers, canEdit }: { prayers: PrayerItem[]; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<PrayerItem | null>(null);
  const [editing, setEditing] = useState<PrayerItem | "new" | null>(null);
  const [, startTransition] = useTransition();

  const categories = useMemo(() => ["all", ...[...new Set(prayers.map((p) => p.category).filter(Boolean) as string[])].sort()], [prayers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return prayers.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (!q) return true;
      return p.title.toLowerCase().includes(q) || p.prayerText.toLowerCase().includes(q);
    });
  }, [prayers, query, category]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search prayers…"
          data-testid="prayer-search"
          className="flex-1 rounded-md border border-navy/15 bg-white px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none"
        />
        {canEdit ? (
          <button type="button" onClick={() => setEditing("new")} data-testid="prayer-add" className="inline-flex items-center gap-1 rounded-md bg-burgundy px-3 py-2 text-sm font-medium text-cream hover:bg-rose">
            <Plus className="h-4 w-4" /> Add prayer
          </button>
        ) : null}
      </div>

      {categories.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${category === c ? "bg-navy text-cream" : "bg-navy/10 text-navy hover:bg-navy/20"}`}>
              {c}
            </button>
          ))}
        </div>
      ) : null}

      {prayers.length === 0 ? (
        <p className="text-sm text-gray-500">No prayers yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500">No prayers match your search.</p>
      ) : (
        <ul className="space-y-1" data-testid="prayer-list">
          {filtered.map((p) => (
            <li key={p.id} className="group flex items-start gap-2">
              <button type="button" onClick={() => setSelected(p)} data-testid={`prayer-row-${p.title}`} className="flex-1 rounded-md border border-gray-200 bg-white p-3 text-left transition hover:border-gold hover:bg-parchment">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-navy">{normalizeSacredText(p.title)}</span>
                  {p.isLocal ? <span className="rounded bg-gold/20 px-1.5 text-xs font-medium text-gold-dark">Parish</span> : null}
                  {p.category ? <span className="rounded bg-navy/10 px-1.5 text-xs text-navy capitalize">{p.category}</span> : null}
                  {p.latinText ? <span className="rounded bg-blue-50 px-1.5 text-xs text-blue-700">Latin</span> : null}
                </span>
                <span className="mt-0.5 block truncate text-sm text-gray-500">{normalizeSacredText(p.prayerText).slice(0, 100)}</span>
              </button>
              {canEdit ? (
                <span className="flex flex-col gap-1 pt-1 opacity-0 group-hover:opacity-100">
                  <button type="button" onClick={() => setEditing(p)} className="text-gray-400 hover:text-navy" title="Edit" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                  {p.isLocal ? (
                    <button type="button" onClick={() => startTransition(() => deletePrayerAction(p.id))} className="text-gray-400 hover:text-rose" title="Delete" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)} data-testid="prayer-modal">
          <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-start justify-between">
              <h3 className="font-heading text-xl text-navy">{normalizeSacredText(selected.title)}</h3>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close" className="text-gray-400 hover:text-navy"><X className="h-5 w-5" /></button>
            </div>
            <p className="whitespace-pre-line text-sm text-navy/90">{normalizeSacredText(selected.prayerText)}</p>
            {selected.overrideNote ? <p className="mt-1 text-xs italic text-gray-400">(parish note) {selected.overrideNote}</p> : null}
            {selected.latinText ? <p className="mt-3 whitespace-pre-line text-sm italic text-gray-600">{selected.latinText}</p> : null}
            {selected.context ? <p className="mt-3 text-xs text-gray-500"><span className="font-semibold uppercase tracking-wide">When to pray</span><br />{normalizeSacredText(selected.context)}</p> : null}
            {selected.attribution ? <p className="mt-2 text-xs text-gray-400">— {selected.attribution}</p> : null}
          </div>
        </div>
      ) : null}

      {editing ? <EditModal prayer={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function EditModal({ prayer, onClose }: { prayer: PrayerItem | "new"; onClose: () => void }) {
  const isNew = prayer === "new";
  const isUniversal = !isNew && !prayer.isLocal;
  const [f, setF] = useState<FormState>(isNew ? empty() : fromItem(prayer));
  const [pending, startTransition] = useTransition();
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const cls = "w-full rounded-md border border-navy/15 px-2 py-1.5 text-sm text-navy focus:border-gold focus:outline-none";

  function save() {
    if (!f.title.trim() || !f.prayerText.trim()) return;
    startTransition(async () => {
      if (isNew) await addPrayerAction({ title: f.title, prayerText: f.prayerText, latinText: f.latinText, category: f.category, context: f.context, attribution: f.attribution });
      else if (isUniversal) await overridePrayerAction((prayer as PrayerItem).id, { text: f.prayerText, context: f.context });
      else await editPrayerSubmissionAction((prayer as PrayerItem).id, { title: f.title, prayerText: f.prayerText, latinText: f.latinText, category: f.category, context: f.context, attribution: f.attribution });
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg space-y-2 overflow-auto rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()} data-testid="prayer-edit">
        <h3 className="font-heading text-lg text-navy">{isNew ? "Add prayer" : "Edit prayer"}</h3>
        {isUniversal ? <p className="text-xs text-gray-400">Editing a universal prayer creates a parish override.</p> : null}
        <input className={cls} placeholder="Title" value={f.title} onChange={set("title")} disabled={isUniversal} data-testid="prayer-form-title" />
        <textarea className={cls} placeholder="Prayer text" rows={4} value={f.prayerText} onChange={set("prayerText")} data-testid="prayer-form-text" />
        {!isUniversal ? <textarea className={cls} placeholder="Latin text (optional)" rows={2} value={f.latinText} onChange={set("latinText")} /> : null}
        <textarea className={cls} placeholder="When to pray it (context)" rows={2} value={f.context} onChange={set("context")} />
        {!isUniversal ? (
          <div className="grid grid-cols-2 gap-2">
            <input className={cls} placeholder="Category" value={f.category} onChange={set("category")} />
            <input className={cls} placeholder="Attribution" value={f.attribution} onChange={set("attribution")} />
          </div>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600">Cancel</button>
          <button type="button" onClick={save} disabled={pending} data-testid="prayer-form-save" className="rounded-md bg-burgundy px-3 py-1.5 text-sm font-medium text-cream hover:bg-rose disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
