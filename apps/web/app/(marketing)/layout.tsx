import type { ReactNode } from "react";
import { getSession } from "@/lib/auth/session";
import { MarketingNav } from "@/components/marketing/MarketingNav";

export const dynamic = "force-dynamic";

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <MarketingNav isAuthenticated={!!session} />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border px-6 py-8 text-center text-xs text-fg-muted">
        © {new Date().getFullYear()} Mola
      </footer>
    </div>
  );
}
