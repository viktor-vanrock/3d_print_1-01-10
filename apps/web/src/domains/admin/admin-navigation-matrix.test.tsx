import { cleanup,render,screen } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";
import type { ReactNode } from "react";
import { AdminScreen } from "./adminscreen.tsx";
vi.mock("@platform/nav",()=>({AdministrationShell:({children}:{children:ReactNode})=><><h1>Администрирование</h1>{children}</>}));
vi.mock("@platform/overlay",()=>({useOverlay:()=>({modal:()=>({close:()=>undefined})})}));
const api=vi.hoisted(()=>({getAdminMe:vi.fn(),browseAdminUsers:vi.fn(),searchAdminUsers:vi.fn(),getAdminUser:vi.fn(),getAdminUserAccess:vi.fn(),getAdminUserSanctions:vi.fn(),getAdminPermissionCatalog:vi.fn(),previewPermissionChange:vi.fn(),executePermissionChange:vi.fn(),getAdminUserSessions:vi.fn(),previewAdminOperation:vi.fn(),executeAdminOperation:vi.fn(),getAdminAuditEvents:vi.fn(),createAdminAuditExport:vi.fn(),downloadAdminAuditExport:vi.fn()}));
vi.mock("./api.ts",()=>api);afterEach(()=>{cleanup();vi.clearAllMocks();});
const grant=(key:string)=>({key,scope:{kind:"global"},expires_at:null});
const props={user:{id:"actor",username:"admin",display_name:"Admin",avatar_url:null,handle_confirmed:true,role:"user" as const,capabilities:["admin.portal.access" as const]},section:"home" as const,onSectionChange:()=>undefined};
describe("Administration navigation authorization matrix",()=>{
  it("portal-only opens the shell without action sections",async()=>{api.getAdminMe.mockResolvedValue({user_id:"actor",permissions:[grant("admin.portal.access")]});render(<AdminScreen {...props}/>);expect(await screen.findByText("Администрирование")).toBeTruthy();expect(screen.getByText("Нет разрешения user.view_any")).toBeTruthy();expect(screen.queryByRole("heading",{name:"Аудит"})).toBeNull();});
  it("action-only cannot substitute for portal access",async()=>{api.getAdminMe.mockRejectedValue({status:403});render(<AdminScreen {...props}/>);expect(await screen.findByText("Нет доступа к административному пространству")).toBeTruthy();expect(api.browseAdminUsers).not.toHaveBeenCalled();});
  it("both portal and exact action expose only that section",async()=>{api.getAdminMe.mockResolvedValue({user_id:"actor",permissions:[grant("admin.portal.access"),grant("user.view_any")]});api.browseAdminUsers.mockResolvedValue({items:[],next_cursor:null});render(<AdminScreen {...props}/>);expect(await screen.findByRole("heading",{name:"Пользователи"})).toBeTruthy();expect(screen.queryByRole("heading",{name:"Состояние системы"})).toBeNull();});
});
