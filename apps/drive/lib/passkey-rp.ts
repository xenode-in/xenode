import { getServerProductOrigin } from "@xenode/config";

export function getPasskeyExpectedOrigin() {
  return getServerProductOrigin("drive");
}

export function getPasskeyRpId() {
  return new URL(getServerProductOrigin("drive")).hostname;
}
