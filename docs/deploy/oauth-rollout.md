# Google / Apple sign-in — safe rollout order

The web app now contains the full code path for "Continue with Apple / Continue
with Google" on both web and native. **It is deliberately dormant** and must be
turned on in a specific order so the current App Store binary never shows a
button it cannot finish.

## Why it is safe on the live app today

- **Provider buttons render only for providers the auth server reports enabled.**
  Until Google/Apple are enabled in Supabase, no OAuth button appears anywhere
  (web or native).
- **Native gates on the binary, not just on being native.** A native build only
  fetches/shows providers when it actually ships the Capacitor `Browser` and
  `App` plugins — `hasNativeOAuthSupport()` in `src/lib/native.ts`. The current
  live binary (**1.0.0**) does not ship them, so it stays **email-OTP + reviewer
  password only**, no matter what is enabled server-side.
- Email six-digit OTP and the reviewer password login are unchanged and remain
  the only native sign-in methods on 1.0.0.

So merging/deploying this web branch **cannot** break the live native app, and
**cannot** be made to show a dead-end OAuth button, even if a provider is enabled
in Supabase for the website.

## Rollout order (do NOT skip or reorder)

1. **Now:** merge + deploy this web branch. OAuth stays dormant. Do **not**
   enable Google/Apple providers in the production Supabase project yet — the
   website would light up OAuth buttons before the native app can, which is
   allowed but not required; keep both off until the native side is ready if you
   want web and native to launch OAuth together.
2. **Native 1.0.1:** ship the `mobile-app` changes (Capacitor `@capacitor/browser`
   + `@capacitor/app`, the `com.minimumstress.app` URL scheme, Sign in with Apple
   capability). Build via Codemagic, verify the deep-link return on a device.
3. **External auth config:** complete the Supabase / Google Cloud / Apple
   Developer setup (see `docs/app-store/ios-native/README.md` and the PR
   description) — the redirect URLs, client IDs, and .p8/secret.
4. **Enable providers:** only after 1.0.1 is verified on device, enable Google
   and Apple in the production Supabase project. Buttons then appear on the
   website and on 1.0.1+ native builds. 1.0.0 users continue with email only.

## Do not

- Do not enable production Google/Apple providers before 1.0.1 is verified.
- Do not submit 1.0.1 to the App Store until the deep-link OAuth return is
  confirmed working on a device.
