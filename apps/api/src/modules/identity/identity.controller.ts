import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { AllowWithoutTotp, RequireFreshAuth, RequirePermission } from "../../auth/decorators.js";
import { CreateUserDto, StepUpDto, UpdateRolePermissionsDto, UpdateUserDto } from "./identity.dto.js";
import { IdentityService } from "./identity.service.js";

@ApiTags("identity")
@Controller()
export class IdentityController {
  constructor(private readonly service: IdentityService) {}

  @AllowWithoutTotp()
  @Get("me")
  me() {
    return this.service.me();
  }

  @HttpCode(200)
  @Post("identity/step-up")
  stepUp(@Body() dto: StepUpDto, @Req() request: FastifyRequest) {
    return this.service.stepUp(dto.password, dto.code, request.raw.headers);
  }

  @RequirePermission("users.view")
  @Get("users")
  users() {
    return this.service.listUsers();
  }

  @RequirePermission("users.manage")
  @RequireFreshAuth()
  @Post("users")
  createUser(@Body() dto: CreateUserDto) {
    return this.service.createUser(dto);
  }

  @RequirePermission("users.manage")
  @RequireFreshAuth()
  @Patch("users/:id")
  updateUser(@Param("id") id: string, @Body() dto: UpdateUserDto) {
    return this.service.updateUser(id, dto);
  }

  @RequirePermission("users.view")
  @Get("roles")
  roles() {
    return this.service.listRoles();
  }

  @RequirePermission("users.view")
  @Get("permissions")
  permissions() {
    return this.service.permissionCatalogue();
  }

  @RequirePermission("roles.manage")
  @RequireFreshAuth()
  @Put("roles/:id/permissions")
  updateRolePermissions(@Param("id") id: string, @Body() dto: UpdateRolePermissionsDto) {
    return this.service.updateRolePermissions(id, dto.permissionCodes, dto.version);
  }
}
