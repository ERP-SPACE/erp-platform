import {
  OPENING_BATCH_KINDS,
  OPENING_CHAPTERS,
  OPENING_TEMPLATES,
  type OpeningBatchKind,
  type OpeningChapterCode,
} from "@erp/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Res,
} from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiProduces, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { RequireFreshAuth, RequirePermission } from "../../auth/decorators.js";
import {
  BatchDiscardDto,
  CashAccountDto,
  CashAccountInputDto,
  CashAccountUpdateDto,
  CashConfirmDto,
  ChapterConfirmDto,
  ChapterNotNeededDto,
  GoLiveRequestDto,
  OpeningCheckReportDto,
  OpeningStatusDto,
  OpeningUploadDto,
} from "./opening.dto.js";
import { OpeningService } from "./opening.service.js";

const enumOf = <T extends string>(values: readonly T[]) =>
  new ParseEnumPipe(Object.fromEntries(values.map((v) => [v, v])));

/** Opening Balance Wizard and the Go-Live lock (PRD §5.10, Stage 6). */
@ApiTags("opening")
@Controller("opening")
export class OpeningController {
  constructor(private readonly service: OpeningService) {}

  @RequirePermission("opening.manage")
  @ApiOkResponse({ type: OpeningStatusDto })
  @Get()
  status() {
    return this.service.status();
  }

  @RequirePermission("opening.manage")
  @ApiProduces("text/csv")
  @Get("templates/:kind")
  template(
    @Param("kind", enumOf(OPENING_BATCH_KINDS)) kind: OpeningBatchKind,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const t = OPENING_TEMPLATES[kind];
    void reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${t.fileName}"`);
    return t.csv;
  }

  /** Checks a CSV (dryRun, the default) or imports it as a batch when it has no errors. */
  @RequirePermission("opening.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: OpeningCheckReportDto })
  @Post("uploads")
  upload(@Body() dto: OpeningUploadDto) {
    return this.service.upload(dto);
  }

  @RequirePermission("opening.manage")
  @HttpCode(200)
  @Post("batches/:id/discard")
  discard(@Param("id") id: string, @Body() dto: BatchDiscardDto) {
    return this.service.discard(id, dto.reason);
  }

  @RequirePermission("opening.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: OpeningStatusDto })
  @Post("chapters/:chapter/confirm")
  confirm(
    @Param("chapter", enumOf(OPENING_CHAPTERS)) chapter: OpeningChapterCode,
    @Body() dto: ChapterConfirmDto,
  ) {
    return this.service.confirm(chapter, dto.booksTotal);
  }

  @RequirePermission("opening.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: OpeningStatusDto })
  @Post("chapters/:chapter/not-needed")
  notNeeded(
    @Param("chapter", enumOf(OPENING_CHAPTERS)) chapter: OpeningChapterCode,
    @Body() dto: ChapterNotNeededDto,
  ) {
    return this.service.notNeeded(chapter, dto.reason);
  }

  @RequirePermission("opening.manage")
  @ApiOkResponse({ type: CashAccountDto, isArray: true })
  @Get("cash")
  listCash() {
    return this.service.listCash();
  }

  @RequirePermission("opening.manage")
  @ApiCreatedResponse({ type: CashAccountDto, isArray: true })
  @Post("cash")
  addCash(@Body() dto: CashAccountInputDto) {
    return this.service.addCash(dto);
  }

  @RequirePermission("opening.manage")
  @ApiOkResponse({ type: CashAccountDto, isArray: true })
  @Put("cash/:id")
  updateCash(@Param("id") id: string, @Body() dto: CashAccountUpdateDto) {
    return this.service.updateCash(id, dto);
  }

  @RequirePermission("opening.manage")
  @ApiOkResponse({ type: CashAccountDto, isArray: true })
  @Delete("cash/:id")
  removeCash(@Param("id") id: string) {
    return this.service.removeCash(id);
  }

  /** The accountant confirms a balance with their password (PRD §5.10). */
  @RequirePermission("opening.manage")
  @RequireFreshAuth()
  @HttpCode(200)
  @ApiOkResponse({ type: CashAccountDto, isArray: true })
  @Post("cash/:id/confirm")
  confirmCash(@Param("id") id: string, @Body() dto: CashConfirmDto) {
    return this.service.confirmCash(id, dto.version);
  }

  /** Locks the opening balances (Owner, with password; Q44). */
  @RequirePermission("golive.lock")
  @RequireFreshAuth()
  @HttpCode(200)
  @ApiOkResponse({ type: OpeningStatusDto })
  @Post("go-live")
  goLive(@Body() _dto: GoLiveRequestDto) {
    return this.service.goLive();
  }
}
