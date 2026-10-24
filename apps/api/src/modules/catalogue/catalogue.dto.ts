import {
  categoryCreate,
  categoryItem,
  categoryUpdate,
  productCreate,
  productItem,
  productUpdate,
  qualityInput,
  qualityItem,
  qualityUpdate,
  skuBulkAdd,
  skuItem,
  skuUpdate,
} from "@erp/contracts";
import { z } from "zod";
import { zodDto } from "../../common/dto.js";

export class CategoryItemDto extends zodDto("CategoryItemDto", categoryItem) {}
export class CreateCategoryDto extends zodDto("CreateCategoryDto", categoryCreate) {}
export class UpdateCategoryDto extends zodDto("UpdateCategoryDto", categoryUpdate) {}
export class QualityItemDto extends zodDto("QualityItemDto", qualityItem) {}
export class CreateQualityDto extends zodDto("CreateQualityDto", qualityInput) {}
export class UpdateQualityDto extends zodDto("UpdateQualityDto", qualityUpdate) {}
export class ProductItemDto extends zodDto("ProductItemDto", productItem) {}
export class CreateProductDto extends zodDto("CreateProductDto", productCreate) {}
export class UpdateProductDto extends zodDto("UpdateProductDto", productUpdate) {}
export class AddSkusDto extends zodDto("AddSkusDto", skuBulkAdd) {}
export class SkuItemDto extends zodDto("SkuItemDto", skuItem) {}
export class UpdateSkuDto extends zodDto("UpdateSkuDto", skuUpdate) {}
export class ProductListQueryDto extends zodDto(
  "ProductListQueryDto",
  z.object({
    categoryId: z.string().optional(),
    qualityId: z.string().optional(),
    active: z.enum(["true", "false", "all"]).default("all"),
  }),
) {}
