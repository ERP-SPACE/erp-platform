import { Controller, Get, Param, ParseEnumPipe, Query, StreamableFile } from "@nestjs/common";
import { ApiProduces, ApiQuery, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../auth/decorators.js";
import { type DocKind, SalesDocumentsService } from "./sales-documents.service.js";

const format = new ParseEnumPipe({ pdf: "pdf", html: "html" }, { optional: true });

/**
 * Printable sales documents. `?format=html` returns the same page as HTML (screen preview,
 * tests); the default is a PDF. A posted invoice without its IRN prints as provisional.
 */
@ApiTags("sales")
@Controller()
export class SalesDocumentsController {
  constructor(private readonly docs: SalesDocumentsService) {}

  private async file(kind: DocKind, id: string, f: "pdf" | "html" | undefined) {
    const doc = await this.docs.render(kind, id, f ?? "pdf");
    return new StreamableFile(doc.body, {
      type: doc.contentType,
      length: doc.body.length,
      disposition: `inline; filename="${doc.fileName}"`,
    });
  }

  @RequirePermission("sales.view")
  @ApiProduces("application/pdf", "text/html")
  @ApiQuery({ name: "format", enum: ["pdf", "html"], required: false })
  @Get("sales-invoices/:id/pdf")
  invoice(@Param("id") id: string, @Query("format", format) f?: "pdf" | "html") {
    return this.file("SI", id, f);
  }

  @RequirePermission("sales.view")
  @ApiProduces("application/pdf", "text/html")
  @ApiQuery({ name: "format", enum: ["pdf", "html"], required: false })
  @Get("customer-notes/:id/pdf")
  note(@Param("id") id: string, @Query("format", format) f?: "pdf" | "html") {
    return this.file("NOTE", id, f);
  }

  @RequirePermission("sales.view")
  @ApiProduces("application/pdf", "text/html")
  @ApiQuery({ name: "format", enum: ["pdf", "html"], required: false })
  @Get("delivery-challans/:id/pdf")
  challan(@Param("id") id: string, @Query("format", format) f?: "pdf" | "html") {
    return this.file("DC", id, f);
  }

  @RequirePermission("sales.view")
  @ApiProduces("application/pdf", "text/html")
  @ApiQuery({ name: "format", enum: ["pdf", "html"], required: false })
  @Get("proformas/:id/pdf")
  proforma(@Param("id") id: string, @Query("format", format) f?: "pdf" | "html") {
    return this.file("PF", id, f);
  }
}
