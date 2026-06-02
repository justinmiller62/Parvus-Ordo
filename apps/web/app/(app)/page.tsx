import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, Clapperboard, Users } from "lucide-react";
import { getMinistries, getParishById } from "@parvaordo/core";
import { moduleAvailable, ROLE_LABELS } from "@parvaordo/shared";
import { getViewer } from "@/src/lib/viewer";

export default async function HomePage() {
  const viewer = await getViewer();
  if (!viewer) return null; // layout guards; this narrows types

  const { authed, identity } = viewer;
  const role = identity?.role ?? null;

  // Catechists & learners are OCIA-only — they have no parish dashboard.
  if (role === "catechist" || role === "catechumen_candidate") redirect("/ocia");
  // Teens are Youth-Teaches-only — land them on their projects.
  if (role === "studio") redirect("/parvus-studio");

  const parishId = identity?.parishId ?? null;
  // Module launcher cards — the same single source of truth as the app-shell nav:
  // moduleAvailable(role, key, enabledModules) gates on BOTH role capability AND the
  // parish's per-module enablement (RFC-001 §3.5). Single-module roles (catechist/learner,
  // studio) are redirected away above, so OCIA/Studio here resolve to "admins only" by role.
  const showOcia = moduleAvailable(role, "ocia", viewer.enabledModules);
  const showStudio = moduleAvailable(role, "studio", viewer.enabledModules);
  const showPeople = moduleAvailable(role, "people", viewer.enabledModules);

  const [parish, ministries] = await Promise.all([
    parishId ? getParishById(parishId) : Promise.resolve(null),
    parishId ? getMinistries(parishId) : Promise.resolve([]),
  ]);

  const displayName = identity?.displayName || authed.name || authed.email;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-heading text-2xl text-navy">Welcome, {displayName}.</h1>
      <p className="mt-1 text-gray-500">Many small things, rightly ordered.</p>

      {!parishId ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          You&apos;re signed in as <strong>{authed.email}</strong>, but no parish is assigned to this account yet.
        </div>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-white p-5 text-sm sm:grid-cols-3">
            <div>
              <dt className="font-semibold text-gray-400">Role</dt>
              <dd className="mt-0.5 text-navy">{role ? ROLE_LABELS[role] : "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-400">Parish</dt>
              <dd className="mt-0.5 text-navy">{parish?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-400">Email</dt>
              <dd className="mt-0.5 truncate text-navy">{authed.email}</dd>
            </div>
          </dl>

          <section className="mt-6">
            <h2 className="text-sm font-semibold text-gray-400">Ministries &amp; councils ({ministries.length})</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {ministries.map((m) => (
                <li key={m.id} className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-sm text-navy">
                  {m.name}
                </li>
              ))}
            </ul>
          </section>

          {showOcia || showStudio || showPeople ? (
            <section className="mt-6 space-y-3">
              <h2 className="text-sm font-semibold text-gray-400">Modules</h2>
              {showOcia ? (
                <Link
                  href="/ocia"
                  data-testid="module-ocia"
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gold hover:bg-parchment"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy text-gold">
                    <BookOpen className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-medium text-navy">OCIA</span>
                    <span className="block text-sm text-gray-500">Order of Christian Initiation of Adults</span>
                  </span>
                </Link>
              ) : null}
              {showStudio ? (
                <Link
                  href="/parvus-studio"
                  data-testid="module-parvus-studio"
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gold hover:bg-parchment"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy text-gold">
                    <Clapperboard className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-medium text-navy">Parvus Studio</span>
                    <span className="block text-sm text-gray-500">
                      Studio creators script &amp; record short catechetical videos
                    </span>
                  </span>
                </Link>
              ) : null}
              {showPeople ? (
                <Link
                  href="/people"
                  data-testid="module-people"
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gold hover:bg-parchment"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy text-gold">
                    <Users className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-medium text-navy">People</span>
                    <span className="block text-sm text-gray-500">
                      Invite members, manage roles, review pending invitations
                    </span>
                  </span>
                </Link>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
