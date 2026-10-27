import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../auth/decorators.js";
import {
  AddSkusDto,
  CategoryItemDto,
  CreateCategoryDto,
  CreateProductDto,
  CreateQualityDto,
  ProductItemDto,
  ProductListQueryDto,
  QualityItemDto,
  SkuItemDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateQualityDto,
  UpdateSkuDto,
} from "./catalogue.dto.js";
import { CatalogueService } from "./catalogue.service.js";

@ApiTags("catalogue")
@Controller("catalogue")
export class CatalogueController {
  constructor(private readonly service: CatalogueService) {}

  @RequirePermission("catalogue.view")
  @ApiOkResponse({ type: CategoryItemDto, isArray: true })
  @Get("categories")
  categories() {
    return this.service.listCategories();
  }

  @RequirePermission("catalogue.manage")
  @ApiCreatedResponse({ type: CategoryItemDto })
  @Post("categories")
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.service.createCategory(dto);
  }

  @RequirePermission("catalogue.manage")
  @ApiOkResponse({ type: CategoryItemDto })
  @Patch("categories/:id")
  updateCategory(@Param("id") id: string, @Body() dto: UpdateCategoryDto) {
    return this.service.updateCategory(id, dto);
  }

  @RequirePermission("catalogue.view")
  @ApiOkResponse({ type: QualityItemDto, isArray: true })
  @Get("qualities")
  qualities() {
    return this.service.listQualities();
  }

  @RequirePermission("catalogue.manage")
  @ApiCreatedResponse({ type: QualityItemDto })
  @Post("qualities")
  createQuality(@Body() dto: CreateQualityDto) {
    return this.service.createQuality(dto);
  }

  @RequirePermission("catalogue.manage")
  @ApiOkResponse({ type: QualityItemDto })
  @Patch("qualities/:id")
  updateQuality(@Param("id") id: string, @Body() dto: UpdateQualityDto) {
    return this.service.updateQuality(id, dto);
  }

  @RequirePermission("catalogue.view")
  @ApiOkResponse({ type: ProductItemDto, isArray: true })
  @Get("products")
  products(@Query() query: ProductListQueryDto) {
    return this.service.listProducts(query);
  }

  @RequirePermission("catalogue.view")
  @ApiOkResponse({ type: ProductItemDto })
  @Get("products/:id")
  product(@Param("id") id: string) {
    return this.service.getProduct(id);
  }

  @RequirePermission("catalogue.manage")
  @ApiCreatedResponse({ type: ProductItemDto })
  @Post("products")
  createProduct(@Body() dto: CreateProductDto) {
    return this.service.createProduct(dto);
  }

  @RequirePermission("catalogue.manage")
  @ApiOkResponse({ type: ProductItemDto })
  @Patch("products/:id")
  updateProduct(@Param("id") id: string, @Body() dto: UpdateProductDto) {
    return this.service.updateProduct(id, dto);
  }

  @RequirePermission("catalogue.manage")
  @ApiCreatedResponse({ type: ProductItemDto })
  @Post("products/:id/skus")
  addSkus(@Param("id") id: string, @Body() dto: AddSkusDto) {
    return this.service.addSkus(id, dto);
  }

  @RequirePermission("catalogue.manage")
  @ApiOkResponse({ type: SkuItemDto })
  @Patch("skus/:id")
  updateSku(@Param("id") id: string, @Body() dto: UpdateSkuDto) {
    return this.service.updateSku(id, dto);
  }
}
