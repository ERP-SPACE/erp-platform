import { Controller, Get, Param, ParseEnumPipe, Query, StreamableFile } from "@nestjs/common";
import { ApiProduces, ApiQuery, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../auth/decorators.js";
import type { RenderedDocument } from "../sales/sales-documents.service.js";
import { AccountDocumentsService } from "./account-documents.service.js";
import { StatementQueryDto } from "./collections.dto.js";

const format = new ParseEnumPipe({ pdf: "pdf", html: "html" }, { optional: true });
const file = (doc: RenderedDocument) =>
  new StreamableFile(doc.body, {
    type: doc.contentType,
    length: doc.body.length,
    disposition: `inline; filename="${doc.fileName}"`,
  });

/** Printable statements and advices (`?format=html` for a preview; PDF by default). */
@ApiTags("collections")
@Controller()
export class AccountDocumentsController {
  constructor(private readonly docs: AccountDocumentsService) {}

  @RequirePermission("collections.view")
  @ApiProduces("application/pdf", "text/html")
  @ApiQuery({ name: "format", enum: ["pdf", "html"], required: false })
  @Get("customers/:id/statement/pdf")
  async customerStatement(
    @Param("id") id: string,
    @Query() q: StatementQueryDto,
    @Query("format", format) f?: "pdf" | "html",
  ) {
    return file(await this.docs.statement("CUSTOMER", id, q.from, q.to, f ?? "pdf"));
  }

  @RequirePermission("payables.view")
  @ApiProduces("application/pdf", "text/html")
  @ApiQuery({ name: "format", enum: ["pdf", "html"], required: false })
  @Get("suppliers/:id/statement/pdf")
  async supplierStatement(
    @Param("id") id: string,
    @Query() q: StatementQueryDto,
    @Query("format", format) f?: "pdf" | "html",
  ) {
    return file(await this.docs.statement("SUPPLIER", id, q.from, q.to, f ?? "pdf"));
  }

  @RequirePermission("collections.view")
  @ApiProduces("application/pdf", "text/html")
  @ApiQuery({ name: "format", enum: ["pdf", "html"], required: false })
  @Get("receipts/:id/pdf")
  async receipt(@Param("id") id: string, @Query("format", format) f?: "pdf" | "html") {
    return file(await this.docs.receipt("CUSTOMER", id, f ?? "pdf"));
  }

  @RequirePermission("payables.view")
  @ApiProduces("application/pdf", "text/html")
  @ApiQuery({ name: "format", enum: ["pdf", "html"], required: false })
  @Get("supplier-payments/:id/pdf")
  async payment(@Param("id") id: string, @Query("format", format) f?: "pdf" | "html") {
    return file(await this.docs.receipt("SUPPLIER", id, f ?? "pdf"));
  }

  @RequirePermission("commission.view")
  @ApiProduces("application/pdf", "text/html")
  @ApiQuery({ name: "format", enum: ["pdf", "html"], required: false })
  @Get("commission/payouts/:id/pdf")
  async payout(@Param("id") id: string, @Query("format", format) f?: "pdf" | "html") {
    return file(await this.docs.payout(id, f ?? "pdf"));
  }
}
