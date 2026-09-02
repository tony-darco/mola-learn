"use client";

import { Markdown } from "./Markdown";
import { ActivityRow } from "./ActivityRow";
import { ArtifactBlock } from "./artifacts/ArtifactBlock";
import type { Turn } from "./types";

export function TurnView({ turn }: { turn: Turn }) {
  return (
    <div className={`turn turn-${turn.role}`}>
      <div className="turn-role">{turn.role === "user" ? "You" : "Mola"}</div>
      {turn.activity.map((a) => <ActivityRow key={a.id} entry={a} />)}
      {turn.text && <Markdown text={turn.text} />}
      {!turn.text && turn.streaming && <div className="turn-thinking">…</div>}
      {turn.artifacts.map((a) => <ArtifactBlock key={a.id} artifact={a} />)}
      {turn.error && <div className="turn-error">⚠ {turn.error}</div>}
    </div>
  );
}
