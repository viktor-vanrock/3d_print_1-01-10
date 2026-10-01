// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MermaidDiagram } from "../mermaiddiagram.tsx";

vi.mock("@platform/theme", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><a href="javascript:alert(2)"><text onclick="alert(3)">safe</text></a></svg>',
    }),
  },
}));

afterEach(cleanup);

describe("MermaidDiagram", () => {
  it("sanitizes rendered SVG immediately before inserting it into the DOM", async () => {
    const { container } = render(<MermaidDiagram source="graph LR; A-->B" />);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(container.innerHTML).not.toContain("javascript:");
    expect(container.textContent).toContain("safe");
  });
});
