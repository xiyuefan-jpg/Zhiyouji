/**
 * Every time in the console shows Beijing time and the viewer's local time
 * (PRD part 1 constraint 4, part 2 §4.11): admins and reviewers are in the US.
 */

const fmt = (tz: string) =>
  new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function parts(d: Date, tz: string) {
  const p = fmt(tz).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { md: `${get("month")}月${get("day")}日`, hm: `${get("hour")}:${get("minute")}` };
}

export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
}

/** "1月4日 21:05" in Beijing, plus the local time when the viewer is elsewhere. */
export function dualTime(iso: string | Date, zone = localZone()): { beijing: string; local: string | null } {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const bj = parts(d, "Asia/Shanghai");
  const beijing = `${bj.md} ${bj.hm}`;
  if (zone === "Asia/Shanghai" || zone === "Asia/Chongqing") return { beijing, local: null };
  const lo = parts(d, zone);
  return { beijing, local: lo.md === bj.md ? lo.hm : `${lo.md} ${lo.hm}` };
}

export function Time({ iso, zone }: { iso: string | Date; zone?: string }) {
  const t = dualTime(iso, zone);
  return (
    <span>
      北京 {t.beijing}
      {t.local && <span style={{ color: "rgba(0,0,0,0.45)" }}>（你那里 {t.local}）</span>}
    </span>
  );
}
