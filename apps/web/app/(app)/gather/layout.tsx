import type { ReactNode } from "react";
import { requireModule } from "@/src/lib/require-role";
import { GatherSubnav } from "@/src/components/gather/gather-subnav";

// The Parvus Gather module shell (RFC-005 §2.1). Nested under (app)/, so it already renders INSIDE
// the parish AppShell (the main sidebar keeps "Gather" active). This layout adds the module's
// persistent sub-nav and is the SINGLE gate for the whole module:
//   • requireModule("gather") — a parish with Gather disabled is sent home, deep link or not
//     (RFC-001 §3.5). Gated ONCE here so no nested gather route can forget it.
//   • the sub-nav is rendered at the LAYOUT level (not pattern-matched in the AppShell), so EVERY
//     route under /gather/* is wrapped by it and can never pop out to a bare nav (the po-s2lm
//     pitfall — Dictionary/Prayers escaped because they lived OUTSIDE the module layout).
// Gather is parishioner-facing (every role), so there is no role gate here — only module-enablement.
export default async function GatherLayout({ children }: { children: ReactNode }) {
  await requireModule("gather");
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
      <GatherSubnav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
