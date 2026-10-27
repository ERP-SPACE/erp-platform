import {
  grnCreate,
  grnDetail,
  grnListItem,
  grnPost,
  grnUpdate,
  landedCostChargeItem,
  landedCostPreview,
  landedCostRequest,
  piCreate,
  piDetail,
  piListItem,
  piPost,
  piUpdate,
  poAction,
  poCreate,
  poDetail,
  poListItem,
  poUpdate,
  purchaseListQuery,
  purchaseReturnCreate,
  purchaseReturnDetail,
  purchaseReturnItem,
  purchaseReturnPost,
  purchaseReturnUpdate,
} from "@erp/contracts";
import { z } from "zod";
import { zodDto } from "../../common/dto.js";

export class PurchaseListQueryDto extends zodDto("PurchaseListQueryDto", purchaseListQuery) {}
export class VersionDto extends zodDto("VersionDto", poAction) {}

export class PoCreateDto extends zodDto("PoCreateDto", poCreate) {}
export class PoUpdateDto extends zodDto("PoUpdateDto", poUpdate) {}
export class PoListItemDto extends zodDto("PoListItemDto", poListItem) {}
export class PoDetailDto extends zodDto("PoDetailDto", poDetail) {}

export class GrnCreateDto extends zodDto("GrnCreateDto", grnCreate) {}
export class GrnUpdateDto extends zodDto("GrnUpdateDto", grnUpdate) {}
export class GrnPostDto extends zodDto("GrnPostDto", grnPost) {}
export class GrnListItemDto extends zodDto("GrnListItemDto", grnListItem) {}
export class GrnDetailDto extends zodDto("GrnDetailDto", grnDetail) {}

export class PiCreateDto extends zodDto("PiCreateDto", piCreate) {}
export class PiUpdateDto extends zodDto("PiUpdateDto", piUpdate) {}
export class PiPostDto extends zodDto("PiPostDto", piPost) {}
export class PiListItemDto extends zodDto("PiListItemDto", piListItem) {}
export class PiDetailDto extends zodDto("PiDetailDto", piDetail) {}

export class LandedCostRequestDto extends zodDto("LandedCostRequestDto", landedCostRequest) {}
export class LandedCostPreviewDto extends zodDto("LandedCostPreviewDto", landedCostPreview) {}
export class LandedCostChargeItemDto extends zodDto("LandedCostChargeItemDto", landedCostChargeItem) {}

export class PurchaseReturnCreateDto extends zodDto("PurchaseReturnCreateDto", purchaseReturnCreate) {}
export class PurchaseReturnUpdateDto extends zodDto("PurchaseReturnUpdateDto", purchaseReturnUpdate) {}
export class PurchaseReturnPostDto extends zodDto("PurchaseReturnPostDto", purchaseReturnPost) {}
export class PurchaseReturnItemDto extends zodDto("PurchaseReturnItemDto", purchaseReturnItem) {}
export class PurchaseReturnDetailDto extends zodDto("PurchaseReturnDetailDto", purchaseReturnDetail) {}

export class OkDto extends zodDto("OkDto", z.object({ ok: z.literal(true) })) {}
