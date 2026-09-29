# College Club Portal

Phase 1 requirements are in [docs/phase-1-requirements.md](docs/phase-1-requirements.md). Phase 2 provides the Express and SQLite foundation. Phase 3 adds member registration. Phase 4 adds login and JWT issuance. Phase 5 verifies access tokens and enforces member/admin roles. Phase 6 adds refresh rotation, replay detection, and logout.

## Local setup

Requires Node.js 20 or newer.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and replace both JWT secrets with different random values of at least 32 characters.
3. Run `npm run migrate` to create the database tables.
4. Run `npm start` or `npm run dev`.
5. Visit `http://localhost:3000/health`; it should return `{"status":"ok","database":"ok"}`.

## Register a member

Send `POST /auth/register` with JSON:

```json
{
  "name": "Asha Rao",
  "email": "asha@example.edu",
  "password": "a-long-private-password"
}
```

Successful registration returns `201` with the new user's public `id`, `name`, `email`, and `member` role. It does not log the user in or issue a JWT yet. The password must be 12 to 128 characters. Registration is currently open to any email address; email verification has not been implemented. Duplicate emails return `409`.

## Log in

Send `POST /auth/login` with JSON:

```json
{
  "email": "asha@example.edu",
  "password": "a-long-private-password"
}
```

A successful login returns `accessToken`, `refreshToken`, `tokenType: "Bearer"`, `expiresIn: 900`, and public user details. Invalid credentials return `401` without revealing whether the email or password was wrong. The access JWT lasts 15 minutes; the refresh JWT lasts 7 days. Both contain the user ID, but neither contains the password, password hash, or role. The refresh token's SHA-256 digest is stored in `refresh_sessions`; the token itself is not stored there.

## Protected routes and admin access

Send `Authorization: Bearer <accessToken>` with a protected request:

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/health` | Everyone, including visitors |
| `GET` | `/auth/me` | Member or admin |
| `GET` | `/admin/users` | Admin only |

`/auth/me` returns the current user's public details. `/admin/users` returns public user details without password hashes, in pages of 50 by default. Pass `?limit=1..100` and then `?cursor=<nextCursor>` to fetch later pages. Missing, invalid, expired, or refresh tokens receive `401`; a signed-in member calling an admin route receives `403`. Roles are read from SQLite for every protected request, so a role change takes effect without issuing a new access token.

Public registration never grants admin rights. To promote an existing account locally, run `npm run make-admin -- person@example.edu`. This command is only available from a trusted server terminal; it is not an API endpoint.

## Refresh and logout

Send `POST /auth/refresh` with JSON `{ "refreshToken": "<refreshToken>" }` before the access token expires. It returns the same response shape as login, with a new access token and a new refresh token. Replace the stored refresh token immediately. Each refresh token can be exchanged only once. If an already exchanged token is used again, all active refresh tokens in that login's token family are revoked. Clients should coordinate refresh calls so only one request exchanges a given token at a time. Invalid or expired tokens return `401`.

Send `POST /auth/logout` with the current refresh token in the same JSON shape. It revokes that login's token family and returns `204`. Repeating logout also returns `204`. Other logins remain active. A previously issued access token remains usable until its 15-minute expiry, unless the account is removed. The client should discard both tokens on logout. A refreshed response reads the current role from SQLite; visitors have no tokens.

Club and event routes will be added in later portal work.

## Traffic limits and deployment

The single-server API limits registration to 30 requests per IP in 15 minutes, login to 300 requests per IP and 20 per normalized email in 15 minutes, refresh/logout to 300 combined requests per IP in 15 minutes, and password-hashing work to 8 concurrent requests. Excess attempts return `429`; an overloaded password worker returns `503` with a short retry hint. Each account can have at most 10 active login sessions. Revoked and rotated token digests are retained until expiry so reuse can be detected; expired records are removed during login or refresh.

The default `TRUST_PROXY_HOPS=0` ignores client-supplied forwarding headers. If the API is reachable only through a known reverse proxy, set this to the exact number of trusted proxy hops so IP limits identify clients correctly. Never increase it while clients can connect directly to the API.

SQLite data is stored under `data/` by default and is excluded from Git. Migrations run at server startup as well as through `npm run migrate`. The schema contains `users`, `refresh_sessions`, and `schema_migrations` tables. Visitors have no user row; registered accounts can have only `member` or `admin` as their role.

The current SQLite foundation and in-memory rate-limit counters are intended for one server instance. A multi-instance deployment needs a shared database and shared rate-limit store. SQLite WAL permits concurrent readers but only one writer at a time; plan a server database before running many API instances. Registration currently returns `409` for an existing email, which reveals account existence and remains a Phase 1 product decision to revisit before public deployment.
