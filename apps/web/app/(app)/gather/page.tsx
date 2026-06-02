import Link from "next/link";
import { ArrowRight, HeartHandshake, MessageSquareHeart, Users2, type LucideIcon } from "lucide-react";

export const dynamic = "force-dynamic";

// The Gather module landing — a warm welcome inside the module shell. The live sections (My Groups,
// Requests) are real entry points (their pages arrive with T1-g/T1-h); the rest are noted as on the
// way. Invitation-first voice; motion only behind motion-safe.
export default function GatherHomePage() {
  return (
    <div className="space-y-8">
      <header className="motion-safe:animate-[po-fade-in_0.4s_ease-out]">
        <div className="flex items-center gap-2.5">
          <HeartHandshake className="h-6 w-6 text-gold" aria-hidden />
          <h1 className="font-heading text-2xl text-burgundy">Gather</h1>
        </div>
        <p className="mt-1 max-w-xl text-navy/65">
          Where your parish comes together — the groups people belong to, and the gentle asks that help things happen.
          Everything here is an invitation, never an order.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <SectionCard
          href="/gather/my-groups"
          Icon={Users2}
          title="My Groups"
          desc="The committees, ministries, boards, and teams you’re part of."
        />
        <SectionCard
          href="/gather/requests"
          Icon={MessageSquareHeart}
          title="Requests"
          desc="Gentle asks — lend a hand, or invite someone who can help."
        />
      </div>

      <p className="text-sm text-navy/50">
        More on the way: discover groups to join, meetings, sign-ups, events, shared documents, and a parish health
        overview.
      </p>
    </div>
  );
}

function SectionCard({ href, Icon, title, desc }: { href: string; Icon: LucideIcon; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-xl border border-navy/10 bg-white p-5 shadow-sm transition-all hover:border-gold/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold motion-reduce:transition-none"
    >
      <span className="rounded-lg bg-gold/10 p-2 text-gold-dark">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-heading text-lg text-navy">
          {title}
          <ArrowRight
            className="h-4 w-4 text-navy/30 transition-transform group-hover:translate-x-0.5 group-hover:text-gold motion-reduce:transition-none"
            aria-hidden
          />
        </span>
        <span className="mt-0.5 block text-sm text-navy/60">{desc}</span>
      </span>
    </Link>
  );
}
