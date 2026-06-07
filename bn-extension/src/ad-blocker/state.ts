/** User is previewing blocked ads on this page (ad-blocker still on). */
let adsPreviewActive = false;

export function isAdsPreviewActive() {
  return adsPreviewActive;
}

export function setAdsPreviewActive(value) {
  adsPreviewActive = Boolean(value);
}
