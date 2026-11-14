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
  too_many_requests: "操作太频繁了，请等一会儿再试",
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
  no_season: "你还没有参加赛季",
  season_not_active: "赛季现在不能进行这个操作",
  withdrawn: "你已经退赛了，只能查看",
  bad_prefs: "选择的内容不对，请重新选",
  needs_reason: "请填写原因",
  not_pending: "这个计划事件已经执行过了，不能再改时间",
  not_failed: "只有失败的计划事件可以重跑",
  not_final: "还没有终局结算",
  file_type: "不支持这种文件格式",
  file_too_big: "文件太大了",
  file_too_long: "视频、音频最长 10 分钟，请剪短一点再传",
  upload_missing: "文件还没传完，请稍等或重新上传",
  upload_size: "文件没传完整，请重新上传",
  already_uploaded: "这个文件已经传完了",
  no_slot: "找不到这份作品",
  media_mismatch: "选的文件和作品类型对不上",
  work_empty: "作品还是空的",
  too_many_images: "图片最多 9 张",
  bad_members: "请勾选参与的组员",
  review_timeout: "已经过了复核时限，这件作品按 AI 分结算了；需要更正请找管理员改判",
  review_done: "这件作品已经复核过了",
  bad_dims: "每个维度都要打分，而且不能超过满分",
  not_closed: "这件作品还没到截止时间",
  already_settled: "已经结算了",
  evidence_required: "至少交一张证据图片",
  explain_length: "文字讲解要 50 到 150 个字",
  explain_missing: "讲解的录音还没传好",
  explain_too_long: "讲解录音最长 90 秒，请重新录一段",
  ai_note_required: "说一句你是怎么用 AI 的",
  no_ai_not_allowed: "这个模板要用到 AI，请说一句你是怎么用的",
  retries_used: "今天重交的次数用完了，明天再来吧",
  not_reviewing: "这条已经有结果了",
  not_gift_week: "这一周没有互赠词条",
  bad_card: "只能从给你们的 3 张词条里选",
  not_debate: "这不是辩论区的争夺",
  side_chosen: "持方已经选好了",
  already_sent: "已经发出去了，不能撤回",
  not_settled: "还没结算，请用裁定",
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
