"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import { arenaApi, arenaSessionExpired, type ArenaConnection, type ArenaSession, type ArenaView } from "../../lib/arena";

export function useArenaConnection(
 session: ArenaSession | null,
 keys: MutableRefObject<Set<string>>,
 aim: MutableRefObject<{ x: number; y: number } | null>,
 setError: (message: string) => void,
) {
 const [view, setView] = useState<ArenaView | null>(null);
 const [connection, setConnection] = useState<ArenaConnection>("offline");
 useEffect(() => {
  setView(null);
  if (!session) { setConnection("offline"); return; }
  let active = true, authenticated = false, attempts = 0;
  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const expire = (message: string) => {
   active = false;
   authenticated = false;
   setConnection("expired");
   setError(message);
   keys.current.clear();
   ws?.close();
  };
  const schedule = () => {
   if (!active) return;
   authenticated = false;
   keys.current.clear();
   setConnection("reconnecting");
   clearTimeout(watchdog);
   clearTimeout(retry);
   retry = setTimeout(() => void connect(), Math.min(5000, 600 * 2 ** Math.min(attempts++, 4)));
  };
  const connect = async () => {
   if (!active) return;
   setConnection(attempts ? "reconnecting" : "connecting");
   // A failed upgrade cannot reliably expose HTTP status in browsers. Probe
   // with the very same credential before opening/reopening the socket.
   try {
    const next = await arenaApi.view(session);
    if (!active) return;
    setView(next);
   } catch (cause) {
    if (!active) return;
    if (arenaSessionExpired(cause)) { expire(cause instanceof Error ? cause.message : "Arena session expired"); return; }
    setError("Connection interrupted. Retrying your saved arena session…");
    schedule(); return;
   }
   if (!active) return;
   const current = new WebSocket(arenaApi.socketUrl(session.id));
   ws = current;
   const arm = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => current.close(), 10_000);
   };
   arm();
   current.onopen = () => { if (active) current.send(JSON.stringify({ type: "auth", token: session.token })); };
   current.onmessage = (event) => {
    if (!active || current !== ws) return;
    try {
     const next = JSON.parse(event.data) as ArenaView & { error?: string };
     if (next.error) {
      if ([401, 403, 404, 410].includes(Number(next.status))) expire(next.error);
      else { setError(next.error); current.close(); }
      return;
     }
     if (next.id !== session.id || !Array.isArray(next.fighters)) return;
     authenticated = true; attempts = 0;
     setConnection("online"); setView(next); setError(""); arm();
     if (next.status === "finished") { clearTimeout(watchdog); active = false; current.close(); }
    } catch { setError("Could not read the arena update. Retrying…"); current.close(); }
   };
   current.onclose = () => { if (active && current === ws) schedule(); };
   current.onerror = () => current.close();
  };
  void connect();
  const input = setInterval(() => {
   if (!active || !authenticated || ws?.readyState !== WebSocket.OPEN) return;
   const held = keys.current;
   ws.send(JSON.stringify({
    dx: Number(held.has("d") || held.has("arrowright")) - Number(held.has("a") || held.has("arrowleft")),
    dy: Number(held.has("s") || held.has("arrowdown")) - Number(held.has("w") || held.has("arrowup")),
    aimX: aim.current?.x ?? 0, aimY: aim.current?.y ?? 0,
    basic: held.has("j") || held.has(" "), special: held.has("k"), dodge: held.has("shift"),
   }));
  }, 50);
  return () => { active = false; clearInterval(input); clearTimeout(retry); clearTimeout(watchdog); keys.current.clear(); ws?.close(); };
 }, [session, keys, aim, setError]);
 return { view, setView, connection };
}
