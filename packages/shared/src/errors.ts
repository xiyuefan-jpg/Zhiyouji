/**
 * Error codes the API returns, with the Chinese text the website and the
 * admin console show. The API body is `{ error: code, message, ...extra }`.
 */

export const ERROR_TEXT = {
  bad_request: "填写的内容不对，请检查一下",
  phone: "请输入正确的手机号",
  code: "请输入 6 位验证码",
  nickname: "昵称要 1–12 个字",
  too_soon: "验证码已发送，请稍后再试",
  daily_limit: "今天获取验证码的次数太多了，请明天再试",
  ip_limit: "操作太频繁了，请稍后再试",
  captcha_required: "请先完成图形验证",
  captcha_wrong: "图形验证没有通过，请再试一次",
  sms_failed: "短信发送失败，请稍后再试",
  code_expired: "验证码已失效，请重新获取",
  code_wrong: "验证码不对",
  not_logged_in: "请先登录",
  session_expired: "登录已过期，请重新登录",
  consent_required: "请家长先阅读并确认",
  policy_changed: "协议有更新，请家长重新阅读并确认",
  refused: "家长没有同意，暂时不能使用。如果改变主意，可以重新确认",
  no_child: "请先选择孩子",
  child_not_found: "找不到这个孩子",
  too_many_children: "一个手机号下最多 6 个孩子",
  not_found: "找不到",
  forbidden: "没有权限",
  login_failed: "邮箱、密码或两步验证码不对",
  locked: "失败次数太多，请 15 分钟后再试",
  invite_invalid: "邀请链接无效或已过期",
  totp_wrong: "两步验证码不对",
  password_short: "密码至少 10 位",
  email_taken: "这个邮箱已经有账号了",
  cannot_disable_self: "不能停用自己的账号",
  season_not_found: "找不到这个赛季",
  wrong_season_status: "赛季现在的状态不能做这个操作",
  not_sunday: "开营日必须是周日",
  grouping_locked: "分组已经确认锁定，不能再改",
  no_grouping: "还没有生成分组",
  too_few_players: "赛季玩家太少，不够分组",
  team_empty: "有的小组没有成员，请先调整分组",
  not_enrolled: "这个孩子没有开通本赛季",
  bad_position: "没有这个服或这个组",
} as const;

export type ErrorCode = keyof typeof ERROR_TEXT;

export interface ApiError {
  error: ErrorCode | string;
  message: string;
  [extra: string]: unknown;
}

export function errorText(code: string): string {
  return (ERROR_TEXT as Record<string, string>)[code] ?? ERROR_TEXT.bad_request;
}
