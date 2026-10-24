// Storage adapter — chrome.storage.local when available, else localStorage.
// Also reads/clears the content-script hand-off key. All async so the two
// backends look the same to callers. Degrades gracefully on a plain page.

import { PENDING_KEY } from "./handoff.mjs";

const hasChrome =
  typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

export async function getItem(key) {
  if (hasChrome) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (obj) => resolve(obj ? obj[key] : undefined));
    });
  }
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function setItem(key, value) {
  if (hasChrome) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export async function removeItem(key) {
  if (hasChrome) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, () => resolve());
    });
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// Read the pending hand-off from chrome.storage.session (preferred) or local,
// then clear it. Returns the raw payload or undefined.
export async function takePending() {
  // Prefer session storage if present (set by the content script).
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
    const fromSession = await new Promise((resolve) => {
      chrome.storage.session.get(PENDING_KEY, (obj) =>
        resolve(obj ? obj[PENDING_KEY] : undefined)
      );
    });
    if (fromSession) {
      chrome.storage.session.remove(PENDING_KEY, () => {});
      return fromSession;
    }
  }
  const fromLocal = await getItem(PENDING_KEY);
  if (fromLocal) {
    await removeItem(PENDING_KEY);
    return fromLocal;
  }
  return undefined;
}
