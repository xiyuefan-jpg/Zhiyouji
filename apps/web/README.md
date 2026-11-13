# apps/web

学生端网站（第三十轮：网站先行）。React 18 + Vite + Ant Design Mobile，手机优先，也能在电脑和微信内置浏览器里用。按 PRD 第 5 部分实现；以后用 Capacitor 打包成 app。

```bash
npm run dev -w @zhiyouji/server   # 先起服务器（:3000，登录验证码打印在服务器日志里）
npm run dev -w @zhiyouji/web      # 再起网站（:5173，/v1 转到服务器）
npm run build -w @zhiyouji/web    # 打包到 apps/web/dist（静态文件，和 /v1 放在同一个域名下）
```

## 现在有的页面

| PRD 编号 | 页面 | 文件 |
|---|---|---|
| A1 | 第一次打开的隐私弹窗（同意之前不发任何请求） | `src/pages/Gate.tsx` |
| A2 | 家长手机号 + 验证码登录 | `src/pages/Login.tsx` |
| A2 | 家长确认（同意 / 不同意；协议更新后重新确认） | `src/pages/Consent.tsx` |
| A3 / G2 | 我是谁、给孩子建档案、修改资料 | `src/pages/Children.tsx` |
| 第 1 节 | 底部 5 个标签：首页、地图、小组、战报、我 | `src/pages/Shell.tsx`、`src/pages/Tabs.tsx` |
| F6 | 我的消息（未读标记、全部已读、翻页） | `src/pages/Messages.tsx` |
| G1、G3–G5 | 我、设置（讲解方式、自动朗读、通知说明）、协议与隐私、关于与 AI 公示 | `src/pages/Me.tsx` |

地图、小组、战报、排行榜现在是空状态页，等服务器的赛季接口做好后接上。

## 约定

- 颜色和字体在 `src/styles.css`（PRD 第 5 部分第 7 节：杏色、赭石、土黄、淡朱砂，墨色文字，朱红只用在主要按钮和紧急提醒上）。不加载网络字体。
- 朗读用浏览器自带的语音（`speechSynthesis`），不发到任何地方。
- 录音、上传放在 `src/platform/` 后面，以后打包成 app 时换成手机原生实现，页面不用改。
- 测试（`test/`）在进程里跑真的服务器代码，一个测试从打开网站一路走到首页。
