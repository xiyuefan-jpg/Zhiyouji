import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ConfigProvider } from "antd-mobile";
import { App } from "../src/App";

describe("the three documents (part 8 §2.1)", () => {
  it("render before any consent, without a request", async () => {
    render(
      <ConfigProvider>
        <MemoryRouter initialEntries={["/docs/children"]}>
          <App />
        </MemoryRouter>
      </ConfigProvider>,
    );
    expect(await screen.findByRole("heading", { name: "儿童个人信息保护规则" })).toBeTruthy();
    expect(screen.getByText("七、监护人的权利")).toBeTruthy();
    expect(screen.getAllByText(/评审人员中有在境外的中国籍大学生/).length).toBeGreaterThan(0);
  });
});
