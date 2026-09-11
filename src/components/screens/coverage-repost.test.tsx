// @vitest-environment jsdom

/**
 * Reposting a past coverage request through the post form. These pin the rules
 * the backend can't enforce alone: the reusable shape is prefilled, the date is
 * not (a repost must be given a new future one), stale private-session notes are
 * never carried, and a double-tap can never create two requests.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoverageRequest } from "@/lib/domain";
import { CoveragePost } from "./coverage";

afterEach(cleanup);

const SPACES = [{ id: "s1", name: "Studio A", timeZone: "America/Los_Angeles" }];

function request(over: Partial<CoverageRequest> = {}): CoverageRequest {
  return {
    id: "req_1",
    classTemplateId: null,
    spaceId: "s1",
    spaceName: "Studio A",
    title: "Reformer Flow",
    profession: "pilates",
    level: "Intermediate",
    participantsMax: 8,
    equipmentNotes: "Reformers provided",
    startsAt: new Date("2020-01-10T18:00:00Z"),
    endsAt: new Date("2020-01-10T19:00:00Z"),
    timeZone: "America/Los_Angeles",
    payCents: 6000,
    notes: "old note",
    urgent: false,
    state: "completed",
    interestCount: 2,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    sessionFormat: "group",
    participantsExpected: 6,
    audience: "Drop-in regulars",
    teachingNotes: "Keep it flowing",
    requiredQualifications: ["Reformer cert"],
    preferredQualifications: [],
    sessionGoal: null,
    clientExperience: null,
    accommodations: null,
    programming: null,
    ...over,
  };
}

const renderPost = (req: CoverageRequest, onSubmit = vi.fn()) => {
  render(
    <CoveragePost
      spaces={SPACES}
      templates={[]}
      saving={false}
      duplicateFrom={req}
      onSubmit={onSubmit}
      onBack={vi.fn()}
    />,
  );
  return onSubmit;
};

const setDate = (value: string) =>
  fireEvent.change(screen.getByLabelText("Date"), { target: { value } });

describe("CoveragePost — repost", () => {
  it("prefills the reusable class shape but leaves the date empty", () => {
    renderPost(request());
    expect((screen.getByLabelText("Class name") as HTMLInputElement).value).toBe("Reformer Flow");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("");
  });

  it("refuses to post without a new future date", () => {
    const onSubmit = renderPost(request());
    setDate("2020-01-01"); // in the past
    fireEvent.click(screen.getByRole("button", { name: "Post again" }));
    expect(screen.getByText(/new future date/i)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("posts once with a future date, as a fresh input that does not mutate the source", () => {
    const source = request();
    const before = JSON.stringify(source);
    const onSubmit = renderPost(source);
    setDate("2099-06-01");
    fireEvent.click(screen.getByRole("button", { name: "Post again" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const input = onSubmit.mock.calls[0][0];
    expect(input.title).toBe("Reformer Flow");
    expect(input.startsAt).toBeInstanceOf(Date);
    expect(input.startsAt.getTime()).toBeGreaterThan(Date.now());
    // The source object is untouched — a repost is its own new request.
    expect(JSON.stringify(source)).toBe(before);
  });

  it("a double-tap creates only one request", () => {
    const onSubmit = renderPost(request());
    setDate("2099-06-01");
    const button = screen.getByRole("button", { name: "Post again" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("never prefills stale private-session context from a private source", () => {
    renderPost(
      request({
        sessionFormat: "private",
        sessionGoal: "Rehab left knee",
        clientExperience: "Post-op, 6 weeks",
        accommodations: "No deep flexion",
        programming: "continue",
      }),
    );
    expect(screen.queryByDisplayValue("Rehab left knee")).toBeNull();
    expect(screen.queryByDisplayValue("Post-op, 6 weeks")).toBeNull();
    expect(screen.queryByDisplayValue("No deep flexion")).toBeNull();
  });
});
