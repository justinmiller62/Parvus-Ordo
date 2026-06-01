"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  BookOpenCheck,
  Calendar,
  Clapperboard,
  Film,
  Heart,
  Home,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Check,
  Eye,
  Settings,
  Shield,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { IMPERSONATABLE_ROLES, ROLE_LABELS, type Role } from "@parvaordo/shared";
import { exitImpersonationAction, impersonateAction, setActiveParishAction, signOutAction } from "@/app/(app)/actions";

export interface ShellMembership {
  parishId: string;
  parishName: string;
  role: Role;
}

interface NavItem {
  label: string;
  Icon: LucideIcon;
  href?: string; // present + live = navigable; otherwise "coming soon"
  live?: boolean;
}

function ociaEligible(role: Role | null): boolean {
  return role === "admin" || role === "catechist" || role === "catechumen_candidate" || role === "super_admin";
}

function youthEligible(role: Role | null): boolean {
  return role === "youth_teen" || role === "catechist" || role === "admin" || role === "super_admin";
}

// Top-level nav (parish home): Dashboard + module launchers. Teens are
// Youth-Teaches-only (no parish dashboard), like catechists/learners are OCIA-only.
function topNav(role: Role | null): NavItem[] {
  if (role === "youth_teen") {
    return [{ href: "/youth-teaches", label: "Youth Teaches", Icon: Clapperboard, live: true }];
  }
  // Catechists & learners are module-only — no parish Dashboard.
  const moduleOnly = role === "catechist" || role === "catechumen_candidate";
  const items: NavItem[] = moduleOnly ? [] : [{ href: "/", label: "Dashboard", Icon: LayoutDashboard, live: true }];
  if (role === "super_admin") items.push({ label: "Super Admin", Icon: Shield });
  if (ociaEligible(role)) items.push({ href: "/ocia", label: "OCIA", Icon: BookOpen, live: true });
  if (youthEligible(role)) items.push({ href: "/youth-teaches", label: "Youth Teaches", Icon: Clapperboard, live: true });
  return items;
}

const CATECHIST_MODULES: NavItem[] = [
  { href: "/ocia/media", label: "Media", Icon: Film, live: true },
  { href: "/ocia/applicants", label: "Applicants", Icon: UserPlus, live: true },
  { label: "Calendar", Icon: Calendar },
  { label: "Cohorts", Icon: Users },
  { label: "Dictionary", Icon: BookOpenCheck },
  { label: "Prayers", Icon: Heart },
  { label: "Announcements", Icon: Megaphone },
  { label: "Discussion", Icon: MessageSquare },
  { label: "Settings", Icon: Settings },
];

const LEARNER_MODULES: NavItem[] = [
  { label: "Calendar", Icon: Calendar },
  { label: "Dictionary", Icon: BookOpenCheck },
  { label: "Prayers", Icon: Heart },
  { label: "Announcements", Icon: Megaphone },
  { label: "Discussion", Icon: MessageSquare },
];

// OCIA module nav (when inside /ocia/*). Catechists & learners are OCIA-only, so
// only admin/super_admin get the "back to parish Dashboard" link.
function ociaNav(role: Role | null): NavItem[] {
  const isLearner = role === "catechumen_candidate";
  const canReturnToDashboard = role === "admin" || role === "super_admin";
  return [
    ...(canReturnToDashboard
      ? [{ href: "/", label: "Dashboard", Icon: ArrowLeft, live: true } as NavItem]
      : []),
    { href: "/ocia", label: "OCIA Home", Icon: Home, live: true },
    { href: "/ocia/lessons", label: isLearner ? "My Lessons" : "Lesson Builder", Icon: BookOpen, live: true },
    // Cross-module link so catechists (OCIA-only) can reach Youth Teaches management.
    ...(youthEligible(role) && !isLearner
      ? [{ href: "/youth-teaches", label: "Youth Teaches", Icon: Clapperboard, live: true } as NavItem]
      : []),
    ...(isLearner ? LEARNER_MODULES : CATECHIST_MODULES),
  ];
}

export function AppShell({
  brandName,
  displayName,
  role,
  canImpersonate = false,
  viewingAs = null,
  memberships = [],
  activeParishId = null,
  children,
}: {
  brandName: string;
  displayName: string;
  role: Role | null;
  canImpersonate?: boolean;
  viewingAs?: Role | null;
  memberships?: ShellMembership[];
  activeParishId?: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const activeParishName = memberships?.find((m) => m.parishId === activeParishId)?.parishName;
  const pathname = usePathname();
  const inOcia = pathname === "/ocia" || pathname.startsWith("/ocia/");
  const items = inOcia ? ociaNav(role) : topNav(role);

  // Exact match for the two landing routes; prefix match for deeper routes.
  const isActive = (href: string) =>
    href === "/" || href === "/ocia" ? pathname === href : pathname.startsWith(href);

  function renderItem(item: NavItem) {
    const base = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
    const Icon = item.Icon;

    if (item.live && item.href) {
      const active = isActive(item.href);
      return (
        <Link
          key={item.label}
          href={item.href}
          onClick={() => setOpen(false)}
          data-testid={`nav-${item.href === "/" ? "dashboard" : item.href.slice(1).replace(/\//g, "-")}`}
          className={`${base} ${active ? "bg-gold/15 text-gold" : "text-gray-400 hover:bg-white/10 hover:text-gray-200"}`}
        >
          <Icon className="h-5 w-5" />
          {item.label}
        </Link>
      );
    }
    return (
      <span key={item.label} title="Coming soon" className={`${base} cursor-default text-gray-500/50`}>
        <Icon className="h-5 w-5" />
        {item.label}
      </span>
    );
  }

  const sidebar = (
    <aside className="flex h-dvh w-64 flex-col bg-navy">
      <div className="border-b border-white/10 px-5 py-5">
        <span className="font-heading text-lg font-semibold tracking-[0.18em] text-gold">
          {brandName.toUpperCase()}
        </span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">{items.map(renderItem)}</nav>
      <div className="border-t border-white/10 p-3">
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            <LogOut className="h-5 w-5" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen">
      <div className="hidden lg:block">{sidebar}</div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative h-full w-64">{sidebar}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {viewingAs ? (
          <div
            className="flex items-center justify-between gap-2 bg-rose px-4 py-1.5 text-sm text-white"
            data-testid="impersonation-banner"
          >
            <span className="inline-flex items-center gap-1.5">
              <Eye className="h-4 w-4" />
              Viewing as {ROLE_LABELS[viewingAs]}
            </span>
            <form action={exitImpersonationAction}>
              <button
                type="submit"
                data-testid="exit-impersonation"
                className="rounded bg-white/20 px-2 py-0.5 text-xs font-medium hover:bg-white/30"
              >
                Exit
              </button>
            </form>
          </div>
        ) : null}
        <div className="flex items-center gap-2 border-b border-gray-200 bg-parchment px-4 py-2.5">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-1 text-navy hover:bg-gray-100 lg:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
          <span className="font-heading text-base font-semibold tracking-wider text-burgundy lg:hidden">
            {brandName}
          </span>
          <div className="flex-1" />
          {memberships.length > 1 ? (
            <details className="relative" data-testid="parish-switcher">
              <summary className="cursor-pointer list-none rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">
                {activeParishName ?? "Parish"} ▾
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
                {memberships.map((m) => (
                  <form key={m.parishId} action={setActiveParishAction.bind(null, m.parishId)}>
                    <button
                      type="submit"
                      disabled={m.parishId === activeParishId}
                      data-testid={`switch-${m.parishId}`}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-700 hover:bg-parchment disabled:bg-cream/30 disabled:text-navy"
                    >
                      <span>
                        {m.parishName}
                        <span className="block text-xs text-gray-400">{ROLE_LABELS[m.role]}</span>
                      </span>
                      {m.parishId === activeParishId ? <Check className="h-4 w-4 text-gold" /> : null}
                    </button>
                  </form>
                ))}
              </div>
            </details>
          ) : null}
          {canImpersonate && !viewingAs ? (
            <details className="relative" data-testid="view-as">
              <summary
                data-testid="view-as-toggle"
                className="cursor-pointer list-none rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                View as ▾
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
                {IMPERSONATABLE_ROLES.map((r) => (
                  <form key={r} action={impersonateAction.bind(null, r)}>
                    <button
                      type="submit"
                      data-testid={`view-as-${r}`}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-parchment"
                    >
                      {ROLE_LABELS[r]}
                    </button>
                  </form>
                ))}
              </div>
            </details>
          ) : null}
          <span className="text-sm font-medium text-gray-600">{displayName}</span>
        </div>
        {/* keyed by pathname so each navigation re-runs the transition */}
        <main
          key={pathname}
          className="flex-1 animate-[po-fade-in_220ms_ease-out] overflow-auto bg-parchment p-4 lg:p-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
