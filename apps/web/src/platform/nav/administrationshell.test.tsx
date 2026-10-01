import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@shared/types";
import { AdministrationShell } from "./administrationshell.tsx";

vi.mock("./homeheader.tsx", () => ({ HomeHeader: () => <header data-testid="site-header">Навигация</header> }));

const user: SessionUser = { id: "actor", username: "admin", display_name: "Admin", avatar_url: null, handle_confirmed: true, role: "user", capabilities: ["admin.portal.access"] };
afterEach(cleanup);

describe("AdministrationShell", () => {
  it("uses the shared site chrome and keeps Administration separate from Data", () => {
    render(<AdministrationShell user={user} section="home" onSectionChange={() => undefined} permissions={new Set(["user.view_any"])}><p>Контент</p></AdministrationShell>);
    expect(screen.getByTestId("site-header")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Администрирование" })).toBeTruthy();
    expect(screen.queryByText("Материалы")).toBeNull();
  });

  it("removes anchor pseudo-tabs and gates the audit destination", () => {
    const { rerender } = render(<AdministrationShell user={user} section="home" onSectionChange={() => undefined} permissions={new Set(["user.view_any"])}><p>Контент</p></AdministrationShell>);
    expect(screen.queryByRole("navigation", { name: "Разделы администрирования" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Журнал действий" })).toBeNull();
    rerender(<AdministrationShell user={user} section="home" onSectionChange={() => undefined} permissions={new Set(["audit.view_log"])}><p>Контент</p></AdministrationShell>);
    expect(screen.getByRole("link", { name: "Журнал действий" }).getAttribute("href")).toBe("/admin/audit");
  });
});
