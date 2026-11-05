# Report service (Cloudflare Worker)

Receives problem reports from IOM Regatta Manager (Help > Report a problem,
in the menu bar or the top bar's Help menu) and e-mails each one, with
its attachments, to the developer through [Resend](https://resend.com).

No Cloudflare domain is needed: Resend's `onboarding@resend.dev` sender may
mail the address the Resend account was opened with.

## What a report contains

- the form: kind of problem, where in the app, when, what went wrong, what
  the user was doing, what they expected, an optional name and phone/e-mail
  (an e-mail becomes the mail's Reply-To)
- `report.json`: every field, plus the page, the event and the computer
- `event-snapshot.json`: the event's tables (as the app's event backup) plus
  the boats, sailors and clubs it uses (`people`)
- `history.txt` / `history.json`: the event's change history
- `errors.log`: the newest 512 KB of the app's error log
- `screenshot.jpg`: the window when the form was opened

The user can switch each attachment off. Text attachments are gzipped
(`.gz`) when the mail would otherwise be too large.

## Answers (what the app does with its saved copy)

| Status             | Meaning                                     | App                                   |
| ------------------ | ------------------------------------------- | ------------------------------------- |
| 200                | mailed                                      | deletes it                            |
| 429, 5xx           | rate limit, Resend down, service not set up | keeps it, retries every 10 min        |
| 400, 401, 413, 422 | refused for good                            | moves it to `problem-reports/failed/` |

The report id is Resend's idempotency key, so a report sent twice arrives once.

## Set up

1. Open a Resend account with the address the reports should go to and
   create an API key (Sending access).
2. Set the secrets and deploy:

   ```sh
   cd report-worker
   npx wrangler secret put RESEND_API_KEY   # re_…
   npx wrangler secret put TO_ADDRESS       # the Resend account's address
   npx wrangler secret put APP_KEY          # any long random string
   npx wrangler deploy
   ```

3. Put the Worker URL (`https://iom-report.<subdomain>.workers.dev/report`) and
   the same APP_KEY in `src/main/functions/problemReportConfig.ts`, and build
   the app.

To send from your own domain later, verify it in Resend and set
`FROM_ADDRESS` in `wrangler.jsonc`.

## Develop and test

```sh
npm test                     # node --test, no dependencies
printf 'APP_KEY=local\nRESEND_API_KEY=re_x\nTO_ADDRESS=you@example.com\n' > .dev.vars
npx wrangler dev             # then run the app with
# SCORING_APP_REPORT_URL=http://localhost:8787/report SCORING_APP_REPORT_KEY=local
```

The app's e2e test (`e2e/problem-report.spec.ts`) sends a real report to a
stand-in service and checks what arrived.
