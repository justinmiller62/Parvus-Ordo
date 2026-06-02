import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { requireSuperAdmin } from "@/src/lib/require-role";

// The (admin) route group is its own chrome — platform-level, NOT the parish AppShell (it manages
// every parish cross-tenant). requireSuperAdmin gates the whole group: a non-super-admin is
// redirected to "/" here, and every admin Server Action re-asserts independently (nav/layout
// hiding is never the enforcement boundary — RFC-004 §6).
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin();
  return (
    <div className="min-h-screen bg-parchment">
      <header className="border-b border-gold/30 bg-navy text-cream">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Building2 className="h-5 w-5 text-gold" aria-hidden />
            <span className="font-heading text-lg tracking-wide">Platform Admin</span>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-cream/80 transition-colors hover:text-gold"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
