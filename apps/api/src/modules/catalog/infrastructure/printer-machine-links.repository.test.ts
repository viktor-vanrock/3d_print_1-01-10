import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PrinterMachineLinksRepository } from "./printer-machine-links.repository.ts";

const PRINTER_ID = "11111111-1111-4111-8111-111111111111";
const MACHINE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_MACHINE_ID = "33333333-3333-4333-8333-333333333333";

function repository(rows: readonly Record<string, unknown>[]) {
  const query = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
  return { repository: new PrinterMachineLinksRepository({ query } as unknown as Pool), query };
}

describe("PrinterMachineLinksRepository", () => {
  it("returns no technical join for an absent or invalid catalog mapping", async () => {
    const absent = repository([]);
    await expect(absent.repository.resolveOwnedReferences({ catalogPrinterId: PRINTER_ID, machineId: null })).resolves.toEqual({ kind: "none" });
    expect(absent.query).toHaveBeenCalledWith(expect.stringContaining("where printer_id = $1"), [PRINTER_ID]);

    const invalid = repository([]);
    await expect(invalid.repository.confirmedLinkForPrinter("Creality K1")).resolves.toBeNull();
    expect(invalid.query).not.toHaveBeenCalled();
  });

  it("resolves only the explicit confirmed printer id", async () => {
    const reviewedAt = new Date("2026-09-20T10:00:00.000Z");
    const fixture = repository([
      {
        printer_id: PRINTER_ID,
        machine_id: MACHINE_ID,
        source: "manual-review",
        source_url: "https://example.test/review",
        reviewed_by: "catalog-team",
        reviewed_at: reviewedAt,
      },
    ]);
    await expect(fixture.repository.resolveOwnedReferences({ catalogPrinterId: PRINTER_ID, machineId: null })).resolves.toEqual({
      kind: "confirmed_link",
      machineId: MACHINE_ID,
      link: {
        printerId: PRINTER_ID,
        machineId: MACHINE_ID,
        source: "manual-review",
        sourceUrl: "https://example.test/review",
        reviewedBy: "catalog-team",
        reviewedAt,
      },
    });
    expect(fixture.query.mock.calls[0]?.[0]).not.toMatch(/brand|model|alias|similar/i);
  });

  it("keeps an exact owned machine without requiring a mapping", async () => {
    const fixture = repository([]);
    await expect(fixture.repository.resolveOwnedReferences({ catalogPrinterId: PRINTER_ID, machineId: MACHINE_ID })).resolves.toEqual({
      kind: "owned_machine",
      machineId: MACHINE_ID,
      link: null,
    });
  });

  it("reports contradictory owned and confirmed references", async () => {
    const fixture = repository([
      {
        printer_id: PRINTER_ID,
        machine_id: MACHINE_ID,
        source: "manual-review",
        source_url: null,
        reviewed_by: "catalog-team",
        reviewed_at: new Date("2026-09-20T10:00:00.000Z"),
      },
    ]);
    await expect(fixture.repository.resolveOwnedReferences({ catalogPrinterId: PRINTER_ID, machineId: OTHER_MACHINE_ID })).resolves.toEqual({
      kind: "conflict",
      catalogPrinterId: PRINTER_ID,
      ownedMachineId: OTHER_MACHINE_ID,
      confirmedMachineId: MACHINE_ID,
    });
  });
});
