/**
 * platform.js — Runtime detection for Capacitor native vs web browser.
 *
 * All platform-specific branching in the app goes through this module.
 * Uses @capacitor/core for reliable detection (not window.Capacitor directly).
 */

import { Capacitor } from '@capacitor/core';

/**
 * True when running inside the Capacitor native shell (Android / iOS).
 * False in the browser (PWA, desktop).
 */
export const isNative = Capacitor.isNativePlatform();

/**
 * True when running on Android specifically.
 */
export const isAndroid = isNative && Capacitor.getPlatform() === 'android';

/**
 * True when running on iOS specifically.
 */
export const isIos = isNative && Capacitor.getPlatform() === 'ios';

/**
 * Native setup mode: 'local' | 'server' | null (not yet chosen).
 * Set during the Android onboarding wizard.
 */
export function getNativeMode() {
  if (!isNative) return null;
  return localStorage.getItem('nt:nativeMode') || null;
}

export function setNativeMode(mode) {
  if (mode) {
    localStorage.setItem('nt:nativeMode', mode);
  } else {
    localStorage.removeItem('nt:nativeMode');
  }
}

/**
 * The server URL to use for sync.
 * In web mode: always same-origin (relative URLs).
 * In native mode: read from localStorage, or null (standalone / offline-first).
 */
export function getServerUrl() {
  if (!isNative) return ''; // relative URLs — same origin
  return localStorage.getItem('nt:serverUrl') || null;
}

/**
 * Save the server URL for native sync mode.
 * Pass null to revert to standalone (offline-only) mode.
 */
export function setServerUrl(url) {
  if (url) {
    localStorage.setItem('nt:serverUrl', url.replace(/\/$/, ''));
  } else {
    localStorage.removeItem('nt:serverUrl');
  }
}

/**
 * True when in native mode AND a server URL has been configured.
 * In this mode NtApi routes calls to the remote server + queues sync.
 */
export function isServerConnected() {
  return isNative && !!getServerUrl();
}

/**
 * True when running native but setup hasn't been completed yet.
 */
export function needsNativeSetup() {
  return isNative && !getNativeMode();
}
