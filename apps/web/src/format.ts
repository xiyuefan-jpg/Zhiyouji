/** Times are always shown in Beijing time (CLAUDE.md: business time is UTC+8). */

const BJ = "Asia/Shanghai";

export function beijingHour(d: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: BJ, hour: "numeric", hourCycle: "h23" }).format(d));
}

export function greeting(d: Date = new Date()): string {
  const h = beijingHour(d);
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** "11月13日 21:05" (Beijing). */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: BJ, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}月${get("day")}日 ${get("hour")}:${get("minute")}`;
}
