"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { BattleState, LogEntry } from "../../lib/battle/types";
import { nameColor, richText } from "./format";
import styles from "./battle.module.css";

export interface BattleOptions { sound: boolean; animations: boolean; showOdds: boolean }

function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [dep]);
  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };
  return { ref, onScroll, stick };
}

function Line({ entry }: { entry: LogEntry }) {
  switch (entry.kind) {
    case "turn": return <h2 className={styles.logTurn}>{entry.text}</h2>;
    case "join": case "leave": return <div className={styles.logSmall}>☆{entry.text}</div>;
    case "damage": return <div className={styles.logDamage}>{entry.text}</div>;
    case "info": case "timer": return <div className={styles.logInfo}>{entry.text}</div>;
    case "chat": return !entry.user ? <div className={styles.logInfo} role="status">{entry.text}</div> : (
      <div className={styles.logChat}>
        <strong style={{ color: nameColor(entry.user ?? "") }}>{entry.user}:</strong> {entry.text}
      </div>
    );
    case "win": return <div className={styles.logWin}>{richText(entry.text)}</div>;
    case "faint": case "start": case "switch": return <div className={styles.logLine} data-gap>{richText(entry.text)}</div>;
    default: return <div className={styles.logLine}>{richText(entry.text)}</div>;
  }
}

export function ChatInput({ name, onSend, placeholder }: { name: string; onSend: (text: string) => void; placeholder?: string }) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };
  return (
    <form className={styles.chatForm} onSubmit={submit}>
      <label htmlFor="chat-input" className={styles.chatName} style={{ color: nameColor(name) }}>{name}:</label>
      <input id="chat-input" className={`pf-input ${styles.chatInput}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} autoComplete="off" placeholder={placeholder} />
    </form>
  );
}

function Popover({ open, onClose, children, align = "left" }: { open: boolean; onClose: () => void; children: ReactNode; align?: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);
  if (!open) return null;
  return <div ref={ref} className={styles.popover} data-align={align}>{children}</div>;
}

interface Props {
  state: BattleState;
  playerName: string;
  sendChat: (text: string) => void;
  options: BattleOptions;
  setOptions: (o: BattleOptions) => void;
}

export function LogPanel({ state, playerName, sendChat, options, setOptions }: Props) {
  const { ref, onScroll, stick } = useAutoScroll(state.log.length);
  const [usersOpen, setUsersOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const toggle = (key: keyof BattleOptions) => setOptions({ ...options, [key]: !options[key] });
  const userCount = state.users.length;

  return (
    <section className={styles.logPanel} aria-label="Battle log">
      <div className={styles.logHead}>
        <div className={styles.popAnchor}>
          <button className={styles.usersTab} onClick={() => setUsersOpen((o) => !o)}>{userCount} {userCount === 1 ? "user" : "users"}</button>
          <Popover open={usersOpen} onClose={() => setUsersOpen(false)}>
            <div className={styles.popTitle}>In this battle</div>
            {state.users.map((u) => <div key={u} className={styles.popRow} style={{ color: nameColor(u) }}>☆{u}</div>)}
          </Popover>
        </div>
        <div className={styles.popAnchor}>
          <button className={styles.button} onClick={() => setOptionsOpen((o) => !o)}>Battle Options</button>
          <Popover open={optionsOpen} onClose={() => setOptionsOpen(false)} align="right">
            <div className={styles.popTitle}>Battle options</div>
            <label className={styles.popRow}><input type="checkbox" checked={options.sound} onChange={() => toggle("sound")} /> Sound effects</label>
            <label className={styles.popRow}><input type="checkbox" checked={options.animations} onChange={() => toggle("animations")} /> Animations</label>
            <label className={styles.popRow}><input type="checkbox" checked={options.showOdds} onChange={() => toggle("showOdds")} /> Show win chances</label>
          </Popover>
        </div>
      </div>

      <div ref={ref} className={styles.log} onScroll={onScroll} role="log" aria-live="polite">
        <div className={styles.formatBlock}>
          <div>Format:</div>
          <strong className={styles.formatName}>{state.format.name}</strong>
          {state.format.rated && <div><span className={styles.rated}>Rated battle</span></div>}
          {state.format.rules.map((r) => <div key={r.name} className={styles.rule}><em>{r.name}:</em> {r.description}</div>)}
        </div>
        {state.log.map((entry) => <Line key={entry.id} entry={entry} />)}
      </div>

      <ChatInput name={playerName} onSend={(t) => { stick.current = true; sendChat(t); }} />
    </section>
  );
}
