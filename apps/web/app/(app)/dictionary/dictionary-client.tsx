"use client";

import { useMemo, useState, useTransition } from "react";
import { normalizeSacredText } from "@parvaordo/shared";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { addEntryAction, deleteSubmissionAction, editSubmissionAction, overrideEntryAction } from "./actions";

// Shape mirrors core DictionaryItem (kept local to avoid importing core into the client bundle).
export interface DictItem {
  id: string;
  headword: string;
  variants: string[] | null;
  pronunciation: string | null;
  definition: string;
  greekWord: string | null;
  greekDefinition: string | null;
  hebrewWord: string | null;
  hebrewDefinition: string | null;
  firstCenturyContext: string | null;
  catechismReferences: string[] | null;
  scriptureReferences: string[] | null;
  category: string | null;
  isLocal: boolean;
  overrideNote: string | null;
}

const CATEGORIES = ["all", "biblical", "sacramental", "liturgical", "doctrinal"] as const;
const cap = (s: string) => normalizeSacredText(s.charAt(0).toUpperCase() + s.slice(1));

interface FormState {
  headword: string;
  variants: string;
  definition: string;
  greekWord: string;
  greekDefinition: string;
  hebrewWord: string;
  hebrewDefinition: string;
  firstCenturyContext: string;
}

function emptyForm(): FormState {
  return {
    headword: "",
    variants: "",
    definition: "",
    greekWord: "",
    greekDefinition: "",
    hebrewWord: "",
    hebrewDefinition: "",
    firstCenturyContext: "",
  };
}
function formFrom(e: DictItem): FormState {
  return {
    headword: e.headword,
    variants: (e.variants ?? []).join(", "),
    definition: e.definition,
    greekWord: e.greekWord ?? "",
    greekDefinition: e.greekDefinition ?? "",
    hebrewWord: e.hebrewWord ?? "",
    hebrewDefinition: e.hebrewDefinition ?? "",
    firstCenturyContext: e.firstCenturyContext ?? "",
  };
}

export function DictionaryClient({ entries, canEdit }: { entries: DictItem[]; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");
  const [selected, setSelected] = useState<DictItem | null>(null);
  const [editing, setEditing] = useState<DictItem | "new" | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (category !== "all" && e.category !== category) return false;
      if (!q) return true;
      return (
        e.headword.toLowerCase().includes(q) ||
        e.definition.toLowerCase().includes(q) ||
        (e.variants ?? []).some((v) => v.toLowerCase().includes(q))
      );
    });
  }, [entries, query, category]);

  const groups = useMemo(() => {
    const m = new Map<string, DictItem[]>();
    for (const e of filtered) {
      const letter = (e.headword[0] ?? "#").toUpperCase();
      (m.get(letter) ?? m.set(letter, []).get(letter)!).push(e);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search terms…"
          data-testid="dict-search"
          className="flex-1 rounded-md border border-navy/15 bg-white px-3 py-2 text-sm text-navy focus:border-gold focus:outline-none"
        />
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing("new")}
            data-testid="dict-add"
            className="inline-flex items-center gap-1 rounded-md bg-burgundy px-3 py-2 text-sm font-medium text-cream hover:bg-rose"
          >
            <Plus className="h-4 w-4" /> Add entry
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${category === c ? "bg-navy text-cream" : "bg-navy/10 text-navy hover:bg-navy/20"}`}
          >
            {c}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-gray-400">{entries.length} terms</span>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-500">No dictionary entries yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500">No entries match your search.</p>
      ) : (
        <ul className="space-y-4" data-testid="dict-list">
          {groups.map(([letter, items]) => (
            <li key={letter}>
              <p className="sticky top-0 bg-parchment py-1 text-xs font-semibold text-gold">{letter}</p>
              <ul className="space-y-1">
                {items.map((e) => (
                  <li key={e.id} className="group flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => setSelected(e)}
                      data-testid={`dict-row-${e.headword}`}
                      className="flex-1 rounded-md border border-gray-200 bg-white p-3 text-left transition hover:border-gold hover:bg-parchment"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-navy">{cap(e.headword)}</span>
                        {e.pronunciation ? <span className="text-xs text-gray-400">/{e.pronunciation}/</span> : null}
                        {e.isLocal ? (
                          <span className="rounded bg-gold/20 px-1.5 text-xs font-medium text-gold-dark">Parish</span>
                        ) : null}
                        {e.category ? (
                          <span className="rounded bg-navy/10 px-1.5 text-xs text-navy capitalize">{e.category}</span>
                        ) : null}
                        {e.greekWord ? (
                          <span className="rounded bg-blue-50 px-1.5 text-xs text-blue-700">Greek</span>
                        ) : null}
                        {e.hebrewWord ? (
                          <span className="rounded bg-amber-50 px-1.5 text-xs text-amber-700">Hebrew</span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-gray-500">
                        {normalizeSacredText(e.definition).slice(0, 100)}
                      </span>
                    </button>
                    {canEdit ? (
                      <span className="flex flex-col gap-1 pt-1 opacity-0 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => setEditing(e)}
                          className="text-gray-400 hover:text-navy"
                          title="Edit"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {e.isLocal ? (
                          <button
                            type="button"
                            onClick={() => startTransition(() => deleteSubmissionAction(e.id))}
                            className="text-gray-400 hover:text-rose"
                            title="Delete"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {selected ? <DetailModal entry={selected} onClose={() => setSelected(null)} /> : null}
      {editing ? <EditModal entry={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function DetailModal({ entry, onClose }: { entry: DictItem; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      data-testid="dict-modal"
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-start justify-between">
          <h3 className="font-heading text-xl text-navy">{cap(entry.headword)}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-navy">
            <X className="h-5 w-5" />
          </button>
        </div>
        <Section title="Definition">{normalizeSacredText(entry.definition)}</Section>
        {entry.overrideNote ? <p className="text-xs italic text-gray-400">(parish note) {entry.overrideNote}</p> : null}
        {entry.greekWord || entry.greekDefinition ? (
          <Section title="Greek">{[entry.greekWord, entry.greekDefinition].filter(Boolean).join(" — ")}</Section>
        ) : null}
        {entry.hebrewWord || entry.hebrewDefinition ? (
          <Section title="Hebrew">{[entry.hebrewWord, entry.hebrewDefinition].filter(Boolean).join(" — ")}</Section>
        ) : null}
        {entry.firstCenturyContext ? (
          <Section title="First-century context">{normalizeSacredText(entry.firstCenturyContext)}</Section>
        ) : null}
        {entry.catechismReferences?.length ? (
          <Section title="Catechism">{entry.catechismReferences.join(", ")}</Section>
        ) : null}
        {entry.scriptureReferences?.length ? (
          <Section title="Scripture">{entry.scriptureReferences.join(", ")}</Section>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</p>
      <p className="text-sm text-navy/90">{children}</p>
    </div>
  );
}

function EditModal({ entry, onClose }: { entry: DictItem | "new"; onClose: () => void }) {
  const isNew = entry === "new";
  const isUniversal = !isNew && !entry.isLocal; // editing a universal entry → creates an override
  const [f, setF] = useState<FormState>(isNew ? emptyForm() : formFrom(entry));
  const [pending, startTransition] = useTransition();
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const input =
    "w-full rounded-md border border-navy/15 px-2 py-1.5 text-sm text-navy focus:border-gold focus:outline-none";

  function save() {
    if (!f.headword.trim() || !f.definition.trim()) return;
    const sub = {
      headword: f.headword,
      variants: f.variants
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      definition: f.definition,
      greekWord: f.greekWord,
      greekDefinition: f.greekDefinition,
      hebrewWord: f.hebrewWord,
      hebrewDefinition: f.hebrewDefinition,
      firstCenturyContext: f.firstCenturyContext,
    };
    startTransition(async () => {
      if (isNew) await addEntryAction(sub);
      else if (isUniversal)
        await overrideEntryAction((entry as DictItem).id, {
          definition: f.definition,
          greekDefinition: f.greekDefinition,
          hebrewDefinition: f.hebrewDefinition,
          firstCenturyContext: f.firstCenturyContext,
        });
      else await editSubmissionAction((entry as DictItem).id, sub);
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg space-y-2 overflow-auto rounded-lg bg-white p-5"
        onClick={(e) => e.stopPropagation()}
        data-testid="dict-edit"
      >
        <h3 className="font-heading text-lg text-navy">{isNew ? "Add entry" : "Edit entry"}</h3>
        {isUniversal ? (
          <p className="text-xs text-gray-400">Editing a universal entry creates a parish override.</p>
        ) : null}
        <input
          className={input}
          placeholder="Headword"
          value={f.headword}
          onChange={set("headword")}
          disabled={isUniversal}
          data-testid="dict-form-headword"
        />
        {!isUniversal ? (
          <input
            className={input}
            placeholder="Variants (comma-separated)"
            value={f.variants}
            onChange={set("variants")}
          />
        ) : null}
        <textarea
          className={input}
          placeholder="Definition"
          rows={3}
          value={f.definition}
          onChange={set("definition")}
          data-testid="dict-form-definition"
        />
        <div className="grid grid-cols-2 gap-2">
          {!isUniversal ? (
            <input className={input} placeholder="Greek word" value={f.greekWord} onChange={set("greekWord")} />
          ) : null}
          <input
            className={input}
            placeholder="Greek definition"
            value={f.greekDefinition}
            onChange={set("greekDefinition")}
          />
          {!isUniversal ? (
            <input className={input} placeholder="Hebrew word" value={f.hebrewWord} onChange={set("hebrewWord")} />
          ) : null}
          <input
            className={input}
            placeholder="Hebrew definition"
            value={f.hebrewDefinition}
            onChange={set("hebrewDefinition")}
          />
        </div>
        <textarea
          className={input}
          placeholder="First-century context"
          rows={2}
          value={f.firstCenturyContext}
          onChange={set("firstCenturyContext")}
        />
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            data-testid="dict-form-save"
            className="rounded-md bg-burgundy px-3 py-1.5 text-sm font-medium text-cream hover:bg-rose disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
