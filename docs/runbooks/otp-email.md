# OTP email delivery

The API encrypts the OTP payload into the PostgreSQL outbox. Only the worker sends mail, through Gmail SMTP at `smtp.gmail.com:587` with STARTTLS. Do not send OTP from the API, and do not use the Gmail API, a service account, domain-wide delegation, `smtp-relay.gmail.com`, or an OAuth refresh token.

1. Create or designate a dedicated Gmail or Google Workspace mailbox for IMeal OTP; do not reuse a personal operator mailbox.
2. Enable 2-Step Verification for that mailbox.
3. In Google Account → Security → App passwords, create an app password labeled `IMeal OTP worker`. Copy the generated value once and treat it as a secret. A regular Google account password is not accepted and must never be stored here.
4. Set `OTP_SMTP_USERNAME` to the mailbox, `OTP_SMTP_PASSWORD` to the generated App Password, and `OTP_SMTP_FROM` to the approved sender address. Set optional `OTP_SMTP_FROM_NAME` (default `IMeal`) if the display name needs to be explicit. Examples must remain placeholders such as `otp-local@example.test` and `CHANGE_ME_LOCAL`.
5. The worker connects to `smtp.gmail.com` over outbound TCP port `587` with STARTTLS. Keep `OTP_SMTP_REQUIRE_TLS=true`; the production worker publishes no inbound ports.
6. For local Compose, keep these values in the untracked `.env`; Compose injects them into the worker service only. For a direct worker process, export/set the same variables in that process before `yarn workspace @imeal/worker start:dev`. The worker does not read `.env` itself.
7. The API encrypts the OTP payload into the PostgreSQL outbox and never receives SMTP credentials. Do not configure `OTP_PROVIDER_URL`, `OTP_PROVIDER_API_KEY`, `OTP_PROVIDER_FROM`, Gmail API credentials, a service account, domain-wide delegation, `smtp-relay.gmail.com`, or an OAuth refresh token.
8. To rotate access, create a replacement App Password, update the protected worker environment (or untracked local `.env`), restart the worker, verify delivery, and then revoke the old App Password in Google Account security. No API credential or API restart is required.

Production Compose and code hard-default `OTP_SMTP_HOST` and `OTP_SMTP_PORT` to `smtp.gmail.com` and `587`; operators must supply username, password, from, and optionally from-name. TLS is required.

The production env file used by `yarn verify:production-boundary --env-file` must contain `OTP_SMTP_USERNAME`, `OTP_SMTP_PASSWORD`, `OTP_SMTP_FROM`, and `EGRESS_NETWORK_NAME`. It must not contain `OTP_PROVIDER_URL`, `OTP_PROVIDER_API_KEY`, or `OTP_PROVIDER_FROM`. Do not put the SMTP password in the API service environment.
