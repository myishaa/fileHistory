import assert from "node:assert/strict";
import test from "node:test";
import {
  isAutoTenderLive,
  isBidWindowLive,
  isTcecComplete,
} from "../src/lib/bidding-status.ts";

const today = new Date();
const toIsoDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const shiftDate = (days) => {
  const date = new Date(today);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
};

test("live bid window uses only the active tender dates", () => {
  assert.equal(isBidWindowLive(shiftDate(-1), shiftDate(1), toIsoDate(today)), true);
  assert.equal(isBidWindowLive(shiftDate(-3), shiftDate(-1), toIsoDate(today)), false);
  assert.equal(isBidWindowLive(undefined, shiftDate(1), toIsoDate(today)), false);
});

test("current tender state uses refloat dates despite stale normal-bid flags", () => {
  const liveDates = { startDate: shiftDate(-1), openingDate: shiftDate(1), today: toIsoDate(today) };
  assert.equal(
    isAutoTenderLive({
      refloat: true,
      normalStartDate: shiftDate(-30),
      normalOpeningDate: shiftDate(-20),
      refloatStartDate: liveDates.startDate,
      refloatOpeningDate: liveDates.openingDate,
      today: liveDates.today,
      bidOpened: "Yes",
      biddingStageOver: "Yes",
    }),
    true,
  );
  assert.equal(
    isAutoTenderLive({
      refloat: true,
      normalStartDate: shiftDate(-1),
      normalOpeningDate: shiftDate(1),
      refloatStartDate: shiftDate(-10),
      refloatOpeningDate: shiftDate(-2),
      today: toIsoDate(today),
    }),
    false,
  );
  assert.equal(
    isAutoTenderLive({
      refloat: false,
      normalStartDate: liveDates.startDate,
      normalOpeningDate: liveDates.openingDate,
      refloatStartDate: undefined,
      refloatOpeningDate: undefined,
      today: liveDates.today,
      bidOpened: "Yes",
      biddingStageOver: "Yes",
    }),
    true,
  );
  assert.equal(isTcecComplete("No", shiftDate(-1)), false);
  assert.equal(isTcecComplete("Yes", shiftDate(-1)), true);
});
