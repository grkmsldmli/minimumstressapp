import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const APP_GROUP = "group.com.minimumstress.app.onesignal";

describe("native push build contract", () => {
  it("embeds the OneSignal iOS service extension and links its framework", () => {
    const project = read("ios/App/App.xcodeproj/project.pbxproj");
    const service = read(
      "ios/App/OneSignalNotificationServiceExtension/NotificationService.swift",
    );

    expect(project).toContain("OneSignalNotificationServiceExtension.appex in Embed App Extensions");
    expect(project).toContain("productName = OneSignalExtension");
    expect(project).toContain(
      "PRODUCT_BUNDLE_IDENTIFIER = com.minimumstress.app.OneSignalNotificationServiceExtension",
    );
    expect(service).toContain("OneSignalExtension.didReceiveNotificationExtensionRequest");
  });

  it("uses the exact same OneSignal App Group in both iOS targets", () => {
    expect(read("ios/App/App/App.entitlements")).toContain(APP_GROUP);
    expect(
      read(
        "ios/App/OneSignalNotificationServiceExtension/OneSignalNotificationServiceExtension.entitlements",
      ),
    ).toContain(APP_GROUP);
    expect(read("ios/App/App/Info.plist")).toContain(APP_GROUP);
    expect(read("ios/App/OneSignalNotificationServiceExtension/Info.plist")).toContain(APP_GROUP);
  });

  it("will not archive against profiles that omit the shared App Group or extension", () => {
    const workflow = read("codemagic.yaml");
    expect(workflow).toContain(APP_GROUP);
    expect(workflow).toContain("com.minimumstress.app.OneSignalNotificationServiceExtension");
    expect(workflow).toContain("profile: minimumstress_appstore_102");
    expect(workflow).toContain("profile: minimumstress_onesignal_extension_102");
    expect(workflow).toContain("certificate: minimumstress_distribution_101");
    expect(workflow).toContain("environment_variable: CM_APP_PROVISIONING_PROFILE");
    expect(workflow).toContain("environment_variable: CM_EXTENSION_PROVISIONING_PROFILE");
  });

  it("pins release toolchains and publishes Android only to Internal testing", () => {
    const workflow = read("codemagic.yaml");
    expect(workflow).toContain('APP_VERSION_NAME: "1.0.2"');
    expect(workflow).toContain('xcode: "26.6"');
    expect(workflow).toContain("credentials: $GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS");
    expect(workflow).toContain("track: internal");
    expect(workflow).toContain("submit_as_draft: false");
  });

  it("keeps Android 13 notification permission in the shipped manifest", () => {
    expect(read("android/app/src/main/AndroidManifest.xml")).toContain(
      'android.permission.POST_NOTIFICATIONS',
    );
  });
});
