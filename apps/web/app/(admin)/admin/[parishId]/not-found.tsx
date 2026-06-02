import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function ParishNotFound() {
  return (
    <div className="motion-safe:animate-[po-fade-in_0.4s_ease-out] rounded-xl border border-dashed border-navy/20 bg-cream/40 px-6 py-12 text-center">
      <p className="font-heading text-lg text-navy">Parish not found</p>
      <p className="mt-1 text-sm text-navy/60">It may have been removed, or the link is out of date.</p>
      <Link
        href="/admin"
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-gold-dark transition-colors hover:text-gold"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> All parishes
      </Link>
    </div>
  );
}
