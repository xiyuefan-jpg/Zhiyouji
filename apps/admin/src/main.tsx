import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import "dayjs/locale/zh-cn";
import { App } from "./App";
import { AuthProvider } from "./auth";

/** Same warm palette as the student website, quieter for a work tool. */
export const THEME = {
  token: {
    colorPrimary: "#9c6b43",
    colorError: "#a93a2a",
    colorLink: "#9c6b43",
    colorBgLayout: "#f8f1e7",
    borderRadius: 8,
    fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Segoe UI", sans-serif',
  },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={THEME}>
      <AntApp>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
