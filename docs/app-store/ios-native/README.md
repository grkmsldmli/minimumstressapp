# Native-config changes to apply on the `mobile-app` branch

The iOS shell (Capacitor 8.5, Swift Package Manager, Codemagic CI) lives on the
`mobile-app` branch. This launch work is web-side (deploys to minimumstress.app,
which the shell loads) plus documentation. A small set of **native** changes must
land on `mobile-app` before submission — staged here so they are not lost:

## 1. Privacy manifest (required)
- Copy `PrivacyInfo.xcprivacy` (this folder) to `ios/App/App/PrivacyInfo.xcprivacy`
  and add it to the "App" target's build resources.
- After `npx cap sync ios`, confirm bundled Capacitor plugins carry their own
  `PrivacyInfo.xcprivacy` (Capacitor 8 ships them). Add Stripe's manifest only if a
  native Stripe SDK is ever added (it is not — Pro/checkout is external Stripe).

## 2. Permission strings (Info.plist)
Already present and correct — keep them accurate:
- `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` — used only when a
  host adds listing photos or a user uploads a verification document.
- **Location:** the app uses browser geolocation for distance sorting. WKWebView
  geolocation requires the native permission; if "Use my location" does not prompt
  in the shell, add `NSLocationWhenInUseUsageDescription`
  ("Minimum Stress uses your location to show spaces near you. You can also enter a
  ZIP code instead.") and the Capacitor Geolocation plugin. If you keep ZIP-only on
  iOS v1, do **not** add the location string. Either way, the manual ZIP path must
  remain.
- Do **not** add Contacts, Motion, HealthKit, Microphone, or background modes —
  no feature uses them.

## 3. External purchase / navigation (Guideline 3.1.1)
- The web app now opens Pro's Stripe checkout via `openExternal()` → the system
  browser on native (see `src/lib/native.ts`). For this to reach Safari rather than
  the WebView, the shell's `allowNavigation` (capacitor.config.ts) must **not**
  include `checkout.stripe.com`, `*.stripe.com`, or Stripe-hosted domains, so those
  URLs are handed to the system browser. Verify capacitor.config.ts keeps
  `allowNavigation` empty/minimal (currently unset — good).

## 4. Deep links / return URLs (Phase 10)
- Configure an Associated Domains entitlement + `apple-app-site-association` on
  minimumstress.app so `minimumstress.app?space=<id>` and Stripe/Identity/Connect
  return URLs reopen the app on the right screen. Until universal links are live,
  returns fall back to Safari and the app reconciles state on resume (Pro is server
  truth) — acceptable for v1, better with universal links.

## 5. App identity & assets (Phase 11)
- Keep `appId: com.minimumstress.app` and `appName: "Minimum Stress"` — already set.
- AppIcon + Splash asset sets exist. Ensure a **1024×1024** App Store icon with **no
  transparency** and no Apple branding is in the AppIcon set.

## 6. Build requirements (Phase 12)
- Xcode 26 / iOS 26 SDK; deployment target per Capacitor 8 support (iOS 14+; 16+
  recommended). arm64 device build, ATS HTTPS-only (config already `cleartext:
  false`), no localhost/dev URLs (the shell points only at `https://minimumstress.app`).
- No mock in release: the shell loads production; `NEXT_PUBLIC_USE_MOCK` is a
  web/Vercel env and is not set in production. Nothing to change in the binary.

## Do NOT put in git
Certificates, private keys, App Store Connect API keys, and provisioning profiles.
Codemagic references them by secret name — keep it that way.
