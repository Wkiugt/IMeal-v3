# Task 7 Review Fix Report

## Fixes

- `mobileApiError.ts` now recursively extracts known typed error codes from direct response payloads and Nest-style `error`/`message` wrappers, including a typed code represented as the message string. Direct body extraction remains supported and the full response remains on `MobileApiError.cause`.
- `EmployeeCalendarScreen.tsx` now tracks month data by requested month key and clears stale month markers at the beginning of each month request. Month loading and month errors render inside the month section, so a failed month request surfaces retry/error state without replacing current-week registration metadata. Week retry targets the week request.
- Calendar switch accessibility labels are state-specific: enable for inactive dates, disable for active dates, and neutral view wording for locked dates.

## Focused test

- Added a `mobileApiError` behavior test for a typed code wrapped in a Nest-style `message` field.

## Verification

- `corepack yarn workspace @imeal/mobile exec vitest run` — 15 files, 38 tests passed.
- `corepack yarn workspace @imeal/mobile exec tsc --noEmit` — passed.
