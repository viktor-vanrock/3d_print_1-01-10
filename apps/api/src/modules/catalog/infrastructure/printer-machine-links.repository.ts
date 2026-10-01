import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { ConfirmedPrinterMachineLink, OwnedPrinterMachineResolution, PrinterMachineLinksPort } from "../public/printer-machine-links.ts";
import { UUID_RE } from "../domain/catalog.ts";

interface PrinterMachineLinkRow {
  readonly printer_id: string;
  readonly machine_id: string;
  readonly source: string;
  readonly source_url: string | null;
  readonly reviewed_by: string;
  readonly reviewed_at: Date;
}

function toLink(row: PrinterMachineLinkRow): ConfirmedPrinterMachineLink {
  return {
    printerId: row.printer_id,
    machineId: row.machine_id,
    source: row.source,
    sourceUrl: row.source_url,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
  };
}

@Injectable()
export class PrinterMachineLinksRepository implements PrinterMachineLinksPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async confirmedLinkForPrinter(printerId: string): Promise<ConfirmedPrinterMachineLink | null> {
    if (!UUID_RE.test(printerId)) return null;
    const result = await this.pool.query<PrinterMachineLinkRow>(
      `select printer_id, machine_id, source, source_url, reviewed_by, reviewed_at
         from printer_machine_links
        where printer_id = $1`,
      [printerId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toLink(row);
  }

  async resolveOwnedReferences(input: { readonly catalogPrinterId: string | null; readonly machineId: string | null }): Promise<OwnedPrinterMachineResolution> {
    const link = input.catalogPrinterId === null ? null : await this.confirmedLinkForPrinter(input.catalogPrinterId);

    if (input.machineId !== null) {
      if (link !== null && link.machineId !== input.machineId) {
        return {
          kind: "conflict",
          catalogPrinterId: link.printerId,
          ownedMachineId: input.machineId,
          confirmedMachineId: link.machineId,
        };
      }
      return { kind: "owned_machine", machineId: input.machineId, link };
    }

    if (link !== null) return { kind: "confirmed_link", machineId: link.machineId, link };
    return { kind: "none" };
  }
}
