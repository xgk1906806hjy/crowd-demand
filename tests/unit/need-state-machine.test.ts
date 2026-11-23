import { describe, it, expect } from "vitest";
import { NeedStatus } from "@prisma/client";
import {
  ACTIVE_STATUSES,
  canTransition,
  isPubliclyVisible,
  isPledgeable,
  isTerminal,
  isVotable,
  NEED_STATUS_LABEL,
  NEED_TRANSITIONS,
} from "@/domain/need/state-machine";

describe("NeedStateMachine", () => {
  it("覆盖全部状态，且每个状态都有中文名", () => {
    for (const status of Object.values(NeedStatus)) {
      expect(NEED_TRANSITIONS[status]).toBeDefined();
      expect(NEED_STATUS_LABEL[status]).toBeTruthy();
    }
  });

  it("允许合法流转", () => {
    expect(canTransition(NeedStatus.DRAFT, NeedStatus.COLLECTING)).toBe(true);
    expect(canTransition(NeedStatus.COLLECTING, NeedStatus.PLEDGING)).toBe(true);
    expect(canTransition(NeedStatus.PLEDGING, NeedStatus.BIDDING)).toBe(true);
    expect(canTransition(NeedStatus.BIDDING, NeedStatus.IN_PROGRESS)).toBe(true);
    expect(canTransition(NeedStatus.IN_PROGRESS, NeedStatus.ACCEPTING)).toBe(true);
    expect(canTransition(NeedStatus.ACCEPTING, NeedStatus.COMPLETED)).toBe(true);
    expect(canTransition(NeedStatus.FAILED, NeedStatus.REFUNDED)).toBe(true);
  });

  it("拒绝跳级与回退", () => {
    expect(canTransition(NeedStatus.DRAFT, NeedStatus.PLEDGING)).toBe(false);
    expect(canTransition(NeedStatus.COLLECTING, NeedStatus.IN_PROGRESS)).toBe(false);
    expect(canTransition(NeedStatus.COMPLETED, NeedStatus.COLLECTING)).toBe(false);
    expect(canTransition(NeedStatus.REFUNDED, NeedStatus.COLLECTING)).toBe(false);
  });

  it("终态不可再流转", () => {
    expect(isTerminal(NeedStatus.COMPLETED)).toBe(true);
    expect(isTerminal(NeedStatus.REFUNDED)).toBe(true);
    expect(isTerminal(NeedStatus.COLLECTING)).toBe(false);
  });

  it("草稿对外不可见、不可投票", () => {
    expect(isPubliclyVisible(NeedStatus.DRAFT)).toBe(false);
    expect(isPubliclyVisible(NeedStatus.COLLECTING)).toBe(true);
    expect(isVotable(NeedStatus.COLLECTING)).toBe(true);
    expect(isVotable(NeedStatus.PLEDGING)).toBe(false);
  });

  it("仅承诺中可付费承诺", () => {
    expect(isPledgeable(NeedStatus.PLEDGING)).toBe(true);
    expect(isPledgeable(NeedStatus.COLLECTING)).toBe(false);
  });

  it("进行中集合不包含终态", () => {
    expect(ACTIVE_STATUSES).not.toContain(NeedStatus.COMPLETED);
    expect(ACTIVE_STATUSES).not.toContain(NeedStatus.FAILED);
    expect(ACTIVE_STATUSES).toContain(NeedStatus.IN_PROGRESS);
  });
});
