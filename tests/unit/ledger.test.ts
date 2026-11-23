import { describe, it, expect } from "vitest";
import { LedgerAccountType, LedgerDirection } from "@prisma/client";
import {
  ESCROW_ACCOUNT,
  backerAccount,
  balanceOf,
  builderAccount,
  postTransfer,
} from "@/domain/ledger/service";
import { makeFinanceDb } from "../helpers/finance-db";

describe("复式账本（F10）", () => {
  it("一笔承诺生成一借一贷两条流水", async () => {
    const { db, ledger } = makeFinanceDb();

    await postTransfer(db as never, {
      from: backerAccount("u1"),
      to: ESCROW_ACCOUNT,
      amount: 10_000n,
      bizType: "PLEDGE",
      bizId: "p1",
      idempotencyKey: "pledge:p1",
    });

    expect(ledger).toHaveLength(2);
    const out = ledger.find((e) => e.direction === LedgerDirection.DEBIT);
    const inbound = ledger.find((e) => e.direction === LedgerDirection.CREDIT);

    expect(out?.accountType).toBe(LedgerAccountType.BACKER);
    expect(out?.balanceAfter).toBe(-10_000n);
    expect(inbound?.accountType).toBe(LedgerAccountType.ESCROW);
    expect(inbound?.balanceAfter).toBe(10_000n);
  });

  it("借贷金额相等，全局守恒", async () => {
    const { db, ledger } = makeFinanceDb();
    await postTransfer(db as never, {
      from: backerAccount("u1"),
      to: ESCROW_ACCOUNT,
      amount: 4_900n,
      bizType: "PLEDGE",
      bizId: "p1",
      idempotencyKey: "k1",
    });

    const debit = ledger
      .filter((e) => e.direction === LedgerDirection.DEBIT)
      .reduce((s, e) => s + e.amount, 0n);
    const credit = ledger
      .filter((e) => e.direction === LedgerDirection.CREDIT)
      .reduce((s, e) => s + e.amount, 0n);

    expect(debit).toBe(credit);
  });

  it("余额按 CREDIT - DEBIT 累计", async () => {
    const { db } = makeFinanceDb();
    const backer = backerAccount("u1");

    await postTransfer(db as never, {
      from: backer,
      to: ESCROW_ACCOUNT,
      amount: 3_000n,
      bizType: "PLEDGE",
      bizId: "p1",
      idempotencyKey: "k1",
    });
    await postTransfer(db as never, {
      from: backer,
      to: ESCROW_ACCOUNT,
      amount: 2_000n,
      bizType: "PLEDGE",
      bizId: "p2",
      idempotencyKey: "k2",
    });

    expect(await balanceOf(db as never, backer)).toBe(-5_000n);
    expect(await balanceOf(db as never, ESCROW_ACCOUNT)).toBe(5_000n);
  });

  it("退款冲销后托管余额归零", async () => {
    const { db } = makeFinanceDb();
    const backer = backerAccount("u1");

    await postTransfer(db as never, {
      from: backer,
      to: ESCROW_ACCOUNT,
      amount: 9_900n,
      bizType: "PLEDGE",
      bizId: "p1",
      idempotencyKey: "k1",
    });
    await postTransfer(db as never, {
      from: ESCROW_ACCOUNT,
      to: backer,
      amount: 9_900n,
      bizType: "REFUND",
      bizId: "p1",
      idempotencyKey: "refund:p1",
    });

    expect(await balanceOf(db as never, backer)).toBe(0n);
    expect(await balanceOf(db as never, ESCROW_ACCOUNT)).toBe(0n);
  });

  it("拒绝零或负数金额", async () => {
    const { db } = makeFinanceDb();
    await expect(
      postTransfer(db as never, {
        from: backerAccount("u1"),
        to: ESCROW_ACCOUNT,
        amount: 0n,
        bizType: "PLEDGE",
        bizId: "p1",
        idempotencyKey: "k1",
      }),
    ).rejects.toThrow("记账金额必须大于 0");
  });

  it("幂等键派生 :out / :in，防止重复记账", async () => {
    const { db, ledger } = makeFinanceDb();
    await postTransfer(db as never, {
      from: backerAccount("u1"),
      to: ESCROW_ACCOUNT,
      amount: 1_000n,
      bizType: "PLEDGE",
      bizId: "p1",
      idempotencyKey: "same-key",
    });
    expect(ledger.map((e) => e.idempotencyKey).sort()).toEqual(["same-key:in", "same-key:out"]);
  });

  it("托管账户余额不足时拒绝划出（防超额放款）", async () => {
    const { db } = makeFinanceDb();

    await expect(
      postTransfer(db as never, {
        from: ESCROW_ACCOUNT,
        to: builderAccount("b1"),
        amount: 100n,
        bizType: "RELEASE",
        bizId: "m1",
        idempotencyKey: "payout:m1",
      }),
    ).rejects.toThrow("托管账户余额不足");
  });

  it("托管余额刚好等于放款额时允许划出，余额归零", async () => {
    const { db } = makeFinanceDb();

    await postTransfer(db as never, {
      from: backerAccount("u1"),
      to: ESCROW_ACCOUNT,
      amount: 5_000n,
      bizType: "PLEDGE",
      bizId: "p1",
      idempotencyKey: "pledge:p1",
    });
    await postTransfer(db as never, {
      from: ESCROW_ACCOUNT,
      to: builderAccount("b1"),
      amount: 5_000n,
      bizType: "RELEASE",
      bizId: "m1",
      idempotencyKey: "payout:m1",
    });

    expect(await balanceOf(db as never, ESCROW_ACCOUNT)).toBe(0n);
    expect(await balanceOf(db as never, builderAccount("b1"))).toBe(5_000n);
  });
});
