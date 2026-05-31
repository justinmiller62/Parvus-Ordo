"use client";

import { ChevronRight } from "lucide-react";
import { ROLE_LABELS, type Role } from "@parvaordo/shared";
import { setActiveParishAction } from "@/app/(app)/actions";

export interface ChoosableParish {
  parishId: string;
  parishName: string;
  role: Role;
}

/** Shown when a user belongs to 2+ parishes and the active one isn't yet resolved. */
export function ChooseParish({ brandName, memberships }: { brandName: string; memberships: ChoosableParish[] }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-parchment px-5">
      <span className="mb-2 font-heading text-lg font-semibold tracking-[0.18em] text-burgundy">
        {brandName.toUpperCase()}
      </span>
      <h1 className="font-heading text-2xl text-navy">Choose a parish</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">You belong to more than one — pick where to continue.</p>
      <ul className="w-full max-w-sm space-y-2" data-testid="choose-parish">
        {memberships.map((m) => (
          <li key={m.parishId}>
            <form action={setActiveParishAction.bind(null, m.parishId)}>
              <button
                type="submit"
                data-testid={`choose-${m.parishId}`}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left hover:border-gold hover:bg-cream/20"
              >
                <span>
                  <span className="block font-medium text-navy">{m.parishName}</span>
                  <span className="text-xs text-gray-500">{ROLE_LABELS[m.role]}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
