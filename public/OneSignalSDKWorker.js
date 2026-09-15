// OneSignal web push service worker.
//
// Must live at the site root (this file is served from /OneSignalSDKWorker.js)
// and simply re-exports OneSignal's own worker from their CDN, which is how the
// v16 Web SDK receives and shows push messages when the site is not open.
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
