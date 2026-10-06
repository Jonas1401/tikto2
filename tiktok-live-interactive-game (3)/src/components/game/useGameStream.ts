"use client";

import { useEffect, useRef, useState } from "react";
import type { GameEvent, GameEventType, Snapshot } from "@/lib/game/types";

type HandlerMap = {
  [K in GameEventType]?: (data: Extract<GameEvent, { type: K }>["data"]) => void;
};

const EVENT_TYPES: GameEventType[] = [
  "init",
  "state",
  "gameReset",
  "gameOver",
  "giftStrike",
  "likeBurst",
  "powerMode",
  "viewerJoin",
  "viewerCount",
  "teamPick",
  "spiker",
  "bonusPoolWin",
  "suddenDeath",
  "matchConfig",
  "soldier",
  "chat",
  "tiktokStatus",
];

/**
 * Subscribes to /api/events (SSE) and keeps the shared snapshot in React state.
 * Transient events are delivered to handlers passed via `handlers` (kept in a ref so
 * they can be swapped without reconnecting).
 */
export function useGameStream(handlers: HandlerMap) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef<HandlerMap>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const listeners: Array<[string, (e: MessageEvent) => void]> = [];
    for (const type of EVENT_TYPES) {
      const fn = (e: MessageEvent) => {
        let data: unknown;
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        // Keep the shared snapshot in sync for the structural events.
        if (type === "init" || type === "gameReset") {
          setSnapshot(data as Snapshot);
        } else if (type === "state") {
          setSnapshot((s) => (s ? { ...s, ...(data as Partial<Snapshot>) } : s));
        } else if (type === "gameOver") {
          const d = data as { gameState: Snapshot["gameState"] };
          setSnapshot((s) => (s ? { ...s, gameState: d.gameState, bonusPool: 0 } : s));
        } else if (type === "powerMode") {
          const d = data as { until: number; powerProgress: number };
          setSnapshot((s) =>
            s ? { ...s, powerBoost: { progress: d.powerProgress, activeUntil: d.until } } : s,
          );
        } else if (type === "likeBurst") {
          const d = data as { powerProgress: number };
          setSnapshot((s) =>
            s ? { ...s, powerBoost: { ...s.powerBoost, progress: d.powerProgress } } : s,
          );
        } else if (type === "viewerCount") {
          const d = data as { count: number };
          setSnapshot((s) => (s ? { ...s, viewerCount: d.count } : s));
        } else if (type === "suddenDeath") {
          const d = data as { active: boolean };
          setSnapshot((s) => (s ? { ...s, suddenDeath: d.active } : s));
        } else if (type === "matchConfig") {
          const d = data as { matchDurationMs: number };
          setSnapshot((s) => (s ? { ...s, matchDurationMs: d.matchDurationMs } : s));
        } else if (type === "tiktokStatus") {
          setSnapshot((s) => (s ? { ...s, tiktok: data as Snapshot["tiktok"] } : s));
        } else if (type === "giftStrike") {
          const d = data as { gameState: Snapshot["gameState"]; bonusPool: number; comboCount: number; teamTop: Snapshot["teamTop"]; teamTotals: Snapshot["teamTotals"] };
          setSnapshot((s) =>
            s
              ? { ...s, gameState: d.gameState, bonusPool: d.bonusPool, comboCount: d.comboCount, teamTop: d.teamTop, teamTotals: d.teamTotals }
              : s,
          );
        }
        const h = handlersRef.current[type] as ((d: unknown) => void) | undefined;
        if (h) h(data);
      };
      es.addEventListener(type, fn);
      listeners.push([type, fn]);
    }

    return () => {
      for (const [type, fn] of listeners) es.removeEventListener(type, fn);
      es.close();
    };
  }, []);

  return { snapshot, connected };
}
