export interface InvoiceProvider {
  issue(input: { orderId: string; amountXof: number; shopName: string }): Promise<{ reference: string; invoiceNumber: string }>;
}

export class MockEMecefInvoiceProvider implements InvoiceProvider {
  async issue({ orderId }: { orderId: string; amountXof: number; shopName: string }) {
    return { reference: `mock-emecf-${orderId}`, invoiceNumber: `FDC-${orderId.slice(-8).toUpperCase()}` };
  }
}
