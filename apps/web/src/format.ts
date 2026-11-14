import { serverNow } from "./api";
/** Times are always shown in Beijing time (CLAUDE.md: business time is UTC+8). */

const BJ = "Asia/Shanghai";

export function beijingHour(d: Date = new Date(serverNow())): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: BJ, hour: "numeric", hourCycle: "h23" }).format(d));
}

export function greeting(d: Date = new Date(serverNow())): string {
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

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** "周三 21:00" (Beijing). */
export function weekdayTime(ms: number): string {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: BJ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return `${WEEKDAYS[wd]} ${get("hour")}:${get("minute")}`;
}

/**
 * Every deadline shows the time left and the Beijing time (part 5 §5):
 * "还剩 1 天 3 小时（周三 21:00）"; "已截止（周三 21:00）" once past.
 */
export function countdown(deadline: number, now: number = serverNow()): string {
  const at = weekdayTime(deadline);
  const left = deadline - now;
  if (left <= 0) return `已截止（${at}）`;
  const mins = Math.floor(left / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const text = days > 0 ? `${days} 天 ${hours} 小时` : hours > 0 ? `${hours} 小时 ${m} 分` : `${Math.max(1, m)} 分钟`;
  return `还剩 ${text}（${at}）`;
}
