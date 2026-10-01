import {describe,expect,it} from "vitest";
import openapi from "./openapi.v1.json";
describe("risk-focused Admin/Data authorization contract",()=>{
  it.each([["/v1/admin/me","get"],["/v1/admin/users","get"],["/v1/admin/audit/events","get"],["/data/materials","get"],["/research/printers","get"]] as const)("declares protected outcomes for %s %s",(path,method)=>{const operation=openapi.paths[path]?.[method];expect(operation).toBeDefined();expect(operation?.responses?.["401"]??operation?.responses?.["403"]).toBeDefined();});
  it("keeps sensitive success projections explicit and bounded",()=>{const schemas=JSON.stringify({user:openapi.components.schemas.AdminUserCardDto,audit:openapi.components.schemas.AdminAuditPageDto});expect(schemas).not.toMatch(/password_hash|identifier_hash|s3_key|raw_details|hostname|sql|configuration/i);expect(openapi.components.schemas.AdminAuditPageDto.properties.items.maxItems).toBe(100);});
});
