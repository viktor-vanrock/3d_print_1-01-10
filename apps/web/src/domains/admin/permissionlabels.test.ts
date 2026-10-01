import { describe, expect, it } from "vitest";
import { permissionLabel } from "./permissionlabels.ts";

describe("permissionLabel", () => {
  it("presents a Russian product label instead of a technical permission key", () => {
    expect(permissionLabel("admin.portal.access")).toBe("Доступ к разделу «Администрирование»");
    expect(permissionLabel("feed.manage_news")).toBe("Управление новостями");
  });
});
