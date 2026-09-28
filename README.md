# College Club Portal

Phase 1 requirements are in [docs/phase-1-requirements.md](docs/phase-1-requirements.md). Phase 2 provides the Express and SQLite foundation. Phase 3 adds member registration. Login, JWT issuance, and role enforcement are planned for later phases.

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

SQLite data is stored under `data/` by default and is excluded from Git. Migrations run at server startup as well as through `npm run migrate`. The schema contains `users`, `refresh_sessions`, and `schema_migrations` tables. Visitors have no user row; registered accounts can have only `member` or `admin` as their role.

The current SQLite foundation is intended for one server instance. A multi-instance deployment will need a shared database.
