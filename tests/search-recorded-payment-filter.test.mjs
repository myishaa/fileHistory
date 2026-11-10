import assert from "node:assert/strict";
import test from "node:test";
import { searchFiles } from "../backend/src/utils/file-search.ts";

test("Recorded payment filter includes regular, stage, advance, and supplementary amounts", () => {
  const files = [
    { id: "regular", supplyOrders: [{ actualPaymentCapital: "100" }] },
    {
      id: "stage",
      supplyOrders: [
        {
          stageDelivery: "Yes",
          stagePayment: "Yes",
          stageDeliveries: [{ actualPaymentRevenue: "200" }],
        },
      ],
    },
    {
      id: "advance",
      supplyOrders: [
        {
          advancePayment: "Yes",
          advancePaymentDetail: { actualPaymentCapital: "300" },
        },
      ],
    },
    {
      id: "supplementary",
      supplyOrders: [
        {
          supplementaryBills: [{ actualPaymentRevenue: "400" }],
        },
      ],
    },
    { id: "unpaid", supplyOrders: [{}] },
  ];

  assert.deepEqual(
    searchFiles(files, { actualPaymentFilter: true }).map((file) => file.id),
    ["regular", "stage", "advance", "supplementary"],
  );
});
