import { formatRollBarcode } from "@erp/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Db } from "./client.js";
import {
  batches,
  companies,
  creditPolicies,
  customerShippingAddresses,
  customers,
  deliveryChallanRolls,
  deliveryChallans,
  documentSequences,
  documentSeries,
  goodsReceiptLines,
  goodsReceipts,
  products,
  purchaseOrderLines,
  purchaseOrders,
  receipts,
  rolls,
  salesInvoiceDcs,
  salesInvoiceLines,
  salesInvoiceRolls,
  salesInvoices,
  salesOrderLines,
  salesOrders,
  skus,
  suppliers,
  transporters,
  user,
} from "./schema/index.js";

/**
 * Seed realistic demo transactions so that Sales, Purchase and Inventory screens show data.
 * Creates: POs → GRNs (→ rolls/inventory) → SOs → DCs → SIs → Receipts.
 *
 * This requires the demo masters to exist (run `pnpm db:seed:demo` first).
 */
export async function seedDemoTransactions(
  db: Db,
): Promise<{ skipped: boolean; rolls: number; orders: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.reason', 'Demo transactions seed', true)`);

    const companyRow = (await tx.select().from(companies).where(eq(companies.code, "MAIN")))[0];
    if (!companyRow) throw new Error("Run the base seed (pnpm db:reset) first.");
    const company = companyRow;

    // Check if transactions already exist
    const existingRolls = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(rolls)
      .where(eq(rolls.companyId, company.id));
    if ((existingRolls[0]?.n ?? 0) > 0) {
      return { skipped: true, rolls: existingRolls[0]!.n, orders: 0 };
    }

    const rand = mulberry32(20261031);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    // Fetch needed masters
    const allSuppliers = await tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.companyId, company.id));
    const allCustomers = await tx
      .select({
        id: customers.id,
        stateCode: customers.stateCode,
        legalName: customers.legalName,
        tradeName: customers.tradeName,
        gstin: customers.gstin,
        billingAddress: customers.billingAddress,
        salesmanId: customers.salesmanId,
        creditDays: creditPolicies.creditDays,
      })
      .from(customers)
      .innerJoin(creditPolicies, eq(creditPolicies.customerId, customers.id))
      .where(eq(customers.companyId, company.id));
    const allTransporters = await tx
      .select()
      .from(transporters)
      .where(eq(transporters.companyId, company.id));
    const allSkus = await tx
      .select({
        id: skus.id,
        code: skus.code,
        widthIn: skus.widthIn,
        productId: skus.productId,
        gsm: products.gsm,
        qualityId: products.qualityId,
        categoryId: products.categoryId,
        defaultLengthM: products.defaultLengthM,
      })
      .from(skus)
      .innerJoin(products, eq(products.id, skus.productId))
      .where(eq(skus.companyId, company.id));
    const anyUser = (await tx.select({ id: user.id }).from(user).limit(1))[0];

    if (allSuppliers.length === 0 || allCustomers.length === 0 || allSkus.length === 0) {
      throw new Error("Run demo masters seed (pnpm db:seed:demo) first.");
    }

    // Helper: get next document number
    async function nextDocNo(entityType: string): Promise<string> {
      const [series] = await tx
        .select()
        .from(documentSeries)
        .where(
          and(eq(documentSeries.companyId, company.id), eq(documentSeries.entityType, entityType)),
        );
      if (!series) throw new Error(`No series for ${entityType}`);

      const fy = getFy(today);
      const fyKey = series.resetOnFy ? fy : "0000";

      // Upsert sequence
      await tx
        .insert(documentSequences)
        .values({ seriesId: series.id, fy: fyKey, currentSeq: 0 })
        .onConflictDoNothing();

      const [seq] = await tx
        .update(documentSequences)
        .set({
          currentSeq: sql`${documentSequences.currentSeq} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(documentSequences.seriesId, series.id), eq(documentSequences.fy, fyKey)))
        .returning();

      const prefix = series.prefixTemplate
        .replace("{FY}", fy)
        .replace("{FY_SHORT}", fy.slice(2));
      return `${prefix}${String(seq!.currentSeq).padStart(series.padding, "0")}`;
    }

    let totalRolls = 0;
    let totalOrders = 0;

    // Create 5 purchase orders, each with 2-3 lines
    for (let poIdx = 0; poIdx < 5; poIdx++) {
      const supplier = pick(allSuppliers);
      const poNo = await nextDocNo("PO");
      const poDate = daysAgo(today, 30 - poIdx * 5);
      const isIntraState = supplier.stateCode === "24";

      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          companyId: company.id,
          supplierId: supplier.id,
          poNo,
          date: poDate,
          expectedDate: daysAgo(today, 20 - poIdx * 4),
          status: "Approved",
          regime: isIntraState ? "CGST_SGST" : "IGST",
          approvedAt: new Date(poDate),
          approvedBy: anyUser?.id,
        })
        .returning();

      const lineCount = 2 + Math.floor(rand() * 2);
      const poLines: { id: string; sku: (typeof allSkus)[0]; qty: number; rate: number }[] = [];

      for (let lineNo = 1; lineNo <= lineCount; lineNo++) {
        const sku = pick(allSkus);
        const qty = pick([2000, 3000, 4000, 5000]);
        const rate = 10 + rand() * 8;

        const [line] = await tx
          .insert(purchaseOrderLines)
          .values({
            poId: po!.id,
            lineNo,
            skuId: sku.id,
            description: sku.code,
            gsm: sku.gsm,
            widthIn: sku.widthIn,
            quantityM: qty,
            ratePerM: rate.toFixed(4),
            gstRate: "18.00",
          })
          .returning();
        poLines.push({ id: line!.id, sku, qty, rate });
      }

      // Create GRN for this PO and post it (creates rolls)
      const grnNo = await nextDocNo("GRN");
      const grnDate = daysAgo(today, 25 - poIdx * 5);

      // Create or get batch for this supplier
      const [existingBatch] = await tx
        .select()
        .from(batches)
        .where(eq(batches.supplierId, supplier.id))
        .orderBy(desc(batches.batchSeq))
        .limit(1);

      const batchSeq = (existingBatch?.batchSeq ?? 0) + 1;
      const [batch] = await tx
        .insert(batches)
        .values({
          companyId: company.id,
          supplierId: supplier.id,
          batchSeq,
          date: grnDate,
        })
        .returning();

      const [grn] = await tx
        .insert(goodsReceipts)
        .values({
          companyId: company.id,
          supplierId: supplier.id,
          grnNo,
          poId: po!.id,
          date: grnDate,
          status: "Posted",
          supplierInvoiceNo: `INV-${supplier.shortCode}-${1000 + poIdx}`,
          batchId: batch!.id,
          postedAt: new Date(grnDate),
          postedBy: anyUser?.id,
        })
        .returning();

      // Create GRN lines and rolls
      let rollSeq = 1;
      for (const poLine of poLines) {
        // Create rolls with realistic lengths (1000–1500m each)
        const lengths: number[] = [];
        let remaining = poLine.qty;
        while (remaining > 0) {
          // Pick a length, but cap it at remaining
          const targetLen = pick([1000, 1000, 1200, 1500]);
          const len = Math.min(targetLen, remaining);
          if (len > 0) {
            lengths.push(len);
            remaining -= len;
          } else {
            break;
          }
        }

        const rollList = lengths.length <= 4 ? lengths.join(", ") : `${lengths.length} x ${lengths[0]}`;

        const [grnLine] = await tx
          .insert(goodsReceiptLines)
          .values({
            grnId: grn!.id,
            lineNo: poLines.indexOf(poLine) + 1,
            poLineId: poLine.id,
            skuId: poLine.sku.id,
            description: poLine.sku.code,
            gsm: poLine.sku.gsm,
            widthIn: poLine.sku.widthIn,
            rollList,
            rollCount: lengths.length,
            acceptedM: poLine.qty,
          })
          .returning();

        // Create rolls
        for (const lengthM of lengths) {
          const barcode = formatRollBarcode({
            postedAt: grnDate,
            supplierCode: supplier.shortCode,
            batchSeq: batch!.batchSeq,
            rollSeq,
          });

          await tx.insert(rolls).values({
            companyId: company.id,
            barcode,
            batchId: batch!.id,
            rollSeq,
            supplierId: supplier.id,
            grnId: grn!.id,
            grnLineId: grnLine!.id,
            skuId: poLine.sku.id,
            description: poLine.sku.code,
            gsm: poLine.sku.gsm,
            widthIn: poLine.sku.widthIn,
            originalLengthM: lengthM,
            currentLengthM: lengthM,
            status: "Mapped",
            baseCostPerM: poLine.rate.toFixed(4),
            baseValue: (lengthM * poLine.rate).toFixed(2),
            costPerM: poLine.rate.toFixed(4),
            receivedAt: new Date(grnDate),
            mappedAt: new Date(grnDate),
          });

          rollSeq++;
          totalRolls++;
        }

        // Update batch next roll seq
        await tx
          .update(batches)
          .set({ nextRollSeq: rollSeq })
          .where(eq(batches.id, batch!.id));

        // Update PO line received
        await tx
          .update(purchaseOrderLines)
          .set({ receivedM: poLine.qty })
          .where(eq(purchaseOrderLines.id, poLine.id));
      }

      // Close PO
      await tx.update(purchaseOrders).set({ status: "Closed" }).where(eq(purchaseOrders.id, po!.id));
    }

    // Get available rolls for sales
    const availableRolls = await tx
      .select()
      .from(rolls)
      .where(and(eq(rolls.companyId, company.id), eq(rolls.status, "Mapped")));

    // Create 8 sales orders, some with DCs and invoices
    let rollIdx = 0;
    for (let soIdx = 0; soIdx < 8; soIdx++) {
      const customer = pick(allCustomers);
      const soNo = await nextDocNo("SO");
      const soDate = daysAgo(today, 20 - soIdx * 2);
      const isIntraState = customer.stateCode === "24";

      // Get or create shipping address
      let shippingAddressId: string | null = null;
      const [existingAddr] = await tx
        .select()
        .from(customerShippingAddresses)
        .where(eq(customerShippingAddresses.customerId, customer.id))
        .limit(1);
      if (existingAddr) {
        shippingAddressId = existingAddr.id;
      }

      const gstRate = "18.00";
      const sku = pick(allSkus);
      const totalM = pick([1000, 2000, 3000]);
      const qtyRolls = Math.ceil(totalM / 1000);
      const ratePerM = 15 + rand() * 5;
      const lineAmount = totalM * ratePerM;

      const taxable = lineAmount;
      const taxAmt = taxable * 0.18;
      const cgst = isIntraState ? taxAmt / 2 : 0;
      const sgst = isIntraState ? taxAmt / 2 : 0;
      const igst = isIntraState ? 0 : taxAmt;
      const total = Math.round(taxable + taxAmt);

      const [so] = await tx
        .insert(salesOrders)
        .values({
          companyId: company.id,
          customerId: customer.id,
          soNo,
          date: soDate,
          status: soIdx < 6 ? "Confirmed" : "Draft",
          regime: isIntraState ? "CGST_SGST" : "IGST",
          placeOfSupply: customer.stateCode,
          shippingAddressId,
          salesmanId: customer.salesmanId,
          gross: lineAmount.toFixed(2),
          taxable: taxable.toFixed(2),
          cgst: cgst.toFixed(2),
          sgst: sgst.toFixed(2),
          igst: igst.toFixed(2),
          total: total.toFixed(2),
          confirmedAt: soIdx < 6 ? new Date(soDate) : null,
          confirmedBy: soIdx < 6 ? anyUser?.id : null,
        })
        .returning();

      await tx.insert(salesOrderLines).values({
        soId: so!.id,
        lineNo: 1,
        skuId: sku.id,
        description: sku.code,
        gsm: sku.gsm,
        widthIn: sku.widthIn,
        gstRate,
        totalM,
        qtyRolls,
        allowCut: rand() > 0.3,
        rateSource: "NONE",
        ratePerM: ratePerM.toFixed(4),
        amount: lineAmount.toFixed(2),
      });

      totalOrders++;

      // Create DC and SI for first 4 orders
      if (soIdx < 4 && rollIdx < availableRolls.length) {
        const dcNo = await nextDocNo("DC");
        const dcDate = daysAgo(today, 15 - soIdx * 3);
        const transporter = pick(allTransporters);

        const [dc] = await tx
          .insert(deliveryChallans)
          .values({
            companyId: company.id,
            customerId: customer.id,
            dcNo,
            soId: so!.id,
            date: dcDate,
            status: "Closed",
            transporterId: transporter.id,
            vehicleNo: `GJ-05-${pick(["AB", "CD", "XY"])}-${1000 + soIdx}`,
            value: lineAmount.toFixed(2),
            postedAt: new Date(dcDate),
            postedBy: anyUser?.id,
          })
          .returning();

        // Pick rolls for this DC
        const rollsForDc: (typeof availableRolls)[0][] = [];
        let metresPicked = 0;
        while (metresPicked < totalM && rollIdx < availableRolls.length) {
          const roll = availableRolls[rollIdx]!;
          if (roll.skuId === sku.id || rand() > 0.5) {
            // Accept some mismatch for demo variety
            rollsForDc.push(roll);
            metresPicked += roll.currentLengthM;
          }
          rollIdx++;
        }

        const [soLine] = await tx
          .select()
          .from(salesOrderLines)
          .where(eq(salesOrderLines.soId, so!.id))
          .limit(1);

        let dispatchedM = 0;
        for (const roll of rollsForDc) {
          await tx.insert(deliveryChallanRolls).values({
            dcId: dc!.id,
            soLineId: soLine!.id,
            rollId: roll.id,
            lengthM: roll.currentLengthM,
          });

          await tx
            .update(rolls)
            .set({ status: "Dispatched" })
            .where(eq(rolls.id, roll.id));

          dispatchedM += roll.currentLengthM;
        }

        // Update SO line dispatched
        await tx
          .update(salesOrderLines)
          .set({ dispatchedM })
          .where(eq(salesOrderLines.id, soLine!.id));

        // Create and post sales invoice
        const siNo = await nextDocNo("SI");
        const siDate = daysAgo(today, 12 - soIdx * 3);
        const dueDate = daysAgo(today, 12 - soIdx * 3 - (customer.creditDays ?? 30));

        const billingAddr =
          typeof customer.billingAddress === "object"
            ? `${(customer.billingAddress as { line1?: string }).line1 ?? ""}, ${(customer.billingAddress as { city?: string }).city ?? ""}`
            : String(customer.billingAddress ?? "");

        const [si] = await tx
          .insert(salesInvoices)
          .values({
            companyId: company.id,
            customerId: customer.id,
            siNo,
            date: siDate,
            dueDate: dueDate > todayStr ? dueDate : todayStr,
            status: "Posted",
            source: "DC",
            salesmanId: customer.salesmanId,
            regime: isIntraState ? "CGST_SGST" : "IGST",
            placeOfSupply: customer.stateCode,
            supplyType: customer.gstin ? "B2B" : "B2C",
            customerName: customer.tradeName ?? customer.legalName,
            customerGstin: customer.gstin,
            billingAddress: billingAddr,
            shippingAddress: billingAddr,
            gross: (dispatchedM * ratePerM).toFixed(2),
            taxable: (dispatchedM * ratePerM).toFixed(2),
            cgst: (isIntraState ? (dispatchedM * ratePerM * 0.09) : 0).toFixed(2),
            sgst: (isIntraState ? (dispatchedM * ratePerM * 0.09) : 0).toFixed(2),
            igst: (isIntraState ? 0 : dispatchedM * ratePerM * 0.18).toFixed(2),
            total: Math.round(dispatchedM * ratePerM * 1.18).toFixed(2),
            postedAt: new Date(siDate),
            postedBy: anyUser?.id,
          })
          .returning();

        // Link DC to SI
        await tx.insert(salesInvoiceDcs).values({ siId: si!.id, dcId: dc!.id });

        // Create SI line
        const [siLine] = await tx
          .insert(salesInvoiceLines)
          .values({
            siId: si!.id,
            lineNo: 1,
            kind: "GOODS",
            soLineId: soLine!.id,
            skuId: sku.id,
            description: sku.code,
            hsnCode: "48099000",
            widthIn: sku.widthIn,
            metres: dispatchedM,
            ratePerM: ratePerM.toFixed(4),
            gross: (dispatchedM * ratePerM).toFixed(2),
            taxable: (dispatchedM * ratePerM).toFixed(2),
            gstRate,
            cgst: (isIntraState ? (dispatchedM * ratePerM * 0.09) : 0).toFixed(2),
            sgst: (isIntraState ? (dispatchedM * ratePerM * 0.09) : 0).toFixed(2),
            igst: (isIntraState ? 0 : dispatchedM * ratePerM * 0.18).toFixed(2),
          })
          .returning();

        // Link rolls to SI
        for (const roll of rollsForDc) {
          await tx.insert(salesInvoiceRolls).values({
            siId: si!.id,
            siLineId: siLine!.id,
            rollId: roll.id,
            lengthM: roll.currentLengthM,
            costPerM: roll.costPerM,
            cogs: roll.costPerM
              ? (roll.currentLengthM * parseFloat(roll.costPerM)).toFixed(2)
              : null,
          });
        }

        // Update SO line invoiced
        await tx
          .update(salesOrderLines)
          .set({ invoicedM: dispatchedM })
          .where(eq(salesOrderLines.id, soLine!.id));

        // Update SO status
        await tx
          .update(salesOrders)
          .set({ status: dispatchedM >= totalM ? "Closed" : "PartiallyFulfilled" })
          .where(eq(salesOrders.id, so!.id));

        // Create receipt for first 2 invoices
        if (soIdx < 2) {
          const rcNo = await nextDocNo("RC");
          const rcDate = daysAgo(today, 5 - soIdx * 2);
          const rcAmount = Math.round(dispatchedM * ratePerM * 1.18);

          await tx.insert(receipts).values({
            companyId: company.id,
            partyType: "CUSTOMER",
            customerId: customer.id,
            docNo: rcNo,
            date: rcDate,
            mode: pick(["NEFT", "RTGS", "UPI", "CHEQUE"]),
            amount: rcAmount.toFixed(2),
            reference: `TXN-${100000 + soIdx}`,
            bankName: pick(["HDFC Bank", "ICICI Bank", "SBI", "Axis Bank"]),
            status: "Posted",
            postedAt: new Date(rcDate),
            postedBy: anyUser?.id,
          });
        }
      }
    }

    return { skipped: false, rolls: totalRolls, orders: totalOrders };
  });
}

function getFy(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const fyStart = month >= 4 ? year : year - 1;
  return `${String(fyStart % 100).padStart(2, "0")}${String((fyStart + 1) % 100).padStart(2, "0")}`;
}

function daysAgo(from: Date, days: number): string {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Small deterministic PRNG so the demo data is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
