import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Mola", description: "AI study companion" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
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
