"use client";

import { useRouter } from "next/navigation";

/** Jump-to-section dropdown for teacher preview (navigate to any item directly). */
export function PreviewJumpTo({
  lessonId,
  versionId,
  current,
  labels,
}: {
  lessonId: string;
  versionId: string | undefined;
  current: number;
  labels: string[];
}) {
  const router = useRouter();
  const base = `/ocia/lessons/${lessonId}?preview=1${versionId ? `&v=${versionId}` : ""}`;
  return (
    <select
      value={current}
      onChange={(e) => router.push(`${base}&step=${e.target.value}`)}
      data-testid="wizard-jump-to"
      className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700"
    >
      {labels.map((label, i) => (
        <option key={i} value={i}>
          {i + 1}. {label}
        </option>
      ))}
    </select>
  );
}
