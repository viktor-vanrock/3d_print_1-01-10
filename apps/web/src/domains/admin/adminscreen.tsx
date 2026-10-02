import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AdministrationShell, type Section } from "@platform/nav";
import { useOverlay } from "@platform/overlay";
import type { SessionUser } from "@shared/types";
import {
  browseAdminUsers,
  executeAccessConfiguration,
  getAdminMe,
  getAdminPermissionCatalog,
  getAdminUser,
  getAdminUserAccess,
  getAdminUserSessions,
  getAdminAuditEvents,
  createAdminAuditExport,
  downloadAdminAuditExport,
  previewAdminOperation,
  executeAdminOperation,
  previewAccessConfiguration,
  searchAdminUsers,
  type AdminPermission,
  type AdminUser,
  type AdminUserSummary,
  type AdminUserAccess,
  type PermissionChangePreview,
  type AdminBrowserSessions,
  type AdminOperationAction,
  type AdminAuditPage,
  type ConfigurableRole,
} from "./api.ts";
import { permissionLabel } from "./permissionlabels.ts";
import "./adminscreen.css";

type ShellState = { readonly kind: "loading" } | { readonly kind: "denied" } | { readonly kind: "ready"; readonly permissions: ReadonlySet<AdminPermission> };
type UserState = { readonly kind: "loading" } | { readonly kind: "failure" } | { readonly kind: "ready"; readonly user: AdminUser; readonly access: AdminUserAccess | null };
type PendingOperation = { readonly action: AdminOperationAction; readonly title: string; readonly warning: string; readonly confirmLabel: string; readonly resourceId?: string };

function permissionList(values: readonly { readonly permission: string }[]): string {
  return values.length === 0 ? "ничего" : values.map((value) => value.permission).join(", ");
}

const ROLE_LABELS = { user: "Пользователь", admin: "Администратор", superadmin: "Суперадминистратор" } as const;
const STATE_LABELS = { active: "Активен", restricted: "Ограничен", suspended: "Приостановлен", blocked: "Заблокирован", closed: "Закрыт" } as const;
const AUDIT_LABELS: Readonly<Record<string, string>> = {
  "admin.users.browsed": "Просмотрен список пользователей", "admin.users.searched": "Выполнен поиск пользователей",
  "admin.user.viewed": "Открыта карточка пользователя", "admin.user_access.viewed": "Просмотрены разрешения пользователя",
  "admin.user.sessions_viewed": "Просмотрены браузерные сессии", "admin.audit.browsed": "Просмотрен журнал действий",
  "material.created": "Создан материал", "material.updated": "Изменён материал", "material.published": "Материал опубликован",
  "news.created": "Создана новость", "news.updated": "Изменена новость", "news.published": "Новость опубликована", "news.hidden": "Новость скрыта",
};
const ACCESS_EDITOR_PERMISSIONS: readonly AdminPermission[]=["user.grant_permission","user.revoke_permission"];
const PERMISSION_CATEGORY_LABELS:Readonly<Record<string,string>>={admin:"Администрирование",user:"Пользователи",audit:"Журнал действий",materials:"Материалы",printers:"Принтеры",news:"Новости"};
function permissionCategory(permission:AdminPermission):string{if(permission.startsWith("catalog.")&&!permission.includes("printer"))return "materials";if(permission==="research.manage_printers"||permission==="catalog.review_printer_reports")return "printers";if(permission==="feed.manage_news")return "news";return permission.split(".",1)[0]??"other";}
function groupPermissions(values:readonly AdminPermission[]):readonly (readonly [string,readonly AdminPermission[]])[]{const groups=new Map<string,AdminPermission[]>();for(const permission of values){const category=permissionCategory(permission);const items=groups.get(category)??[];items.push(permission);groups.set(category,items);}return [...groups.entries()];}

function AccessEditor({access,targetId,catalog,readOnly,isLoadError,catalogLoaded,onClose,onSaved}:{readonly access:AdminUserAccess;readonly targetId:string;readonly catalog:readonly AdminPermission[];readonly readOnly:boolean;readonly isLoadError:boolean;readonly catalogLoaded:boolean;readonly onClose:()=>void;readonly onSaved:()=>Promise<void>}){
  const [selected,setSelected]=useState<ReadonlySet<AdminPermission>>(()=>new Set(access.grants.filter((grant)=>grant.permission!=="feed.news_editor"&&(readOnly||catalog.includes(grant.permission))).map((grant)=>grant.permission)));
const role: ConfigurableRole = access.admin_preset.permissions.every((permission)=>selected.has(permission)) ? "admin" : "user";
const applyRole=(value:ConfigurableRole)=>{setSelected((current)=>{const next=new Set(current);for(const permission of access.admin_preset.permissions){if(value==="admin")next.add(permission);else next.delete(permission);}return next;});setPreview(null);};
const [preview,setPreview]=useState<PermissionChangePreview|null>(null);const [error,setError]=useState<string|null>(null);const [currentPassword,setCurrentPassword]=useState("");
  const groups=readOnly?groupPermissions([...new Set(access.grants.map((grant)=>grant.permission))]):groupPermissions(catalog);
const toggle=(permission:AdminPermission)=>setSelected((current)=>{const next=new Set(current);if(next.has(permission))next.delete(permission);else next.add(permission);setPreview(null);return next;});
  const reason="Изменение роли и разрешений через интерфейс администрирования";
  const prepare=async()=>{if(isLoadError||!catalogLoaded)return;try{setError(null);setPreview(await previewAccessConfiguration(targetId,{permissions:[...selected],reason}));}catch{setError("Не удалось подготовить изменение доступа.");}};
const save=async()=>{if(preview===null||isLoadError||!catalogLoaded||!currentPassword)return;try{await executeAccessConfiguration(targetId,{permissions:[...selected],reason,confirmation_id:preview.confirmation_id,currentPassword});await onSaved();}catch{setError("Доступ не изменён: состояние, пароль или подтверждение неверны.");}};
  return <div className="adminAccessEditor">
    {isLoadError&&<p role="alert">Не удалось загрузить каталог разрешений. Изменение доступа заблокировано.</p>}{!readOnly&&<label>Текущий пароль администратора<input type="password" value={currentPassword} onChange={(event)=>setCurrentPassword(event.target.value)}/></label>}
    {readOnly?<div className="adminReadonlyRole"><strong>Суперадминистратор</strong><p>Роль и разрешения управляются при запуске платформы и недоступны для изменения здесь.</p></div>:<fieldset><legend>Роль</legend><label><input type="radio" name="admin-role" checked={role==="user"} onChange={()=>{applyRole("user");}}/>Пользователь</label><label><input type="radio" name="admin-role" checked={role==="admin"} onChange={()=>{applyRole("admin");}}/>Администратор</label></fieldset>}
    <div className="adminPermissionPicker"><h3>Разрешения</h3>{groups.map(([category,permissions])=><section key={category}><h4>{PERMISSION_CATEGORY_LABELS[category]??category}</h4>{permissions.map((permission)=>{const included=readOnly;const checked=included||selected.has(permission);return <label key={permission}><input type="checkbox" checked={checked} disabled={included} onChange={()=>toggle(permission)}/><span><strong>{permissionLabel(permission)}</strong><small>{permission}{readOnly?" · Системное разрешение":included?" · Входит в роль":""}</small></span></label>;})}</section>)}</div>
{readOnly||preview===null?null:<><div className="adminEffects"><p>Будет добавлено: {permissionList(preview.effects.added)}</p><p>Будет отозвано: {permissionList(preview.effects.revoked)}</p></div></>}
    {error===null?null:<p role="alert">{error}</p>}
<footer><button type="button" onClick={onClose}>{readOnly?"Закрыть":"Отмена"}</button>{readOnly?null:preview===null?<button type="button" disabled={isLoadError||!catalogLoaded} onClick={()=>void prepare()}>Сохранить</button>:<button type="button" disabled={isLoadError||!catalogLoaded||!currentPassword} onClick={()=>void save()}>Подтвердить и сохранить</button>}</footer>
  </div>;
}

export function AdminScreen({ user, section, onSectionChange, targetId, view = "users" }: { readonly user: SessionUser; readonly section: Section; readonly onSectionChange: (section: Section) => void; readonly targetId?: string; readonly view?: "users" | "audit" }) {
  const overlay=useOverlay();
  const [shell, setShell] = useState<ShellState>({ kind: "loading" });
  const [users, setUsers] = useState<readonly AdminUserSummary[]>([]);
  const [query, setQuery] = useState("");
  const [userState, setUserState] = useState<UserState>({ kind: "loading" });
  const [catalog, setCatalog] = useState<readonly AdminPermission[]>([]);
  const [isLoadError, setIsLoadError] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [password, setPassword] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AdminBrowserSessions | null>(null);
  const [operation, setOperation] = useState<PendingOperation | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [auditPage, setAuditPage] = useState<AdminAuditPage | null>(null);
  const [auditExportStatus, setAuditExportStatus] = useState<string | null>(null);
  const [accountExportStatus, setAccountExportStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAdminMe().then((me) => {
      if (active) setShell({ kind: "ready", permissions: new Set(me.permissions.map((permission) => permission.key)) });
    }).catch(() => {
      if (active) setShell({ kind: "denied" });
    });
    return () => { active = false; };
  }, []);

  const canViewUsers = shell.kind === "ready" && shell.permissions.has("user.view_any");
  const canViewAudit = shell.kind === "ready" && shell.permissions.has("audit.view_log");
  useEffect(() => {
    if (!canViewAudit || (view !== "audit" && targetId === undefined)) return;
    let active = true;
    void getAdminAuditEvents({ targetId }).then((page) => { if (active) setAuditPage(page); }).catch(() => { if (active) setAuditPage(null); });
    return () => { active = false; };
  }, [canViewAudit, targetId, view]);

  async function loadMoreAudit(): Promise<void> {
    if (auditPage?.next_cursor === null || auditPage?.next_cursor === undefined) return;
    const next = await getAdminAuditEvents({ cursor: auditPage.next_cursor, targetId });
    setAuditPage({ ...next, items: [...auditPage.items, ...next.items] });
  }
  async function exportAudit(): Promise<void> {
    const to = new Date(); const from = new Date(to.getTime() - 31 * 24 * 60 * 60 * 1000);
    try { const created = await createAdminAuditExport({ from: from.toISOString(), to: to.toISOString() }); await downloadAdminAuditExport(created.id); setAuditExportStatus(created.truncated ? "Сегмент скачан; доступно продолжение." : "Экспорт скачан."); }
    catch { setAuditExportStatus("Экспорт не выполнен."); }
  }
  useEffect(() => {
    if (!canViewUsers || targetId !== undefined || view !== "users") return;
    let active = true;
    void browseAdminUsers().then((page) => { if (active) setUsers(page.items); }).catch(() => { if (active) setUsers([]); });
    return () => { active = false; };
  }, [canViewUsers, targetId, view]);

  const reloadUser = useCallback(async (): Promise<void> => {
    if (targetId === undefined) return;
    setUserState({ kind: "loading" });
    try {
      const user = await getAdminUser(targetId);
      const access = shell.kind === "ready" && shell.permissions.has("user.view_permissions") ? await getAdminUserAccess(targetId) : null;
      setUserState({ kind: "ready", user, access });
    } catch {
      setUserState({ kind: "failure" });
    }
  }, [shell, targetId]);

  useEffect(() => {
    if (canViewUsers && targetId !== undefined) void reloadUser();
  }, [canViewUsers, reloadUser, targetId]);

  useEffect(() => {
    if (!canViewUsers || targetId === undefined || shell.kind !== "ready") return;
    let active = true;
    setSessions(null);
    if (shell.permissions.has("user.view_sessions")) void getAdminUserSessions(targetId).then((value) => { if (active) setSessions(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [canViewUsers, shell, targetId]);

  const canViewCatalog = shell.kind === "ready" && shell.permissions.has("admin.view_permission_catalog");
  const canConfigureAccess = shell.kind === "ready" && ACCESS_EDITOR_PERMISSIONS.every((permission)=>shell.permissions.has(permission));
  useEffect(() => {
    if (!canViewCatalog || !canConfigureAccess) return;
    let active = true;
    void getAdminPermissionCatalog().then((result) => {
      if (active) { setCatalog(result.items.filter((item) => item.admin_assignable).map((item) => item.key)); setIsLoadError(false); setCatalogLoaded(true); }
    }).catch(() => { if (active) { setCatalog([]); setIsLoadError(true); setCatalogLoaded(true); } });
    return () => { active = false; };
  }, [canConfigureAccess, canViewCatalog]);

  const actionPermissions = useMemo(() => shell.kind === "ready" ? shell.permissions : new Set<AdminPermission>(), [shell]);

  async function search(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!query.trim()) return;
    try {
      setUsers((await searchAdminUsers(query.trim())).items);
    } catch {
      setUsers([]);
    }
  }

  function beginOperation(value: PendingOperation): void {
    setOperation(value); setPassword(""); setOperationBusy(false); setMutationError(null);
  }
  function openAccessEditor(access:AdminUserAccess,readOnly:boolean):void{if(targetId===undefined)return;let handle:ReturnType<typeof overlay.modal>|null=null;handle=overlay.modal({size:"wide",title:"Роль и разрешения",content:<AccessEditor access={access} targetId={targetId} catalog={catalog} readOnly={readOnly} isLoadError={isLoadError} catalogLoaded={catalogLoaded} onClose={()=>handle?.close()} onSaved={async()=>{await reloadUser();handle?.close();}}/>});}
  async function confirmOperation(): Promise<void> {
    if (operation === null || targetId === undefined || password === "") return;
    setOperationBusy(true);
    setMutationError(null);
    try {
      const preview = await previewAdminOperation(targetId, operation.action, operation.resourceId);
      await executeAdminOperation(targetId, operation.action, { password, confirmation_id: preview.confirmation_id }, operation.resourceId);
      setPassword(""); await reloadUser();
      if (shell.kind === "ready" && shell.permissions.has("user.view_sessions")) setSessions(await getAdminUserSessions(targetId));
      setOperation(null);
    } catch { setMutationError("Операция отклонена: проверьте пароль и повторите попытку."); }
    finally { setOperationBusy(false); }
  }

  async function exportAccountMetadata(): Promise<void> {
    if (targetId === undefined) return;
    setAccountExportStatus("Подготавливаем экспорт…");
    try {
      const preview = await previewAdminOperation(targetId, "export_account");
      const result = await executeAdminOperation(targetId, "export_account", { confirmation_id: preview.confirmation_id });
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `admin-user-${targetId}-metadata.json`;
      link.click();
      URL.revokeObjectURL(url);
      setAccountExportStatus("Экспорт скачан.");
    } catch {
      setAccountExportStatus("Не удалось экспортировать метаданные.");
    }
  }


  if (shell.kind === "loading") return <AdministrationShell user={user} section={section} onSectionChange={onSectionChange} permissions={new Set()}><div className="adminWorkspace"><section className="adminPanel"><p>Проверяем доступ…</p></section></div></AdministrationShell>;
  if (shell.kind === "denied") return <AdministrationShell user={user} section={section} onSectionChange={onSectionChange} permissions={new Set()}><div className="adminWorkspace"><section className="adminPanel"><h2>Нет доступа к административному пространству</h2></section></div></AdministrationShell>;
  const editableAccess=userState.kind==="ready"?userState.access:null;
  const superadminReadOnly=userState.kind==="ready"&&userState.user.role==="superadmin";

  return (
    <AdministrationShell user={user} section={section} onSectionChange={onSectionChange} permissions={shell.permissions} trail={targetId === undefined ? undefined : "Карточка пользователя"}>
    <div className="adminWorkspace">
      {view === "audit" && canViewAudit ? <section className="adminPanel adminAuditPanel">
        <h1>{targetId === undefined ? "Журнал действий" : "История действий"}</h1>
        {auditPage === null ? <p>Загрузка…</p> : <>
          <p>События с {new Date(auditPage.range.from).toLocaleDateString("ru-RU")} по {new Date(auditPage.range.to).toLocaleDateString("ru-RU")}. Чувствительные данные скрыты.</p>
          <ul className="adminAuditList">{auditPage.items.map((event) => <li key={event.id}><strong>{AUDIT_LABELS[event.action] ?? "Административное действие"}</strong><small>{new Date(event.created_at).toLocaleString("ru-RU")} · {event.action}</small></li>)}</ul>
          {auditPage.next_cursor === null ? null : <button type="button" onClick={() => void loadMoreAudit()}>Показать ещё события</button>}
          {targetId === undefined && shell.permissions.has("audit.export") ? <button type="button" onClick={() => void exportAudit()}>Экспортировать журнал</button> : null}
          {auditExportStatus === null ? null : <p role="status">{auditExportStatus}</p>}
        </>}
      </section> : null}
      {view === "audit" ? (!canViewAudit ? <section className="adminPanel"><p>Нет доступа к журналу действий</p></section> : null) : !canViewUsers ? <section className="adminPanel"><p>Нет разрешения user.view_any</p></section> : targetId === undefined ? (
        <section id="admin-users" className="adminPanel">
          <h1>Пользователи</h1>
          <form onSubmit={(event) => void search(event)} className="adminSearch">
            <label>UUID или имя<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <button type="submit">Найти</button>
          </form>
          <ul className="adminUserList">{users.map((user) => <li key={user.id}><a href={`/admin/users/${encodeURIComponent(user.id)}`}><span><strong>{user.display_name ?? user.username}</strong><small>@{user.username}</small></span><span className="adminUserBadges"><span>{ROLE_LABELS[user.role]}</span><span>{STATE_LABELS[user.account_state]}</span></span></a></li>)}</ul>
        </section>
      ) : userState.kind === "loading" ? <p>Загрузка карточки…</p> : userState.kind === "failure" ? <p>Карточка доступа недоступна</p> : (
        <>
          <section className="adminPanel">
            <a href="/admin">← Пользователи</a>
            <h1>{userState.user.display_name ?? userState.user.username}</h1>
            <div className="adminUserBadges"><span>{ROLE_LABELS[userState.user.role]}</span><span>{STATE_LABELS[userState.user.account_state]}</span></div>
          </section>
          {userState.access === null ? <section className="adminPanel"><h2>Права</h2><p>Данные скрыты: нет user.view_permissions</p></section> : <>
          <section className="adminPanel">
            <h2>Роль и разрешения</h2>
            <p>{userState.user.role === "superadmin" ? "Системная роль защищена и управляется при запуске платформы." : userState.user.role === "admin" ? "Выдан набор разрешений администратора." : "Разрешения настроены индивидуально."}</p>
            <p>Активных разрешений: {userState.access.grants.length}</p>
            {editableAccess!==null&&(superadminReadOnly||(canConfigureAccess&&canViewCatalog))?<button type="button" onClick={()=>openAccessEditor(editableAccess,superadminReadOnly)}>{superadminReadOnly?"Просмотреть разрешения":"Настроить доступ"}</button>:null}
          </section>
          </>}
          {actionPermissions.has("user.view_sessions") ? <section className="adminPanel"><h2>Активные сессии</h2>{sessions === null ? <p>Загрузка…</p> : sessions.items.length === 0 ? <p>Сессий нет.</p> : <ul className="adminSessionList">{sessions.items.map((item) => <li key={item.id}><span><strong>{item.revoked_at === null ? "Активная сессия" : "Завершённая сессия"}</strong><small>Создана {new Date(item.created_at).toLocaleString("ru-RU")}</small></span>{item.revoked_at === null && actionPermissions.has("user.manage_sessions") ? <button type="button" onClick={() => beginOperation({ action: "revoke_session", title: "Завершить сессию", warning: "Эта сессия потеряет доступ на следующем запросе.", confirmLabel: "Да, завершить сессию", resourceId: item.id })}>Завершить</button> : null}</li>)}</ul>}</section> : null}
          <section className="adminPanel adminActions"><h2>Управление аккаунтом</h2>
            {userState.user.account_state === "active" && actionPermissions.has("user.suspend") ? <button type="button" onClick={() => beginOperation({ action: "suspend_account", title: "Приостановить аккаунт", warning: "Все сессии и API-ключи будут немедленно отозваны.", confirmLabel: "Да, приостановить" })}>Приостановить</button> : null}
            {userState.user.account_state !== "closed" && userState.user.account_state !== "blocked" && actionPermissions.has("user.block") ? <button type="button" onClick={() => beginOperation({ action: "block_account", title: "Заблокировать аккаунт", warning: "Доступ и активные средства авторизации будут немедленно отозваны.", confirmLabel: "Да, заблокировать" })}>Заблокировать</button> : null}
            {(userState.user.account_state === "suspended" || userState.user.account_state === "blocked") && actionPermissions.has("user.restore") ? <button type="button" onClick={() => beginOperation({ action: "restore_account", title: "Восстановить аккаунт", warning: "Активное ограничение модерации сохранится. Отозванные сессии и ключи не восстанавливаются.", confirmLabel: "Да, восстановить" })}>Восстановить</button> : null}
            {actionPermissions.has("user.export") ? <button type="button" onClick={() => void exportAccountMetadata()}>Экспортировать метаданные</button> : null}
            {accountExportStatus === null ? null : <p role="status">{accountExportStatus}</p>}
          </section>
          {userState.user.account_state !== "closed" && actionPermissions.has("user.delete") ? <section className="adminPanel adminDangerZone"><h2>Закрытие аккаунта</h2><p>После закрытия пользователь больше не сможет войти. Восстановить аккаунт будет невозможно. Контент, журнал действий и платёжные записи сохранятся.</p><button className="danger" type="button" onClick={() => beginOperation({ action: "delete_account", title: "Необратимо закрыть аккаунт", warning: "Восстановление невозможно. Контент, аудит и платёжные записи сохранятся.", confirmLabel: "Да, закрыть аккаунт" })}>Закрыть аккаунт</button></section> : null}
          {canViewAudit?<section className="adminPanel adminAuditPanel"><h2>Административная история пользователя</h2>{auditPage===null?<p>Загрузка…</p>:<><p>Показаны административные операции, в которых этот пользователь был объектом действия. Чувствительные данные скрыты.</p><ul className="adminAuditList">{auditPage.items.map((event)=><li key={event.id}><strong>{AUDIT_LABELS[event.action]??"Административное действие"}</strong><small>{new Date(event.created_at).toLocaleString("ru-RU")} · {event.action}</small></li>)}</ul>{auditPage.next_cursor===null?null:<button type="button" onClick={()=>void loadMoreAudit()}>Показать ещё события</button>}</>}</section>:null}
        </>
      )}
      {operation !== null ? <section className="adminConfirm" role="dialog" aria-label={operation.title}>
        <h2>{operation.title}</h2><p role="alert">{operation.warning}</p>
        <label>Пароль Superadmin<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="danger" type="button" disabled={password === "" || operationBusy} onClick={() => void confirmOperation()}>{operationBusy ? "Выполняем…" : operation.confirmLabel}</button>
        {mutationError ? <p role="alert">{mutationError}</p> : null}
        <button type="button" disabled={operationBusy} onClick={() => setOperation(null)}>Закрыть</button>
      </section> : null}
    </div>
    </AdministrationShell>
  );
}
