import { requireSession } from "@/lib/auth/ownership";
import { listAllArtifacts } from "@/lib/artifacts/gallery";
import { listCoursesForFilters, listTermsForFilters } from "@/lib/artifacts/filters";
import { ArtifactsGallery } from "@/components/chat/ArtifactsGallery";

export const dynamic = "force-dynamic";

/** The unified Artifacts page (design doc §8) — every kind together. */
export default async function ArtifactsPage() {
  const session = await requireSession();

  const [artifacts, courses, terms] = await Promise.all([
    listAllArtifacts(session.userId),
    listCoursesForFilters(session.userId),
    listTermsForFilters(session.userId),
  ]);

  const clientArtifacts = artifacts.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  }));

  return (
    <main className="flex-1 min-w-0 overflow-y-auto py-8 pl-4 pr-6">
      <div className="mx-auto max-w-7xl">
        <ArtifactsGallery artifacts={clientArtifacts} courses={courses} terms={terms} />
      </div>
    </main>
  );
}
