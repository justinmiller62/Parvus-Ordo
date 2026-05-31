import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/src/components/app-shell";
import { ChooseParish } from "@/src/components/choose-parish";
import { getBrand } from "@/src/lib/brand";
import { getViewer } from "@/src/lib/viewer";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const brand = await getBrand();

  // Multi-parish user with no active parish resolved yet → gate on the chooser.
  if (viewer.needsParishChoice && viewer.identity) {
    return <ChooseParish brandName={brand.name} memberships={viewer.identity.memberships} />;
  }

  const displayName = viewer.identity?.displayName || viewer.authed.name || viewer.authed.email;

  return (
    <AppShell
      brandName={brand.name}
      displayName={displayName}
      role={viewer.identity?.role ?? null}
      canImpersonate={viewer.canImpersonate}
      viewingAs={viewer.viewingAs}
      memberships={viewer.identity?.memberships ?? []}
      activeParishId={viewer.identity?.parishId ?? null}
    >
      {children}
    </AppShell>
  );
}
