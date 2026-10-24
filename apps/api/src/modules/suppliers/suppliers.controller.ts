import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../auth/decorators.js";
import {
  CreateSupplierDto,
  CreateTransporterDto,
  MasterListQueryDto,
  SupplierItemDto,
  TransporterItemDto,
  UpdateSupplierDto,
  UpdateTransporterDto,
} from "./suppliers.dto.js";
import { SuppliersService } from "./suppliers.service.js";

@ApiTags("suppliers")
@Controller()
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @RequirePermission("suppliers.view")
  @ApiOkResponse({ type: SupplierItemDto, isArray: true })
  @Get("suppliers")
  list(@Query() query: MasterListQueryDto) {
    return this.service.listSuppliers(query);
  }

  @RequirePermission("suppliers.view")
  @ApiOkResponse({ type: SupplierItemDto })
  @Get("suppliers/:id")
  get(@Param("id") id: string) {
    return this.service.getSupplier(id);
  }

  @RequirePermission("suppliers.manage")
  @ApiCreatedResponse({ type: SupplierItemDto })
  @Post("suppliers")
  create(@Body() dto: CreateSupplierDto) {
    return this.service.createSupplier(dto);
  }

  @RequirePermission("suppliers.manage")
  @ApiOkResponse({ type: SupplierItemDto })
  @Patch("suppliers/:id")
  update(@Param("id") id: string, @Body() dto: UpdateSupplierDto) {
    return this.service.updateSupplier(id, dto);
  }
}

@ApiTags("transporters")
@Controller()
export class TransportersController {
  constructor(private readonly service: SuppliersService) {}

  @RequirePermission("transporters.view")
  @ApiOkResponse({ type: TransporterItemDto, isArray: true })
  @Get("transporters")
  list(@Query() query: MasterListQueryDto) {
    return this.service.listTransporters(query);
  }

  @RequirePermission("transporters.manage")
  @ApiCreatedResponse({ type: TransporterItemDto })
  @Post("transporters")
  create(@Body() dto: CreateTransporterDto) {
    return this.service.createTransporter(dto);
  }

  @RequirePermission("transporters.manage")
  @ApiOkResponse({ type: TransporterItemDto })
  @Patch("transporters/:id")
  update(@Param("id") id: string, @Body() dto: UpdateTransporterDto) {
    return this.service.updateTransporter(id, dto);
  }
}
