/**
 * Where problem reports go: the report service (report-worker/ in this repo,
 * a Cloudflare Worker that e-mails each report to the developer).
 *
 * The key ships inside every built copy of the app, so it only keeps random
 * requests out; it is kept out of the public repository all the same. The service also limits how
 * often one address may send and how large a report may be.
 */
export const PROBLEM_REPORT_ENDPOINT =
  'https://iom-report.antonio-luksic2002.workers.dev/report';
// Put in at build time (electron.vite.config.ts) from IOM_REPORT_KEY or
// the git-ignored .report-key file: the repository is public, the key is not.
export const PROBLEM_REPORT_APP_KEY = process.env.IOM_REPORT_KEY ?? '';

export interface ReportEndpoint {
  url: string;
  appKey: string;
}

/**
 * The service to send to, or null when reports can only be kept on this
 * computer. SCORING_APP_REPORT_URL / SCORING_APP_REPORT_KEY override it (for
 * a test service). The automated tests run the app with SCORING_APP_HIDDEN=1:
 * they never send a real report unless a URL is given explicitly.
 */
export function reportEndpoint(
  env: Record<string, string | undefined> = process.env,
): ReportEndpoint | null {
  if (env.SCORING_APP_REPORT_URL) {
    return {
      url: env.SCORING_APP_REPORT_URL,
      appKey: env.SCORING_APP_REPORT_KEY ?? '',
    };
  }
  if (env.SCORING_APP_HIDDEN === '1') return null;
  // Without the key the service would refuse every report for good; keep
  // them on this computer instead (a build made without .report-key).
  if (!PROBLEM_REPORT_ENDPOINT || !PROBLEM_REPORT_APP_KEY) return null;
  return { url: PROBLEM_REPORT_ENDPOINT, appKey: PROBLEM_REPORT_APP_KEY };
}
