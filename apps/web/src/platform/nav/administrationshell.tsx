import type { ReactNode } from "react";
import type { SessionUser } from "@shared/types";
import { AuroraBackground } from "@shared/ui";
import { HomeHeader } from "./homeheader.tsx";
import type { Section } from "./types.ts";
import "./administrationshell.css";

export function AdministrationShell({ user, section, onSectionChange, permissions, trail, children }: {
  readonly user: SessionUser;
  readonly section: Section;
  readonly onSectionChange: (section: Section) => void;
  readonly permissions: ReadonlySet<string>;
  readonly trail?: string;
  readonly children: ReactNode;
}) {
  return <div className="home administrationShell">
    <AuroraBackground />
    <HomeHeader user={user} printers={[]} section={section} activeSection={null} onSectionChange={onSectionChange} mode="full" />
    <main className="administrationShellContent">
      <nav className="administrationBreadcrumbs" aria-label="Хлебные крошки">
        <a href={`/u/${encodeURIComponent(user.username)}?tab=data`}>Профиль</a><span aria-hidden="true">/</span>
        <a href="/admin" aria-current={trail === undefined ? "page" : undefined}>Администрирование</a>
        {trail === undefined ? null : <><span aria-hidden="true">/</span><span aria-current="page">{trail}</span></>}
      </nav>
      <div className="administrationTitle"><div><span>УПРАВЛЕНИЕ ПЛАТФОРМОЙ</span><h1>Администрирование</h1></div>{permissions.has("audit.view_log") ? <a className="administrationAuditLink" href="/admin/audit">Журнал действий</a> : null}</div>
      <div className="administrationShellBody">{children}</div>
    </main>
  </div>;
}
