import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Mola", description: "AI study companion" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme (General settings) before paint, so the
            page never flashes the wrong colors. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.setAttribute("data-theme",localStorage.getItem("mola-theme")||"mola")}catch(e){}`,
          }}
        />
        {/* Applies the saved app-wide font scale (General settings, dev tool)
            before paint — Tailwind's text-* utilities are all rem-based, so
            this one root font-size rescales every one of them at once. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=localStorage.getItem("mola-font-scale")||"87.5";document.documentElement.style.fontSize=s+"%"}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
