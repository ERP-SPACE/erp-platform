import {
  listQuery,
  supplierInput,
  supplierItem,
  supplierUpdate,
  transporterInput,
  transporterItem,
  transporterUpdate,
} from "@erp/contracts";
import { zodDto } from "../../common/dto.js";

export class SupplierItemDto extends zodDto("SupplierItemDto", supplierItem) {}
export class CreateSupplierDto extends zodDto("CreateSupplierDto", supplierInput) {}
export class UpdateSupplierDto extends zodDto("UpdateSupplierDto", supplierUpdate) {}
export class TransporterItemDto extends zodDto("TransporterItemDto", transporterItem) {}
export class CreateTransporterDto extends zodDto("CreateTransporterDto", transporterInput) {}
export class UpdateTransporterDto extends zodDto("UpdateTransporterDto", transporterUpdate) {}
export class MasterListQueryDto extends zodDto("MasterListQueryDto", listQuery) {}
