import { expect, test, type Page } from "@playwright/test";

function user(capabilities: readonly string[]) {
  return {
    id: "e2e-authz",
    username: "e2e-authz",
    display_name: null,
    avatar_url: null,
    handle_confirmed: true,
    role: "user",
    capabilities,
  };
}

async function fixtures(page: Page, capabilities: readonly string[], adminAllowed = true) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["fetch", "xhr"].includes(request.resourceType())) {
      await route.continue();
      return;
    }
    const json = (value: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
    if (url.pathname === "/auth/session") return json({ user: user(capabilities) });
    if (url.pathname === "/users/e2e-authz") {
      return json({
        user: {
          id: "e2e-authz",
          username: "e2e-authz",
          display_name: null,
          avatar_url: null,
          bio: null,
          website_url: null,
          contacts: [],
          models_count: 0,
          project_views_count: 0,
          project_downloads_count: 0,
          posts_count: 0,
          post_views_count: 0,
          post_score: 0,
          post_comments_count: 0,
          followers_count: 0,
          following_count: 0,
          is_following: false,
          badges: [],
          reputation_score: 0,
          trust_level: 0,
        },
      });
    }
    if (url.pathname === "/models") return json({ models: [], has_more: false, next_cursor: null });
    if (url.pathname === "/feed") return json({ items: [], next_cursor: null });
    if (url.pathname === "/v1/admin/me") {
      return adminAllowed
        ? json({
          user_id: "e2e-authz",
          permissions: capabilities.includes("admin.portal.access")
            ? [{ key: "admin.portal.access", scope: { kind: "global" }, expires_at: null }]
            : [],
        })
        : json({}, 403);
    }
    return json({}, 404);
  });
}
test.describe("Administration and Data navigation",()=>{
  test("keeps Workshop, Data and Administration adjacent and independently visible",async({page})=>{await fixtures(page,["data.materials.manage","admin.portal.access"]);await page.goto("/u/e2e-authz");const tabs=page.getByRole("tab");await expect(tabs.filter({hasText:"Мастерская"})).toBeVisible();await expect(tabs.filter({hasText:"Данные"})).toBeVisible();await expect(tabs.filter({hasText:"Администрирование"})).toBeVisible();const labels=await tabs.allTextContents();expect(labels.slice(-3)).toEqual(["Мастерская","Данные","Администрирование"]);});
  test("does not infer Administration from Data capability",async({page})=>{await fixtures(page,["data.materials.manage"]);await page.goto("/u/e2e-authz");await expect(page.getByRole("tab",{name:"Данные"})).toBeVisible();await expect(page.getByRole("tab",{name:"Администрирование"})).toHaveCount(0);});
  test("backend denial closes a direct admin route despite projected navigation",async({page})=>{await fixtures(page,["admin.portal.access"],false);await page.goto("/admin");await expect(page.getByText("Нет доступа к административному пространству")).toBeVisible();await expect(page.getByRole("heading",{name:"Пользователи"})).toHaveCount(0);});
});
