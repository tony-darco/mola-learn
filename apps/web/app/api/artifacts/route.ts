/**
 * GET /api/artifacts?kind=quiz|flashcard_deck|mind_map (kind optional).
 *
 * The web app's Quizzes/Flashcards/Artifacts galleries are server components
 * that read their per-kind `lib` gallery helpers directly (listQuizzes,
 * listFlashcardDecks, listAllArtifacts) — there was no JSON route backing
 * them before this, since nothing non-browser needed one.
 * nothing non-browser needed one. The iPadOS client (apps/ipad) does, so this
 * wraps the same ownership-scoped reads those pages already use, filtered by
 * `kind` the same way the dedicated gallery pages are.
 */
import { ARTIFACT_KINDS, type ArtifactKind } from "@mola/shared";
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { listAllArtifacts } from "@/lib/artifacts/gallery";

export const dynamic = "force-dynamic";

function isArtifactKind(value: string | null): value is ArtifactKind {
  return value !== null && (ARTIFACT_KINDS as readonly string[]).includes(value);
}

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const kindParam = new URL(req.url).searchParams.get("kind");
    if (kindParam !== null && !isArtifactKind(kindParam)) {
      return Response.json(
        { error: `kind must be one of ${ARTIFACT_KINDS.join(", ")}` },
        { status: 400 },
      );
    }

    const all = await listAllArtifacts(session.userId);
    const artifacts = kindParam ? all.filter((a) => a.kind === kindParam) : all;
    return Response.json({ artifacts });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
