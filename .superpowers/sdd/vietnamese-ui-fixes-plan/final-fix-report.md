# Final Fix Report: Admin Non-Server Error Fallback

## Files

- `apps/admin-web/src/main.ts`

## Behavior

- Added an explicit `AdminDisplayError` classification and `userFacingMessage` helper.
- Server-provided `ErrorResponseSchema.message` values remain verbatim for API and login failures.
- Non-OK API responses without a server message retain `Yêu cầu thất bại với mã trạng thái ${response.status}.`.
- Non-OK login responses without a server message retain `Đăng nhập thất bại với mã trạng thái ${response.status}.`.
- The missing-token path retains `Bạn cần đăng nhập.`.
- The no-admin-permission path retains `Tài khoản không có quyền quản trị.`.
- `showError` now uses `Đã xảy ra lỗi không xác định.` for network `TypeError`, arbitrary runtime errors, and other unclassified errors.
- Login error rendering now uses `Đăng nhập thất bại.` for network `TypeError`, arbitrary runtime errors, and other unclassified errors.
- API paths, payloads, permissions, session key, and layout/CSS were not changed.

## Verification

Command:

```text
corepack yarn workspace @imeal/admin-web build
```

Output:

```text
vite v8.2.2 building client environment for production...
transforming...
✓ 15 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                  0.50 kB │ gzip:  0.31 kB
dist/assets/index-IWy2VTJh.css   2.78 kB │ gzip:  1.16 kB
dist/assets/index-BVTmqVEt.js    64.96 kB │ gzip: 16.29 kB

✓ built in 90ms
```
Exit status: 0.

## Commit

- Source fix: `82fc158` (`fix(admin): classify user-facing errors`)
- This report is included in the follow-up report commit.

## Concerns

- No concerns for the requested source/build scope. Browser runtime/network fixture verification was not run; the required narrow production build passed.
