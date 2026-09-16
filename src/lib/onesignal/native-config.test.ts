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
  });

  it("keeps Android 13 notification permission in the shipped manifest", () => {
    expect(read("android/app/src/main/AndroidManifest.xml")).toContain(
      'android.permission.POST_NOTIFICATIONS',
    );
  });
});
