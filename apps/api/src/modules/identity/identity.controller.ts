import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { AllowWithoutTotp, RequireFreshAuth, RequirePermission } from "../../auth/decorators.js";
import {
  IdResponseDto,
  MeResponseDto,
  PermissionItemDto,
  RoleItemDto,
  StepUpResponseDto,
  UserItemDto,
} from "../../common/responses.js";
import { CreateUserDto, StepUpDto, UpdateRolePermissionsDto, UpdateUserDto } from "./identity.dto.js";
import { IdentityService } from "./identity.service.js";

@ApiTags("identity")
@Controller()
export class IdentityController {
  constructor(private readonly service: IdentityService) {}

  @AllowWithoutTotp()
  @ApiOkResponse({ type: MeResponseDto })
  @Get("me")
  me() {
    return this.service.me();
  }

  @HttpCode(200)
  @ApiOkResponse({ type: StepUpResponseDto })
  @Post("identity/step-up")
  stepUp(@Body() dto: StepUpDto, @Req() request: FastifyRequest) {
    return this.service.stepUp(dto.password, dto.code, request.raw.headers);
  }

  @RequirePermission("users.view")
  @ApiOkResponse({ type: UserItemDto, isArray: true })
  @Get("users")
  users() {
    return this.service.listUsers();
  }

  @RequirePermission("users.manage")
  @RequireFreshAuth()
  @ApiCreatedResponse({ type: IdResponseDto })
  @Post("users")
  createUser(@Body() dto: CreateUserDto) {
    return this.service.createUser(dto);
  }

  @RequirePermission("users.manage")
  @RequireFreshAuth()
  @ApiOkResponse({ type: IdResponseDto })
  @Patch("users/:id")
  updateUser(@Param("id") id: string, @Body() dto: UpdateUserDto) {
    return this.service.updateUser(id, dto);
  }

  @RequirePermission("users.view")
  @ApiOkResponse({ type: RoleItemDto, isArray: true })
  @Get("roles")
  roles() {
    return this.service.listRoles();
  }

  @RequirePermission("users.view")
  @ApiOkResponse({ type: PermissionItemDto, isArray: true })
  @Get("permissions")
  permissions() {
    return this.service.permissionCatalogue();
  }

  @RequirePermission("roles.manage")
  @RequireFreshAuth()
  @ApiOkResponse({ type: IdResponseDto })
  @Put("roles/:id/permissions")
  updateRolePermissions(@Param("id") id: string, @Body() dto: UpdateRolePermissionsDto) {
    return this.service.updateRolePermissions(id, dto.permissionCodes, dto.version);
  }
}
