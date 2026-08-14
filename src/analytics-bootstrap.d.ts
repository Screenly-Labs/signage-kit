export interface AnalyticsBootstrapOptions {
  /** GA4 measurement id, e.g. `G-XXXXXXX`. */
  gaId: string
  /**
   * The no-store profile route (`PLAYER_PROFILE_PATH`). Omit for static apps, which have no
   * server to read the Screenly metadata headers and therefore no device id to wait for.
   */
  profilePath?: string
  /** Milliseconds to wait for the profile before configuring without it. Default 1500. */
  timeoutMs?: number
  /**
   * Extra `config` params to merge. Merged under `client_id`, so an app cannot accidentally
   * override the device identity.
   */
  configParams?: Record<string, string | number>
}

/** The inline `<head>` GA4 bootstrap that pins `client_id` to the device. */
export function analyticsBootstrap(options: AnalyticsBootstrapOptions): string
