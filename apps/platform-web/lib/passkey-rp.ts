const DEFAULT_APP_URL = "http://localhost:3000"

function getConfiguredAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL
}

export function getPasskeyExpectedOrigin() {
  try {
    return new URL(getConfiguredAppUrl()).origin
  } catch {
    return DEFAULT_APP_URL
  }
}

export function getPasskeyRpId() {
  try {
    return new URL(getConfiguredAppUrl()).hostname
  } catch {
    return new URL(DEFAULT_APP_URL).hostname
  }
}
