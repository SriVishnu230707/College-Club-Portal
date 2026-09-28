# Phase 1 — Authentication and access requirements

**Project:** College Club Portal

**Status:** Draft for review

**Scope:** Define roles, access rules, account rules, and session behavior before implementing authentication in Node.js and Express.

## 1. Roles

| Access level | Meaning | Account record | Authentication |
| --- | --- | --- | --- |
| Visitor | Anyone browsing without a valid login | None | None |
| Member | A registered student | User with `role: member` | Valid access token |
| Admin | A trusted club manager | User with `role: admin` | Valid access token |

Visitor is an access level rather than a stored database role. Public registration always creates a member. A client-supplied `role` field must never grant admin access. Admin assignment requires a controlled administrative process.

## 2. Access matrix

| Action | Visitor | Member | Admin |
| --- | :---: | :---: | :---: |
| View public club information | Yes | Yes | Yes |
| View public event information | Yes | Yes | Yes |
| Register an account | Yes | — | — |
| Log in | Yes | — | — |
| View and edit own profile | No | Yes | Yes |
| Join or leave a club | No | Yes | Yes |
| Register for an event | No | Yes | Yes |
| Create or edit club information | No | No | Yes |
| Create or edit events | No | No | Yes |
| View and manage members | No | No | Yes |
| Assign or remove admin role | No | No | Controlled admin process |

The server enforces these rules on every protected request. Hiding a button in the interface is not authorization. A member can modify only their own profile and registrations unless an explicit admin permission applies. Admin operations should use the user's current database role so removing admin access takes effect without waiting for an access token to expire.

## 3. Registration and accounts

- Required registration fields: name, email address, and password.
- Normalize email for comparison and require one account per normalized email.
- Validate inputs on the server. Store a salted password hash, never the original password.
- Registration assigns `member` regardless of any role value supplied by the client.
- Return a clear duplicate-email error. Do not expose password hashes in API responses.
- **Decision needed:** Is registration open to any email or limited to college addresses? If limited, define the accepted domains and whether email ownership must be verified before member actions are allowed.
- **Decision needed:** Define the password policy and account recovery process before launch.

## 4. Login and session behavior

1. A member or admin submits email and password.
2. The server verifies the credentials and issues an access token and a refresh token.
3. The client sends the access token with protected requests.
4. When the access token expires, the client exchanges its refresh token for a new token pair. The previous refresh token becomes unusable.
5. Logout revokes the current refresh session. The client discards both tokens.
6. If refresh fails, the client returns to the login screen.

**Proposed initial lifetimes:** 15 minutes for an access token and 7 days for a refresh token. These are project settings to confirm before implementation. Access tokens already issued may remain valid until expiry after logout; server-side role checks still use the current role.

**Decision needed:** Should logout end only the current device's session, or all of the user's sessions? The proposed first version ends the current device's session.

## 5. Response rules

| Situation | Result |
| --- | --- |
| No valid access token on a protected route | `401 Unauthorized` |
| Valid member token on an admin route | `403 Forbidden` |
| Incorrect login details | `401 Unauthorized` with a generic credentials error |
| Duplicate registration email | `409 Conflict` |
| Expired, revoked, or reused refresh token | `401 Unauthorized`; require login |
| Invalid registration input | `400 Bad Request` with field errors |

## 6. Proposed API contract for later phases

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/auth/register` | Visitor |
| `POST` | `/auth/login` | Visitor |
| `POST` | `/auth/refresh` | Holder of a valid refresh token |
| `POST` | `/auth/logout` | Holder of a refresh token |
| `GET` | `/auth/me` | Member or admin |
| `GET` | `/clubs` | Everyone |
| `GET` | `/events` | Everyone |
| `POST` | `/clubs/:id/join` | Member or admin |
| `POST` | `/events/:id/register` | Member or admin |
| Admin management routes | `/admin/*` | Admin |

Paths for club and event features are provisional; this phase fixes the permissions, not their final endpoint names.

## 7. Phase 1 acceptance criteria

- Visitor, member, and admin are defined unambiguously.
- Every planned action has a required access level and ownership rule.
- Public registration cannot create an admin.
- Registration eligibility, email verification, password policy, token lifetimes, and logout scope are decided before production implementation.
- The team agrees on the `401` versus `403` behavior and refresh-token rotation rule.

## 8. Decisions to confirm

1. Open registration or college email only? If college email only, which domains?
2. Is email verification required before joining clubs or registering for events?
3. Which admin actions should be available in the first release?
4. Should logout affect one device or all devices?
5. Who can grant or remove admin access after the first admin is established?

## Current Phase 3 implementation defaults

Registration currently accepts any valid email address without verification, requires a 12–128 character password, returns `409` for an existing email, and always creates a member. These defaults allow Phase 3 to run while the decisions above remain open for the full portal release.
