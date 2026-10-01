export interface ConfirmedPrinterMachineLink {
  readonly printerId: string;
  readonly machineId: string;
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly reviewedBy: string;
  readonly reviewedAt: Date;
}

export type OwnedPrinterMachineResolution =
  | { readonly kind: "none" }
  | { readonly kind: "confirmed_link"; readonly machineId: string; readonly link: ConfirmedPrinterMachineLink }
  | { readonly kind: "owned_machine"; readonly machineId: string; readonly link: ConfirmedPrinterMachineLink | null }
  | {
      readonly kind: "conflict";
      readonly catalogPrinterId: string;
      readonly ownedMachineId: string;
      readonly confirmedMachineId: string;
    };

export interface PrinterMachineLinksPort {
  confirmedLinkForPrinter(printerId: string): Promise<ConfirmedPrinterMachineLink | null>;
  resolveOwnedReferences(input: { readonly catalogPrinterId: string | null; readonly machineId: string | null }): Promise<OwnedPrinterMachineResolution>;
}
