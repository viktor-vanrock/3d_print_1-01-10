import { useGuestLogin } from "@domains/access";
import { CommunitiesScreen, ThreadScreen } from "@domains/social";
import type { Section } from "@platform/nav";
import type { SessionUser } from "@shared/types";

interface RouteProps {
  readonly user: SessionUser | null;
  readonly section: Section;
  readonly onSectionChange: (section: Section) => void;
}

export function CommunitiesRouteScreen(props: RouteProps) {
  const onGuestLogin = useGuestLogin();
  return <CommunitiesScreen {...props} onGuestLogin={onGuestLogin} />;
}

export function ThreadRouteScreen(props: RouteProps & { readonly id: string }) {
  const onGuestLogin = useGuestLogin();
  return <ThreadScreen {...props} onGuestLogin={onGuestLogin} />;
}
