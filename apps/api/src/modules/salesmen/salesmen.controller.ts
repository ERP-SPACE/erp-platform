import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
} from "@nestjs/common";
import { ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { RequirePermission } from "../../auth/decorators.js";
import { validationError } from "../../common/errors.js";
import {
  CloseCommissionRuleDto,
  CommissionRuleItemDto,
  CreateCommissionRuleDto,
  CreateSalesmanDto,
  KycDocumentItemDto,
  SalesmanBlockDto,
  SalesmanDefaultRatesDto,
  SalesmanDetailDto,
  SalesmanItemDto,
  SalesmanListQueryDto,
  UpdateSalesmanDto,
  kycFields,
} from "./salesmen.dto.js";
import { SalesmenService } from "./salesmen.service.js";

@ApiTags("salesmen")
@Controller()
export class SalesmenController {
  constructor(private readonly service: SalesmenService) {}

  @RequirePermission("salesmen.view")
  @ApiOkResponse({ type: SalesmanItemDto, isArray: true })
  @Get("salesmen")
  list(@Query() query: SalesmanListQueryDto) {
    return this.service.list(query);
  }

  @RequirePermission("salesmen.view")
  @ApiOkResponse({ type: SalesmanDetailDto })
  @Get("salesmen/:id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @RequirePermission("salesmen.manage")
  @ApiCreatedResponse({ type: SalesmanDetailDto })
  @Post("salesmen")
  create(@Body() dto: CreateSalesmanDto) {
    return this.service.create(dto);
  }

  @RequirePermission("salesmen.manage")
  @ApiOkResponse({ type: SalesmanDetailDto })
  @Patch("salesmen/:id")
  update(@Param("id") id: string, @Body() dto: UpdateSalesmanDto) {
    return this.service.update(id, dto);
  }

  @RequirePermission("salesmen.manage")
  @ApiOkResponse({ type: SalesmanDetailDto })
  @Put("salesmen/:id/default-rates")
  defaultRates(@Param("id") id: string, @Body() dto: SalesmanDefaultRatesDto) {
    return this.service.setDefaultRates(id, dto);
  }

  @RequirePermission("salesmen.manage")
  @ApiOkResponse({ type: SalesmanDetailDto })
  @Put("salesmen/:id/block")
  block(@Param("id") id: string, @Body() dto: SalesmanBlockDto) {
    return this.service.setBlock(id, dto);
  }

  @RequirePermission("salesmen.view")
  @ApiOkResponse({ type: CommissionRuleItemDto, isArray: true })
  @Get("salesmen/:id/commission-rules")
  commissionRules(@Param("id") id: string) {
    return this.service.commissionRules(id);
  }

  @RequirePermission("commission.manage")
  @ApiCreatedResponse({ type: CommissionRuleItemDto, isArray: true })
  @Post("salesmen/:id/commission-rules")
  addCommissionRule(@Param("id") id: string, @Body() dto: CreateCommissionRuleDto) {
    return this.service.addCommissionRule(id, dto);
  }

  @RequirePermission("commission.manage")
  @ApiOkResponse({ type: CommissionRuleItemDto, isArray: true })
  @Patch("commission-rules/:ruleId")
  closeCommissionRule(@Param("ruleId") ruleId: string, @Body() dto: CloseCommissionRuleDto) {
    return this.service.closeCommissionRule(ruleId, dto);
  }

  /** multipart/form-data: `docType`, optional `notes`, then `file` (fields must come first). */
  @RequirePermission("salesmen.manage")
  @ApiConsumes("multipart/form-data")
  @ApiCreatedResponse({ type: KycDocumentItemDto })
  @Post("salesmen/:id/kyc")
  async uploadKyc(@Param("id") id: string, @Req() request: FastifyRequest) {
    if (!request.isMultipart()) throw validationError("Send the document as multipart/form-data.");
    const part = await request.file();
    if (!part) {
      throw validationError("Choose a file to upload.", [{ path: "file", message: "Required" }]);
    }
    const raw: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(part.fields)) {
      const value = Array.isArray(field) ? field[0] : field;
      if (value && "value" in value) raw[name] = value.value;
    }
    let fields;
    try {
      fields = kycFields.parse(raw);
    } catch (error) {
      if (error instanceof ZodError) {
        throw validationError(
          "Some fields are invalid.",
          error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      throw error;
    }
    let bytes: Buffer;
    try {
      bytes = await part.toBuffer();
    } catch {
      throw validationError("The file is too large.", [
        { path: "file", message: "Maximum size is 5 MB" },
      ]);
    }
    if (part.file.truncated) {
      throw validationError("The file is too large.", [{ path: "file", message: "Too large" }]);
    }
    return this.service.addKyc(id, { fileName: part.filename, bytes }, fields);
  }

  @RequirePermission("salesmen.manage")
  @Get("kyc-documents/:docId/file")
  async downloadKyc(@Param("docId") docId: string) {
    const doc = await this.service.openKyc(docId);
    const safeName = doc.fileName.replace(/[^\w.\- ]/g, "_");
    return new StreamableFile(doc.stream, {
      type: doc.contentType,
      length: doc.size,
      disposition: `attachment; filename="${safeName}"`,
    });
  }

  @RequirePermission("salesmen.manage")
  @HttpCode(204)
  @Delete("kyc-documents/:docId")
  removeKyc(@Param("docId") docId: string) {
    return this.service.removeKyc(docId);
  }
}
