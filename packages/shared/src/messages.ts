/**
 * Notifications (PRD part 8 §1, round 30): every notification goes to the
 * in-site message center; four urgent kinds also send an SMS to the parent's
 * phone. SMS texts are fixed (no child names, no links: the site address is
 * pinned in the WeChat group), so the Aliyun templates are easy to approve.
 */

export const NOTIFY_KINDS = [
  "report", // 战报（一天三次）
  "attacked", // 本组被进攻
  "joined_attack", // 有组加入对本组的进攻
  "work_due_6h", // 本组作品还没交（截止前 6 小时）
  "work_due_2h", // 本组作品还没交（截止前 2 小时）
  "supply_due", // 军需任务自己那份还没交（截止前 3 小时）
  "submit_due", // 互赠词条、偏好、战线分配还没提交（截止前 3 小时）
  "outbid", // 仙品出价被超过
  "review_result", // 每日任务审核结果
  "item_used", // 法宝被用在本组身上
  "season_enabled", // 赛季资格开通
  "grouped", // 分组公布
  "announcement", // 公告
  "system", // 其他系统消息
] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/** SMS template per kind; kinds not listed here only go to the message center. */
export const SMS_TEMPLATE_OF: Partial<Record<NotifyKind, SmsTemplate>> = {
  attacked: "attack",
  joined_attack: "attack",
  work_due_6h: "work_due",
  supply_due: "supply_due",
  outbid: "outbid",
};

export type SmsTemplate = "attack" | "work_due" | "supply_due" | "outbid";

/** Fixed texts to submit for approval (the signature 【智游记】 is added by the SMS service). */
export const SMS_TEMPLATE_TEXT: Readonly<Record<SmsTemplate, string>> = {
  attack: "你们组有新的进攻情况，请打开智游记网站查看。",
  work_due: "你们组的作品还没交，离截止不到 6 小时，请打开智游记网站查看。",
  supply_due: "军需任务你自己的那份还没交，离截止不到 3 小时，请打开智游记网站查看。",
  outbid: "你们组的仙品出价被超过了，请打开智游记网站查看。",
};

/** Text of the login code SMS (template with one variable). */
export const SMS_LOGIN_TEXT = "你的验证码是 ${code}，5 分钟内有效。如果不是你本人操作，请忽略。";

export interface MessageView {
  id: string;
  type: NotifyKind | string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  read: boolean;
  /** Which child it is for (null = the whole family). */
  childId: string | null;
}
