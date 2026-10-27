import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { RequireFreshAuth, RequirePermission, RequireReason } from "../../auth/decorators.js";
import {
  BlockCustomerDto,
  CreateCustomerDto,
  CustomerDefaultsDto,
  CustomerDefaultsQueryDto,
  CustomerDetailDto,
  CustomerGroupItemDto,
  CustomerListItemDto,
  CustomerListQueryDto,
  UpdateCreditPolicyDto,
  UpdateCustomerDto,
} from "./customers.dto.js";
import { CustomersService } from "./customers.service.js";

@ApiTags("customers")
@Controller()
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @RequirePermission("customers.view")
  @ApiOkResponse({ type: CustomerGroupItemDto, isArray: true })
  @Get("customer-groups")
  groups() {
    return this.service.groups();
  }

  @RequirePermission("customers.view")
  @ApiOkResponse({ type: CustomerListItemDto, isArray: true })
  @Get("customers")
  list(@Query() query: CustomerListQueryDto) {
    return this.service.list(query);
  }

  @RequirePermission("customers.manage")
  @ApiOkResponse({ type: CustomerDefaultsDto })
  @Get("customers/defaults")
  defaults(@Query() query: CustomerDefaultsQueryDto) {
    return this.service.defaults(query.salesmanId);
  }

  @RequirePermission("customers.view")
  @ApiOkResponse({ type: CustomerDetailDto })
  @Get("customers/:id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @RequirePermission("customers.manage")
  @ApiCreatedResponse({ type: CustomerDetailDto })
  @Post("customers")
  create(@Body() dto: CreateCustomerDto) {
    return this.service.create(dto);
  }

  @RequirePermission("customers.manage")
  @ApiOkResponse({ type: CustomerDetailDto })
  @Patch("customers/:id")
  update(@Param("id") id: string, @Body() dto: UpdateCustomerDto) {
    return this.service.update(id, dto);
  }

  @RequirePermission("customers.credit.manage")
  @RequireFreshAuth()
  @RequireReason()
  @ApiOkResponse({ type: CustomerDetailDto })
  @Put("customers/:id/credit-policy")
  updateCredit(@Param("id") id: string, @Body() dto: UpdateCreditPolicyDto) {
    return this.service.updateCredit(id, dto);
  }

  @RequirePermission("customers.credit.manage")
  @RequireFreshAuth()
  @RequireReason()
  @HttpCode(200)
  @ApiOkResponse({ type: CustomerDetailDto })
  @Post("customers/:id/block")
  block(@Param("id") id: string, @Body() dto: BlockCustomerDto) {
    return this.service.setBlock(id, dto);
  }
}
