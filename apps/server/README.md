# apps/server

API + 后台任务（Fastify + PostgreSQL）。按 PRD 第 2、4、8 部分实现。进度见根目录 `PROGRESS.md`。

```bash
npm run dev -w @zhiyouji/server            # 本地启动（不设 DATABASE_URL 时用内存里的 PGlite）
npm run invite-admin -w @zhiyouji/server -- boss@example.com 名字 admin   # 建第一个管理员，打印邀请码
```

环境变量：`DATABASE_URL`（正式环境的 PostgreSQL）、`SERVER_SECRET`（正式环境必填）、`POLICY_VERSION`（三份协议的版本，改了家长要重新确认）、`PORT`、`TICK_MS`（worker 间隔）、`TRUST_PROXY=1`（在负载均衡后面时）。

外部服务（短信、图形验证、对象存储、AI 打分）现在是假的（`src/providers.ts`、`src/storage.ts`、`src/ai.ts`），阿里云账号开好后换成真的，调用的地方不用改。本地存储放在 `STORAGE_DIR`（默认 `.storage`）。

## 接口一览

所有接口在 `/v1` 下。出错时返回 `{ error, message }`，`message` 是给用户看的中文（`packages/shared/src/errors.ts`）。登录凭证：学生端网站用 Cookie（`zyj_s`），管理端用 `Authorization: Bearer <token>`（也认 Cookie `zyj_a`）。

### 学生端（家长手机号登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/policy` | 三份协议的版本和链接 |
| POST | `/v1/auth/sms-code` | `{ phone, captcha? }` 发验证码。同一手机号 60 秒一次、每天 10 次；24 小时内输错累计 3 次后要图形验证；验证码 5 分钟有效、错 5 次作废 |
| POST | `/v1/auth/login` | `{ phone, code }` 登录；第一次自动建家庭账号。返回 `{ token, me }` 并设 Cookie |
| POST | `/v1/auth/logout` | 退出 |
| GET | `/v1/me` | 家庭、是否需要家长确认、孩子列表、当前选的孩子 |
| POST | `/v1/family/consent` | `{ choice: "agree" \| "disagree", version }` 家长确认。没同意之前，下面的接口都返回 `consent_required` / `refused` |
| GET / POST | `/v1/children` | 孩子档案列表 / 新建（昵称、头像、年级 1–10、讲解偏好），一个手机号最多 6 个 |
| PATCH | `/v1/children/:id` | 改孩子档案；改年级会留历史 |
| POST | `/v1/session/child` | `{ childId }` 选"我是谁" |
| GET | `/v1/messages` | 消息中心（当前孩子的 + 全家的），`?before=&limit=` 翻页 |
| GET | `/v1/messages/unread-count` | 未读数 |
| POST | `/v1/messages/:id/read`、`/v1/messages/read-all` | 标为已读 |

### 管理端（邮箱 + 密码 + 两步验证）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/admin/auth/login` | `{ email, password, totp }`；连续错 5 次锁 15 分钟；30 分钟不操作或满 12 小时自动退出 |
| POST | `/v1/admin/auth/logout` | 退出 |
| GET | `/v1/admin/me` | 当前账号 |
| POST | `/v1/admin/auth/invite/start` | `{ token, password }` 接受邀请第 1 步：设密码，拿两步验证的二维码链接 |
| POST | `/v1/admin/auth/invite/finish` | `{ token, code }` 第 2 步：输一次验证码，账号生效 |
| GET / POST | `/v1/admin/users` | 管理员：账号列表 / 邀请新账号（返回邀请码） |
| POST | `/v1/admin/users/:id/disable` | 管理员：停用账号（立即下线） |
| GET | `/v1/admin/view-log` | 管理员：查看记录（谁看了、下载了哪个孩子的什么） |
| GET | `/v1/admin/messages` 等 | 管理端通知中心（同学生端消息接口） |

### 学生端 · 赛季（选了孩子之后；团队操作要组长或副组长）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/season/me` | `status`：`none` / `waiting`（已开通，等 D0 晚公布分组）/ `playing`（服、组、我的职务、能不能操作、组员） |
| GET | `/v1/season/map`、`/ranking`、`/team`、`/items` | 地图（地块、主人、争夺、效果）、排行榜、本组（粮草、冻结、团队分、法宝、效果、争夺）、法宝图鉴 |
| GET | `/v1/season/ledger?currency=grain\|points` | 本组账本明细 |
| POST | `/v1/season/roles/claim` | `{ role }` 认领组长 / 副组长 |
| POST | `/v1/season/roles/offer`；GET `/roles/transfers`；POST `/roles/transfers/:id` | 移交（`{ role, to }`）→ 对方 `{ accept }` |
| POST | `/v1/season/roles/take-over` | 副组长接任（组长 3 天没来） |
| GET | `/v1/season/lands/:id/quote` | 进攻（或加入）的费用明细 |
| POST | `/v1/season/contests`；GET `/contests/:id`；POST `/contests/:id/join` | 发起进攻 `{ landId }`、详情、加入 |
| POST | `/v1/season/items/use` | `{ itemId, uid?, targetTeamId?, landId?, contestId?, week?, line? }` |
| POST | `/v1/season/center-lands/buy` | `{ landId }`（D8 之后的递减价） |
| GET / POST | `/v1/season/shop`、`/shop/buy`、`/shop/bid` | 商店、买凡品、仙品出价 `{ itemId, amount }` |
| GET / POST | `/v1/season/rounds/:round` | `blind_auction` / `starter_items` / `center_round` / `rare_round`：`{ bid?, prefs }`，截止前可改 |
| GET | `/v1/season/wars`、`/big-battle`；POST `/big-battle/lines` | 周战争、大团战；战线分配 `{ lines: [teamId…] }` |
| GET | `/v1/season/reports`、`/reports/:id`、`/broadcasts`、`/team-feed` | 战报（一天三份）、全服广播、组内动态 |
| POST | `/v1/season/uploads` → PUT 到返回的地址 → POST `/uploads/:id/complete` | 上传文件（`{ kind, contentType, size, filename? }`） |
| GET | `/v1/season/works` | 本组的作品位（争夺、周战争、战线、主战场），截止时间、交了第几版 |
| GET / POST | `/v1/season/works/:slot/materials`；DELETE `/materials/:id` | 素材箱 |
| POST | `/v1/season/works/:slot`；GET `/works/:slot/versions` | 提交作品 `{ mediaKind, fileIds, text?, aiNote?, members }`；历史版本 |
| GET | `/v1/season/works/:slot/result` | 结算后：各组分数、本组每个维度的得分和评语 |

### 学生端 · 数据权利

| 方法 | 路径 | 说明 |
|---|---|---|
| GET / POST | `/v1/data-requests` | 列表；`{ kind: "export", childId }` 立即导出；`{ kind: "delete", childId \| null }` 7 天后删除（null = 整个家庭） |
| POST | `/v1/data-requests/:id/cancel` | 撤回删除申请 |
| GET | `/v1/data-requests/:id/download` | 导出文件的下载链接 |

### 管理端 · 赛季（管理员；复核员只能看）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET / POST | `/v1/admin/seasons`；GET / PATCH `/seasons/:id` | 赛季列表、新建（`{ name, opening, seed?, copyParamsFrom? }`）、详情（含服）、改名或开营日 |
| POST | `/v1/admin/seasons/:id/open-enrollment`、`/reopen-enrollment` | 开放报名；退回报名中（草稿分组作废） |
| GET | `/v1/admin/children?q=` | 按家长手机号或昵称找孩子 |
| GET / POST | `/v1/admin/seasons/:id/players`；GET `/players.csv`；POST `/players/:childId/revoke` | 报名名单、开通（`{ players: [{ childId, paymentNote? }] }`）、导出、撤销 |
| POST | `/v1/admin/seasons/:id/grouping/generate`、`/move`、`/rename`、`/confirm`；GET `/grouping` | 生成分组、换组、改组名、确认锁定（`{ landNames?, prompts? }`） |
| GET / POST | `/v1/admin/seasons/:id/params` | 参数版本和改动；保存新版本 `{ patch, note }` |
| GET | `/v1/admin/calendar?from=&to=`；POST `/calendar/:day` | 日历；`{ kind: "school" \| "rest" \| null, note? }` |
| GET | `/v1/admin/servers/:id` | 实时总览（各组粮草、团队分、法宝、地块、争夺、商店、周战争、大团战） |
| GET | `/v1/admin/servers/:id/ledger?teamId=&currency=` | 账本 |
| GET | `/v1/admin/servers/:id/planned`；POST `/planned/:key/reschedule`、`/planned/:key/rerun` | 计划事件；改时间 `{ runAt, reason }`；重跑失败的 |
| POST | `/v1/admin/servers/:id/pause`、`/resume` | 暂停 `{ reason }` / 恢复（之后的计划事件顺延） |
| POST | `/v1/admin/servers/:id/interventions` | `{ action, …, reason }`：`adjust_ledger`、`reverse_entry`、`set_land_owner`、`give_item`、`remove_item`、`cancel_contest`、`set_role`、`withdraw` |
| GET | `/v1/admin/servers/:id/feed?since=`；POST `/v1/admin/feed/:id/hide` | 战报预览；隐藏一条 `{ reason }` |
| POST | `/v1/admin/servers/:id/finalize`；GET `/scholarship.csv` | 终局结算 `{ poolYuan }`；奖学金发放表 |
| GET | `/v1/admin/op-log?actor=&action=&object=&from=&to=` | 操作日志 |
| GET | `/v1/admin/data-requests` | 家长的导出 / 删除申请 |

### 管理端 · 复核

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/admin/reviews` | 我的复核队列（按到期时间） |
| GET / POST | `/v1/admin/reviews/:id` | 一件作品（盲审：没有组名和组员；记查看记录）；交分 `{ dims, comment, flags? }`，交了不能改 |
| POST | `/v1/admin/reviews/leave` | 登记请假 `{ from, to }` |
| POST | `/v1/admin/reviews/:id/reassign` | 管理员：改派 `{ reviewerId }` |
| POST | `/v1/admin/works/:id/rule` | 管理员：裁定 `{ score, note }`（结算前） |
| GET | `/v1/admin/reviewers/dashboard` | 复核员看板 |

### 开发用的存储

`/v1/dev-storage/*`：本地假存储的上传（PUT）和下载（GET），网址带签名、1 小时有效。正式环境换成阿里云 OSS 的直传网址，网站的调用方式不变。

## 后台任务（worker）

`src/worker.ts`，每 `TICK_MS` 跑一次：
1. 每个进行中的服，按顺序跑到点的计划事件（幂等）；失败的不自动重跑，通知管理员，在管理端手动重跑；
2. 评分流水线：到了截止时间的争夺、周战争、大团战 → AI 初评、分派复核员；复核时限前 6 小时提醒，到时按 AI 分结算；都有分了就结算；
3. 战报（每个公布时刻一份）；
4. 偏好、战线截止前 3 小时的提醒；
5. 到期的删除申请、连续 2 年不登录的清理；
6. 发到点的短信提醒：夜间 21:30–07:00 不发，顺延到 07:00；同一手机号、同一种提醒还没发出去时合并；每个手机号每天最多 5 条。
