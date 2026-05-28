"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  BookOpenCheck,
  Calendar,
  Film,
  Heart,
  Home,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Settings,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@parvaordo/shared";
import { signOutAction } from "@/app/(app)/actions";

interface NavItem {
  label: string;
  Icon: LucideIcon;
  href?: string; // present + live = navigable; otherwise "coming soon"
  live?: boolean;
}

function ociaEligible(role: Role | null): boolean {
  return role === "admin" || role === "catechist" || role === "catechumen_candidate" || role === "super_admin";
}

// Top-level nav (parish home): Dashboard + module launchers.
function topNav(role: Role | null): NavItem[] {
  const items: NavItem[] = [{ href: "/", label: "Dashboard", Icon: LayoutDashboard, live: true }];
  if (role === "super_admin") items.push({ label: "Super Admin", Icon: Shield });
  if (ociaEligible(role)) items.push({ href: "/ocia", label: "OCIA", Icon: BookOpen, live: true });
  return items;
}

const CATECHIST_MODULES: NavItem[] = [
  { label: "Videos", Icon: Film },
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
    ...(isLearner ? LEARNER_MODULES : CATECHIST_MODULES),
  ];
}

export function AppShell({
  brandName,
  displayName,
  role,
  children,
}: {
  brandName: string;
  displayName: string;
  role: Role | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
