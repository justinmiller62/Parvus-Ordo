"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Compass,
  FileText,
  Home,
  type LucideIcon,
  MessageSquareHeart,
  Users2,
} from "lucide-react";

// Gather's persistent module sub-nav (RFC-005 §2.1). Rendered by gather/layout.tsx so it wraps
// EVERY nested route structurally — a gather page can never pop out to a bare nav (the po-s2lm
// pitfall, which came from a route living OUTSIDE the module's layout). T1 ships My Groups + Requests
// live (pages land in T1-g/T1-h); later-tier sections are present-but-disabled "Soon" placeholders.
// Warm personality, but the same design tokens; 44pt+ targets, focus-visible rings, and motion only
// behind motion-safe so prefers-reduced-motion is honored.

interface SubnavItem {
  label: string;
  href?: string; // present = live; absent = coming soon
  Icon: LucideIcon;
}

const LIVE: SubnavItem[] = [
  { label: "Gather Home", href: "/gather", Icon: Home },
  { label: "My Groups", href: "/gather/my-groups", Icon: Users2 },
  { label: "Requests", href: "/gather/requests", Icon: MessageSquareHeart },
];

const SOON: SubnavItem[] = [
  { label: "Discover", Icon: Compass },
  { label: "Meetings", Icon: CalendarClock },
  { label: "Sign-Ups", Icon: ClipboardList },
  { label: "Events", Icon: CalendarDays },
  { label: "Documents", Icon: FileText },
  { label: "Health Dashboard", Icon: Activity },
];

export function GatherSubnav() {
  const pathname = usePathname();
  // Exact match for the module landing; prefix for the section roots.
  const isActive = (href: string) => (href === "/gather" ? pathname === "/gather" : pathname.startsWith(href));

  return (
    <nav aria-label="Gather sections" className="shrink-0 lg:w-52">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {LIVE.map((item) => {
          const active = isActive(item.href!);
          const Icon = item.Icon;
          return (
            <li key={item.label} className="shrink-0">
              <Link
                href={item.href!}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold motion-reduce:transition-none ${
                  active ? "bg-burgundy/10 text-burgundy" : "text-navy/70 hover:bg-gold/10 hover:text-burgundy"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}

        <li aria-hidden className="hidden py-1 lg:block">
          <hr className="border-navy/10" />
        </li>

        {SOON.map((item) => {
          const Icon = item.Icon;
          return (
            <li key={item.label} className="shrink-0">
              <span
                title="Coming soon"
                aria-disabled
                className="flex min-h-11 cursor-default items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-navy/35"
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                <span className="whitespace-nowrap">{item.label}</span>
                <span className="ml-auto hidden rounded-full bg-navy/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy/40 lg:inline">
                  Soon
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
