/**
 * Client configuration for connecting to the Soothe daemon.
 */

import type { VerbosityLevel } from './verbosity.js';

export interface Config {
  /** WebSocket URL for Soothe daemon */
  daemonURL: string;
  /** Event verbosity: quiet/minimal/normal/detailed/debug */
  verbosityLevel: VerbosityLevel;
  /** Maximum connection retry attempts */
  maxRetries: number;
  /** Initial reconnect delay in ms */
  reconnectDelay: number;
  /** Application-level heartbeat interval in ms */
  heartbeatInterval: number;
  /** Handshake: wait for daemon_ready in ms */
  daemonReadyTimeout: number;
  /** Bootstrap: wait for status with loop_id in ms */
  loopStatusTimeout: number;
  /** After loop_subscribe: wait for confirmation in ms */
  subscriptionTimeout: number;
}

/** Returns default configuration. */
export function defaultConfig(): Config {
  return {
    daemonURL: 'ws://localhost:8765',
    verbosityLevel: 'normal',
    maxRetries: 5,
    reconnectDelay: 2000,
    heartbeatInterval: 30000,
    daemonReadyTimeout: 20000,
    loopStatusTimeout: 60000,
    subscriptionTimeout: 10000,
  };
}

/** Loads configuration from environment variables. */
export function loadConfigFromEnv(): Config {
  const config = defaultConfig();

  if (typeof process === 'undefined') return config;

  const url = process.env.SOOTHE_DAEMON_URL;
  if (url) config.daemonURL = url;

  const verbosity = process.env.SOOTHE_VERBOSITY;
  if (verbosity) config.verbosityLevel = verbosity as VerbosityLevel;

  const retries = process.env.SOOTHE_MAX_RETRIES;
  if (retries) {
    const val = parseInt(retries, 10);
    if (!isNaN(val)) config.maxRetries = val;
  }

  const readyTimeout = process.env.SOOTHE_DAEMON_READY_TIMEOUT_SEC;
  if (readyTimeout) {
    const val = parseInt(readyTimeout, 10);
    if (val > 0) config.daemonReadyTimeout = val * 1000;
  }

  const statusTimeout = process.env.SOOTHE_LOOP_STATUS_TIMEOUT_SEC;
  if (statusTimeout) {
    const val = parseInt(statusTimeout, 10);
    if (val > 0) config.loopStatusTimeout = val * 1000;
  }

  const subTimeout = process.env.SOOTHE_SUBSCRIPTION_TIMEOUT_SEC;
  if (subTimeout) {
    const val = parseInt(subTimeout, 10);
    if (val > 0) config.subscriptionTimeout = val * 1000;
  }

  return config;
}
