import { z } from "zod";
import { zodDto } from "../../common/dto.js";

export class UpdateSettingDto extends zodDto(
  "UpdateSettingDto",
  z.object({
    value: z.unknown(),
    /** Version the client last saw; 0 when the key has never been saved. */
    version: z.number().int().min(0),
  }),
) {}

const address = z.object({
  line1: z.string().trim().min(1).max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1).max(60),
  state: z.string().trim().min(1).max(60),
  pincode: z.string().regex(/^\d{6}$/, "PIN code must be 6 digits"),
});

const bank = z.object({
  bankName: z.string().trim().min(1).max(80),
  accountName: z.string().trim().min(1).max(120),
  accountNumber: z.string().regex(/^\d{6,20}$/, "Account number must be 6–20 digits"),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC must look like ABCD0123456"),
  branch: z.string().trim().max(80).optional(),
});

export class UpdateCompanyDto extends zodDto(
  "UpdateCompanyDto",
  z.object({
    legalName: z.string().trim().min(2).max(160),
    tradeName: z.string().trim().max(160).nullable(),
    gstin: z.string().trim().toUpperCase().length(15).nullable(),
    stateCode: z.string().regex(/^\d{2}$/),
    pan: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN must look like ABCDE1234F")
      .nullable(),
    address,
    bank: bank.nullable(),
    email: z.email().nullable(),
    phone: z.string().trim().max(20).nullable(),
    signatoryName: z.string().trim().max(120).nullable(),
    version: z.number().int().positive(),
  }),
) {}
