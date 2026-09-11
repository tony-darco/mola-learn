import Image from "next/image";
import Link from "next/link";

/**
 * Shared layout for the /features/* pages: hero, a real in-app screenshot
 * (where we have one), a few honest detail sections, and a plain sign-up
 * CTA. Deliberately no comparison table or social-proof numbers — we don't
 * have real ones to show yet.
 */
export function FeaturePage({
  title, subtitle, sections, note, screenshot,
}: {
  title: string;
  subtitle: string;
  sections: { heading: string; body: string }[];
  note?: string;
  /** A real screenshot of this feature, taken from the running app. */
  screenshot?: { src: string; width: number; height: number; alt: string };
}) {
  return (
    <>
      <section className="mx-auto max-w-3xl px-6 pb-16 pt-32 text-center">
        <h1 className="mb-6 text-5xl font-semibold leading-tight text-fg sm:text-6xl">{title}</h1>
        <p className="mx-auto max-w-xl text-xl text-fg-muted">{subtitle}</p>
      </section>

      {screenshot && (
        <section className="mx-auto max-w-4xl px-6 pb-16">
          <Image
            src={screenshot.src}
            width={screenshot.width}
            height={screenshot.height}
            alt={screenshot.alt}
            className="w-full h-auto"
            priority
          />
        </section>
      )}

      <section className="mx-auto max-w-3xl divide-y divide-border px-6 pb-16">
        {sections.map((s) => (
          <div key={s.heading} className="py-10">
            <h2 className="mb-3 text-2xl font-semibold text-fg">{s.heading}</h2>
            <p className="text-lg leading-relaxed text-fg-muted">{s.body}</p>
          </div>
        ))}
      </section>

      {note && (
        <section className="mx-auto max-w-2xl px-6 pb-24 text-center text-base text-fg-muted">
          {note}
        </section>
      )}

      <section className="border-t border-border bg-surface px-6 py-20 text-center">
        <h2 className="mb-6 text-3xl font-semibold text-fg">Ready to get started?</h2>
        <Link
          href="/sign-up"
          className="inline-block rounded-md bg-accent px-6 py-3 text-lg font-semibold text-accent-fg no-underline"
        >
          Sign up
        </Link>
      </section>
    </>
  );
}
