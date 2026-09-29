# College Club Portal

Phase 1 requirements are in [docs/phase-1-requirements.md](docs/phase-1-requirements.md). Phase 2 provides the Express and SQLite foundation. Phase 3 adds member registration. Phase 4 adds login and JWT issuance. Phase 5 verifies access tokens and enforces member/admin roles. Phase 6 adds refresh rotation, replay detection, and logout. Phase 7 adds clubs, join requests with college ID card photos, and admin review. Phase 8 adds events and registration.

## Local setup

Requires Node.js 20 or newer.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and replace both JWT secrets and `ID_CARD_ENCRYPTION_SECRET` with three different random values of at least 32 characters. Keep the ID card secret stable across restarts and backups.
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

## Clubs and membership

Visitors can list published clubs with `GET /clubs?limit=50&cursor=<nextCursor>` and view one with `GET /clubs/:id`. Draft and archived clubs are hidden from public routes. Members and admins can view their own approved memberships with `GET /clubs/mine` using an access token; this list supports the same pagination parameters.

Joining a club requires a college ID card photo and admin review. Send `POST /clubs/:id/join` with `Authorization: Bearer <accessToken>`, `Content-Type: image/jpeg`, `image/png`, or `image/webp`, and the **raw image bytes** as the request body. The 2 MB maximum applies to the whole image. The endpoint returns `201` with a pending request ID. The server fully decodes the image, rejects malformed or oversized pixel data, converts it to JPEG, and removes metadata before storage. This API accepts a raw image body, not multipart form data. Only one pending request per member and club is allowed. Ten join attempts per account per day are permitted on this single server.

An admin reviews pending requests with `GET /admin/clubs/:id/requests`, downloads a photo with `GET /admin/join-requests/:id/id-card`, then sends `POST /admin/join-requests/:id/approve` or `/reject`. Approval creates the membership. Rejection permits a new application. Both decisions clear the encrypted photo bytes from the active database record. Pending requests expire after 30 days; expiry clears the photo at startup, during join/review operations, or during an hourly server sweep. The photo endpoint is admin-only and uses `Cache-Control: no-store` and an attachment response. Pending photos are encrypted with AES-256-GCM using the separate ID card secret. The next server start encrypts any pending photos left plaintext by the previous version. Keep the secret outside Git and backed up securely: a different key causes startup to fail and pending photos cannot be recovered without the original key. Older SQLite/WAL files and backups may still contain plaintext from before this upgrade; restrict access to those files and follow a suitable backup retention policy.

Members leave with `DELETE /clubs/:id/membership`. The user ID always comes from the verified access token; a client cannot specify someone else's membership. A member who leaves must submit a new join request and photo to rejoin. Admins can create clubs with `POST /admin/clubs`, list all clubs with `GET /admin/clubs`, edit them with `PATCH /admin/clubs/:id`, and view approved members with `GET /admin/clubs/:id/members`. Club input accepts `name` (2–100 characters), unique lowercase `slug`, `description` (up to 2,000 characters), and `status` (`draft`, `published`, or `archived`). Admin list endpoints are paginated with `limit` and `cursor`.

Example admin club creation body:

```json
{"name":"Robotics Club","slug":"robotics-club","description":"Build and learn together","status":"published"}
```

## Events and registration

Visitors can list published events with `GET /events?limit=50&cursor=<nextCursor>` and view one with `GET /events/:id`. Events from draft or archived clubs are hidden. Admins create events with `POST /admin/events`, list all statuses with `GET /admin/events`, inspect one with `GET /admin/events/:id`, edit or cancel it with `PATCH /admin/events/:id`, and page through attendees with `GET /admin/events/:id/attendees`. Only admins can see attendee names and email addresses.

An event belongs to a club and has a title (2–150 characters), description (up to 5,000 characters), location (2–200 characters), `startsAt` and `endsAt` in exact UTC ISO form such as `2030-05-01T10:00:00.000Z`, capacity (1–10,000), audience (`club_members` or `all_members`), and status (`draft`, `published`, or `cancelled`). The default audience is `club_members`; the default status is `draft`. Start time must be in the future when creating or publishing. A published event requires a published club. Cancellation is final, but registrations remain visible in admin attendee lists and each attendee's own list.

Example admin event creation body:

```json
{
  "clubId": "<published-club-id>",
  "title": "Robot Workshop",
  "description": "Build a robot together",
  "location": "Lab 1",
  "startsAt": "2030-05-01T10:00:00.000Z",
  "endsAt": "2030-05-01T12:00:00.000Z",
  "capacity": 30,
  "audience": "club_members",
  "status": "published"
}
```

Signed-in users register with `POST /events/:id/register`, cancel their own place with `DELETE /events/:id/registration`, and list their registrations with `GET /events/mine`. All lists support `limit` (1–100) and `cursor`. Club-only events require an approved membership in that specific club; a pending ID card request or admin role alone does not qualify. All-members events accept any signed-in account. The server derives the attendee ID from the verified access token. It closes registration and cancellation when the event starts. Leaving a club removes that user's future, non-cancelled club-only event registrations.

The database assigns seats in a single write transaction, so simultaneous requests cannot exceed capacity. Duplicate registration and a full event return `409`. Admins cannot lower capacity below the current registration count or change the club/audience after someone has registered. Event registration changes are limited to 60 per account per 15 minutes on this server.

## Traffic limits and deployment

The single-server API limits registration to 30 requests per IP in 15 minutes, login to 300 requests per IP and 20 per normalized email in 15 minutes, refresh/logout to 300 combined requests per IP in 15 minutes, join attempts to 10 per account per day, event registration changes to 60 per account per 15 minutes, and password-hashing work to 8 concurrent requests. Excess attempts return `429`; an overloaded password worker or busy SQLite writer returns `503` with a short retry hint. Each account can have at most 10 active login sessions. Revoked and rotated token digests are retained until expiry so reuse can be detected; expired records are removed during login or refresh.

The default `TRUST_PROXY_HOPS=0` ignores client-supplied forwarding headers. If the API is reachable only through a known reverse proxy, set this to the exact number of trusted proxy hops so IP limits identify clients correctly. Never increase it while clients can connect directly to the API.

SQLite data is stored under `data/` by default and is excluded from Git. Migrations run at server startup as well as through `npm run migrate`. The schema contains `users`, `refresh_sessions`, `clubs`, `club_memberships`, `club_join_requests`, `events`, `event_registrations`, and `schema_migrations` tables. Visitors have no user row; registered accounts can have only `member` or `admin` as their role.

The current SQLite foundation and in-memory rate-limit counters are intended for one server instance. A multi-instance deployment needs a shared database and shared rate-limit store. SQLite WAL permits concurrent readers but only one writer at a time; plan a server database before running many API instances. Registration currently returns `409` for an existing email, which reveals account existence and remains a Phase 1 product decision to revisit before public deployment.
