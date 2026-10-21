import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { getSuspectedAnomalyRows } = await import("../backend/src/routes/dashboard.ts");

const paymentTypes = [
  {
    name: "regular S.O.",
    apply(order, payment) {
      Object.assign(order, payment);
    },
  },
  {
    name: "stage",
    apply(order, payment) {
      order.stageDelivery = "Yes";
      order.stagePayment = "Yes";
      order.stageDeliveries = [{ stageAmountCapital: "100", ...payment }];
    },
  },
  {
    name: "advance",
    apply(order, payment) {
      order.advancePayment = "Yes";
      order.advancePaymentDetail = {
        stageAmountCapital: "100",
        expectedPaymentDate: "2026-06-01",
        ...payment,
      };
    },
  },
  {
    name: "supplementary bill",
    apply(order, payment) {
      order.supplementaryBills = [
        { billAmountCapital: "100", billSentForPaymentDate: "2026-05-01", ...payment },
      ];
    },
  },
];

function reportRowsFor(type, payment, fileValues = { valueCapital: "100", valueRevenue: "0" }) {
  const order = {
    soNo: "SO-1",
    soDate: "2026-01-01",
    soValueCapital: "100",
    soValueRevenue: "0",
  };
  type.apply(order, payment);
  const file = {
    id: `test-${type.name}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    receivedDate: "2026-01-01",
    uniqueCode: `TEST-${type.name}`,
    ...fileValues,
    supplyOrders: [order],
  };
  return getSuspectedAnomalyRows([file], { signatures: new Set(), universalRuleKeys: new Set() });
}

for (const type of paymentTypes) {
  test(`${type.name}: report exposes payment date without actual amount`, () => {
    const rows = reportRowsFor(type, { paymentDate: "2026-06-10" });
    assert.ok(
      rows.some((row) => /payment date is filled without actual payment amount/i.test(row.rule)),
      `expected a visible missing-amount anomaly, got: ${rows.map((row) => row.rule).join("; ")}`,
    );
  });

  test(`${type.name}: report exposes actual amount without payment date`, () => {
    const rows = reportRowsFor(type, { actualPaymentCapital: "25" });
    assert.ok(
      rows.some((row) =>
        /actual payment amount is filled without payment date|paid amount is filled without payment date/i.test(
          row.rule,
        ),
      ),
      `expected a visible missing-date anomaly, got: ${rows.map((row) => row.rule).join("; ")}`,
    );
  });

  for (const scenario of [
    {
      name: "Capital is required but only Revenue actual is recorded",
      payment: { paymentDate: "2026-06-10", actualPaymentRevenue: "25" },
      fileValues: { valueCapital: "100", valueRevenue: "0" },
      expectedSide: "Capital",
      actualSide: "Revenue",
    },
    {
      name: "Revenue is required but only Capital actual is recorded",
      payment: { paymentDate: "2026-06-10", actualPaymentCapital: "25" },
      fileValues: { valueCapital: "0", valueRevenue: "100" },
      expectedSide: "Revenue",
      actualSide: "Capital",
    },
  ]) {
    test(`${type.name}: report flags missing required component (${scenario.name})`, () => {
      const rows = reportRowsFor(type, scenario.payment, scenario.fileValues);
      const anomaly = rows.find((row) =>
        /required value side mismatch for actual paid amount/i.test(row.rule),
      );
      assert.ok(
        anomaly,
        `expected a visible value-side anomaly, got: ${rows.map((row) => row.rule).join("; ")}`,
      );
      assert.equal(anomaly.previousDate, scenario.expectedSide);
      assert.equal(anomaly.laterDate, scenario.actualSide);
    });
  }

  for (const scenario of [
    {
      name: "Capital actual matches Capital-only file",
      payment: { paymentDate: "2026-06-10", actualPaymentCapital: "25" },
      fileValues: { valueCapital: "100", valueRevenue: "0" },
    },
    {
      name: "Revenue actual matches Revenue-only file",
      payment: { paymentDate: "2026-06-10", actualPaymentRevenue: "25" },
      fileValues: { valueCapital: "0", valueRevenue: "100" },
    },
  ]) {
    test(`${type.name}: report accepts the applicable actual component (${scenario.name})`, () => {
      const rows = reportRowsFor(type, scenario.payment, scenario.fileValues);
      assert.equal(
        rows.some((row) => /required value side mismatch for actual paid amount/i.test(row.rule)),
        false,
        `unexpected value-side anomaly: ${rows.map((row) => row.rule).join("; ")}`,
      );
    });
  }
}

test("anomaly report flags applied advance payment with no advance allocation amount", () => {
  const rows = reportRowsFor(
    {
      name: "advance without allocation",
      apply(order) {
        order.advancePayment = "Yes";
        order.advancePaymentDetail = {
          expectedPaymentDate: "2026-06-01",
          stageAmountCapital: "",
          stageAmountRevenue: "",
        };
      },
    },
    {},
  );
  const anomaly = rows.find((row) => row.rule === "Advance Payment is Yes but advance amount is blank");

  assert.ok(anomaly, `expected visible advance allocation anomaly, got: ${rows.map((row) => row.rule).join("; ")}`);
  assert.equal(anomaly.block, "Advance Payment");
});

test("anomaly report accepts an applied advance with an entered allocation amount", () => {
  const rows = reportRowsFor(
    {
      name: "advance with allocation",
      apply(order) {
        order.advancePayment = "Yes";
        order.advancePaymentDetail = {
          expectedPaymentDate: "2026-06-01",
          stageAmountRevenue: "25",
        };
      },
    },
    {},
  );

  assert.equal(
    rows.some((row) => row.rule === "Advance Payment is Yes but advance amount is blank"),
    false,
  );
});
