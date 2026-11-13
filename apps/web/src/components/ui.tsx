/** Small shared pieces: the seal, avatars, read-aloud, empty states, page header. */

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { LeftOutline, SoundOutline } from "antd-mobile-icons";

/** The vermilion seal (印章) — the one decorative mark of the site. */
export function Seal({ text = "智游记", size = 76, tilt = -4, outline = false }: { text?: string; size?: number; tilt?: number; outline?: boolean }) {
  const vertical = text.length > 1;
  const ink = outline ? "var(--ochre)" : "var(--paper-light)";
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: vertical ? size * (0.5 + 0.38 * text.length) : size,
        background: outline ? "transparent" : "var(--vermilion)",
        border: outline ? "2px solid var(--ochre)" : undefined,
        borderRadius: size * 0.1,
        padding: size * 0.07,
        transform: `rotate(${tilt}deg)`,
        flex: "none",
      }}
    >
      <div
        style={{
          border: `${outline ? 1 : 2}px solid ${ink}`,
          borderRadius: size * 0.06,
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: ink,
          fontFamily: "var(--serif)",
          fontWeight: 700,
          fontSize: vertical ? size * 0.34 : size * 0.5,
          lineHeight: 1.05,
          writingMode: vertical ? "vertical-rl" : undefined,
          letterSpacing: vertical ? "0.08em" : undefined,
        }}
      >
        {text}
      </div>
    </div>
  );
}

/** Preset avatars until the illustrated ones arrive (art resource slots, part 5 §7). */
export const AVATAR_GLYPHS: Record<string, { glyph: string; bg: string }> = {
  a1: { glyph: "桃", bg: "#ecc7b4" },
  a2: { glyph: "葫", bg: "#e6cf9f" },
  a3: { glyph: "云", bg: "#dcd3c2" },
  a4: { glyph: "扇", bg: "#e9bfa0" },
  a5: { glyph: "莲", bg: "#efcfc4" },
  a6: { glyph: "竹", bg: "#d6d2a8" },
  a7: { glyph: "灯", bg: "#f0d29a" },
  a8: { glyph: "书", bg: "#dcc7aa" },
  a9: { glyph: "铃", bg: "#e8c48e" },
  a10: { glyph: "山", bg: "#cfc6b4" },
  a11: { glyph: "月", bg: "#e7dcc3" },
  a12: { glyph: "鹤", bg: "#e2d6cc" },
};

export function Avatar({ id, size = 48 }: { id: string; size?: number }) {
  const a = AVATAR_GLYPHS[id] ?? AVATAR_GLYPHS.a1!;
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: a.bg,
        border: "1px solid var(--earth)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--serif)",
        fontWeight: 700,
        fontSize: size * 0.46,
        color: "var(--ink)",
        flex: "none",
      }}
    >
      {a.glyph}
    </div>
  );
}

// ---- read aloud (part 5 §0.3, §5): the phone's own speech, nothing sent anywhere --

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function speak(text: string): void {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

export const AUTO_READ_KEY = "zyj_auto_read";

export function ReadAloud({ text, label = "朗读" }: { text: string; label?: string }) {
  if (!canSpeak()) return null;
  return (
    <button
      type="button"
      onClick={() => speak(text)}
      aria-label={label}
      style={{
        border: "1px solid var(--line)",
        background: "var(--paper-light)",
        borderRadius: 18,
        height: 34,
        padding: "0 12px",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color: "var(--ochre)",
        fontSize: 14,
        cursor: "pointer",
        flex: "none",
      }}
    >
      <SoundOutline fontSize={16} />
      {label}
    </button>
  );
}

/** Speak the text once when the page opens, if 自动朗读 is on (for younger children). */
export function useAutoRead(text: string) {
  useEffect(() => {
    try {
      if (localStorage.getItem(AUTO_READ_KEY) === "1") speak(text);
    } catch {
      /* storage blocked */
    }
  }, [text]);
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Seal text="空" size={52} tilt={3} outline />}
      <div className="empty-title">{title}</div>
      {children && <div>{children}</div>}
    </div>
  );
}

/** Title row for inner pages, with a back arrow. */
export function PageHeader({ title, back = true, right }: { title: string; back?: boolean; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="row" style={{ marginBottom: 14, minHeight: 40 }}>
      {back && (
        <button
          type="button"
          aria-label="返回"
          onClick={() => nav(-1)}
          style={{ border: "none", background: "none", padding: 6, marginLeft: -6, color: "var(--ink)", cursor: "pointer" }}
        >
          <LeftOutline fontSize={22} />
        </button>
      )}
      <h1 className="title grow" style={{ margin: 0, fontSize: 22 }}>
        {title}
      </h1>
      {right}
    </div>
  );
}

/** Ticking seconds countdown (resend code button). */
export function useCountdown(): [number, (ms: number) => void] {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= now) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until, now]);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return [left, (ms: number) => {
    const n = Date.now();
    setNow(n);
    setUntil(n + ms);
  }];
}
