import { auditLog, user } from "@erp/db";
import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { and, desc, eq, gte, lt, lte, or, type SQL } from "drizzle-orm";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { RequirePermission } from "../../auth/decorators.js";
import { actor } from "../../common/context.js";
import { AuditPageDto } from "../../common/responses.js";
import { UnitOfWork } from "../../db/unit-of-work.js";

class AuditQueryDto extends createZodDto(
  z.object({
    table: z.string().max(64).optional(),
    rowId: z.string().max(200).optional(),
    userId: z.string().max(64).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    /** Keyset cursor: `<at ISO>|<id>` of the last row on the previous page. */
    cursor: z.string().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
) {}

@ApiTags("audit")
@Controller("audit")
export class AuditController {
  constructor(private readonly uow: UnitOfWork) {}

  /** Newest first, keyset-paginated. Before/after JSON is returned as stored (secrets redacted). */
  @RequirePermission("audit.view")
  @ApiOkResponse({ type: AuditPageDto })
  @Get()
  async list(@Query() q: AuditQueryDto) {
    const filters: (SQL | undefined)[] = [eq(auditLog.companyId, actor().companyId)];
    if (q.table) filters.push(eq(auditLog.tableName, q.table));
    if (q.rowId) filters.push(eq(auditLog.rowId, q.rowId));
    if (q.userId) filters.push(eq(auditLog.userId, q.userId));
    if (q.from) filters.push(gte(auditLog.at, new Date(q.from)));
    if (q.to) filters.push(lte(auditLog.at, new Date(q.to)));
    if (q.cursor) {
      const [at, id] = q.cursor.split("|");
      const cursorAt = new Date(at!);
      filters.push(or(lt(auditLog.at, cursorAt), and(eq(auditLog.at, cursorAt), lt(auditLog.id, Number(id)))));
    }

    const rows = await this.uow.db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        tableName: auditLog.tableName,
        rowId: auditLog.rowId,
        action: auditLog.action,
        before: auditLog.before,
        after: auditLog.after,
        changedKeys: auditLog.changedKeys,
        reason: auditLog.reason,
        requestId: auditLog.requestId,
        userId: auditLog.userId,
        userName: user.name,
      })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.userId))
      .where(and(...filters))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(q.limit + 1);

    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({ ...r, at: r.at.toISOString() })),
      nextCursor: rows.length > q.limit && last ? `${last.at.toISOString()}|${last.id}` : null,
    };
  }
}
