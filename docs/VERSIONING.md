# CineSchedule API Versioning (Phase 7)

## Policy
- **/v1 is frozen** after Phase 7: only **additive** (non-breaking) changes allowed.
- Breaking changes land under a new major prefix (e.g., **/v2**).
- Keep /v1 running for a deprecation window (e.g., 90 days) after /v2 is published.

## Allowed (non-breaking) in v1
- Add new endpoints.
- Add optional query params with safe defaults.
- Add optional fields to responses (clients must ignore unknown fields).
- Loosen validation to accept more inputs.
- Add new enum members (clients should handle unknown).

## Breaking (requires v2)
- Remove/rename endpoints, params, or response fields.
- Change data types or formats (e.g., ISO string → epoch).
- Tighten validation that rejects previously valid requests.
- Change semantics or status codes.
- Add auth where none existed.
- Change pagination contract (e.g., rename `nextCursor`).

## Deprecation Guidance
- Add `Deprecation: true` and optionally `Sunset: <RFC 8594 date>` headers on deprecated v1 routes.
- Document migration in `docs/MIGRATIONS/v1-to-v2.md`.

## PR Checklist (copy into .github/PULL_REQUEST_TEMPLATE.md)
- [ ] Does this PR touch `/v1`?
  - [ ] If yes, is it **additive** only?
  - [ ] No renames or removals?
  - [ ] No type/format changes (incl. dates, enums, status codes)?
  - [ ] Zod schemas updated & examples refreshed?
  - [ ] Postman collection updated?
- [ ] If breaking, target `/v2` endpoints and keep `/v1` behavior unchanged.
- [ ] Error envelope unchanged (`error.code`, `requestId`)?

## Headers
- Requests/Responses include `X-API-Version: v1` and `X-Request-Id`.
- When deprecating in the future: `Deprecation: true`, optional `Sunset: <date>`.