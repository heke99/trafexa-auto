import { LEGAL_POLICY_VERSION } from './policy-version.ts';

/** Necessary notice preference only; this is not permission to load optional trackers. */
export const COOKIE_NOTICE_NAME = 'trafexa-cookie-notice';
export const COOKIE_POLICY_VERSION = LEGAL_POLICY_VERSION;
export const COOKIE_NOTICE_MAX_AGE = 60 * 60 * 24 * 180;
export const COOKIE_SETTINGS_EVENT = 'trafexa:cookie-settings';
export const COOKIE_NOTICE_VALUE = `${COOKIE_POLICY_VERSION}:necessary-only`;
