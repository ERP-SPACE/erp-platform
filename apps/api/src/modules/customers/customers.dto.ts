import {
  blockCustomerInput,
  creditPolicyItem,
  creditPolicyUpdate,
  customerCreate,
  customerDefaults,
  customerDetail,
  customerGroupItem,
  customerListItem,
  customerListQuery,
  customerUpdate,
} from "@erp/contracts";
import { z } from "zod";
import { zodDto } from "../../common/dto.js";

export class CustomerListItemDto extends zodDto("CustomerListItemDto", customerListItem) {}
export class CustomerDetailDto extends zodDto("CustomerDetailDto", customerDetail) {}
export class CustomerListQueryDto extends zodDto("CustomerListQueryDto", customerListQuery) {}
export class CreateCustomerDto extends zodDto("CreateCustomerDto", customerCreate) {}
export class UpdateCustomerDto extends zodDto("UpdateCustomerDto", customerUpdate) {}
export class CustomerGroupItemDto extends zodDto("CustomerGroupItemDto", customerGroupItem) {}
export class CustomerDefaultsDto extends zodDto("CustomerDefaultsDto", customerDefaults) {}
export class CustomerDefaultsQueryDto extends zodDto(
  "CustomerDefaultsQueryDto",
  z.object({ salesmanId: z.string().optional() }),
) {}
export class CreditPolicyItemDto extends zodDto("CreditPolicyItemDto", creditPolicyItem) {}
export class UpdateCreditPolicyDto extends zodDto("UpdateCreditPolicyDto", creditPolicyUpdate) {}
export class BlockCustomerDto extends zodDto("BlockCustomerDto", blockCustomerInput) {}
