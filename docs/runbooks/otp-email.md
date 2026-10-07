# OTP email delivery

The API encrypts the OTP payload into the PostgreSQL outbox. Only the worker sends mail, through Gmail SMTP at `smtp.gmail.com:587` with STARTTLS. Do not send OTP from the API, and do not use the Gmail API, a service account, domain-wide delegation, `smtp-relay.gmail.com`, or an OAuth refresh token.

1. Use a dedicated Gmail or Google Workspace mailbox for IMeal OTP.
2. Enable 2-Step Verification.
3. Create a Google App Password for the application.
4. Store it as `OTP_SMTP_PASSWORD`. Never use or store the regular Google password.
5. `OTP_SMTP_USERNAME` is the mailbox.
6. `OTP_SMTP_FROM` is the approved sender address. If Gmail rejects an unauthorized alias, delivery fails through the worker retry/failure path.
7. Production worker needs outbound TCP to `smtp.gmail.com:587` and has no inbound published ports. It is on the internal data network plus a non-internal egress network.
8. `OTP_SMTP_HOST` and `OTP_SMTP_PORT` are hard-defaulted to `smtp.gmail.com` and `587` in production compose and in code. Operators must supply username, password, from, and optionally from-name (default IMeal). TLS is required.

The production env file used by `yarn verify:production-boundary --env-file` must contain `OTP_SMTP_USERNAME`, `OTP_SMTP_PASSWORD`, `OTP_SMTP_FROM`, and `EGRESS_NETWORK_NAME`. It must not contain `OTP_PROVIDER_URL`, `OTP_PROVIDER_API_KEY`, or `OTP_PROVIDER_FROM`. Do not put the SMTP password in the API service environment.
