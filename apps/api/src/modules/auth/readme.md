# Auth module

Owns corporate-email OTP records, external identity links, and local password
credentials. User creation and session-profile reads cross the Profile public
surface; runtime authorization remains permission-based.

## Startup-provisioned Superadmin

`ADMIN_USERNAME` and `ADMIN_PASSWORD` are the only Superadmin-specific settings.
`platform_superadmin_identity` is the immutable singleton identity marker and is
not a role or an authorization bypass. Production startup rejects a missing pair;
non-production environments may explicitly run without bootstrap provisioning.

Startup takes one transaction-level lock and commits account recovery, credential
change, marker binding, permission grants and audit together. A healthy restart is
a no-op: it does not change `session_version`, credential hash/timestamp, grants or
audit. Intentional exceptions are:

- password rotation updates the hash, increments `session_version` once and audits;
- account recovery without an active sanction restores `active`, increments
  `session_version` once and audits;
- missing, expired or revoked bootstrap grants are replaced and audited without a
  session-version change;
- newly added catalog permissions are materialized and audited without a
  session-version change.

On a genuinely new installation startup generates the account UUID once while
holding the bootstrap advisory lock, creates the account, and persists that UUID
in the singleton marker in the same transaction.

## One-time binding on an existing installation

For an installation that predates the marker, startup selects only the account
whose username exactly matches `ADMIN_USERNAME`, locks it, verifies the supplied
password, and verifies the immutable historical bootstrap evidence before making
any change. Evidence is the exact original 29 root permission keys with reason
`automatic bootstrap root access`, plus the three original Data grants with reason
`automatic bootstrap data workspace access`; every grant must be global, granted
by the same account, active, unexpired and never revoked. A count is insufficient.

```sql
select u.id, u.username,
       exists(select 1 from user_password_credentials c where c.user_id=u.id) as has_password,
       count(distinct g.permission) filter (
         where g.granted_by=u.id
           and g.reason='automatic bootstrap root access'
           and g.scope='{"kind":"global"}'::jsonb
           and g.revoked_at is null
           and (g.expires_at is null or g.expires_at>now())
       ) as active_bootstrap_permissions
from users u
left join permission_grants g on g.user_id=u.id
where u.username='<current ADMIN_USERNAME>'
group by u.id,u.username;
```

Missing, revoked, expired or ambiguous historical evidence fails before account,
credential, marker, grants or audit mutation. Permissions introduced after that
baseline are repaired only after a successful binding and receive current repair
provenance; they are never presented as historical grants. An arbitrary existing
user is never promoted.

A new account may be created only when the database has no
non-system users, password credentials or permission grants. After marker binding,
the marker is authoritative: changing `ADMIN_USERNAME` cannot transfer authority
or create another Superadmin. Login continues to use the account's current database
username.

On restart, the same `ADMIN_PASSWORD` is a no-op. A changed value is an explicit
password rotation: the credential is replaced atomically, `session_version` is
incremented, and all existing browser sessions become invalid. A failed startup
transaction preserves the old credential and sessions.
