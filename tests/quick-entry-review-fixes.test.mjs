import assert from "node:assert/strict";
import test from "node:test";
import { quickEntryHarness, editorHandlers } from "./helpers/quick-entry-review-harness.mjs";
const { env } = await quickEntryHarness();
const order = {
  soNo: "SO1",
  soDate: "2026-04-01",
  stageDelivery: "Yes",
  stagePayment: "Yes",
  stageDeliveryCount: "2",
  stageDeliveries: [
    {
      irPreparationDate: "2026-10-01",
      irReceiptDate: "2026-10-02",
      billPreparationDate: "2026-10-03",
      billSentForPaymentDate: "2026-10-04",
      paymentDate: "2026-10-05",
    },
    {
      irPreparationDate: "2026-11-01",
      irReceiptDate: "2026-11-02",
      billPreparationDate: "2026-11-03",
      billSentForPaymentDate: "2026-11-04",
      paymentDate: "2026-11-05",
    },
  ],
};
const file = {
  id: "f1",
  ir: "Yes",
  fileType: "Goods & Services",
  fileTypeGroup: "goodsServices",
  supplyOrders: [order],
};
test("IR and billing cards derive all-stage completion or the selected stage without parent dates", () => {
  for (const stage of [undefined, ...order.stageDeliveries]) {
    const cards = env.getQuickViewerOrderMilestoneStatuses(file, order, stage);
    for (const label of [
      "IR Preparation",
      "IR Receipt",
      "Bill preparation",
      "Bill sent for payment",
    ]) {
      assert.equal(cards.find((card) => card.label === label)?.status, "Completed", label);
    }
  }
  const partial = { ...order, stageDeliveries: [order.stageDeliveries[0], {}] };
  assert.equal(
    env
      .getQuickViewerOrderMilestoneStatuses(file, partial)
      .find((card) => card.label === "IR Receipt").status,
    "1 of 2 stages complete",
  );
  assert.equal(
    env
      .getQuickViewerOrderMilestoneStatuses(file, partial, {})
      .find((card) => card.label === "IR Receipt").status,
    "Pending",
  );
});
test("common-payment billing cards use parent billing fields while IR remains stage-based", () => {
  const common = { ...order, stagePayment: "No" };
  const cards = env.getQuickViewerOrderMilestoneStatuses(file, common);
  assert.equal(cards.find((card) => card.label === "Bill preparation").status, "Pending");
  assert.equal(cards.find((card) => card.label === "IR Receipt").status, "Completed");
});
test("cancelled S.O. stops incomplete milestones but keeps recorded history", () => {
  const cancelled = {
    ...order,
    soCancelled: "Yes",
    stageDeliveries: [order.stageDeliveries[0], {}],
  };
  const cards = env.getQuickViewerOrderMilestoneStatuses(file, cancelled);
  assert.equal(cards.find((card) => card.label === "Supply Order").status, "Completed");
  assert.equal(cards.find((card) => card.label === "Financial Sanction").status, "Stopped");
  assert.equal(
    cards.find((card) => card.label === "IR Receipt").status,
    "1 of 2 stages complete",
  );
  assert.equal(cards.some((card) => card.status === "Pending"), false);
});
test("shortclosed S.O. with NFA No keeps delivery follow-up active", () => {
  const stage = { dpDate: env.getQuickTodayIsoDate() };
  const continuing = {
    ...order,
    shortclosure: "Yes",
    noFurtherAction: "No",
    stageDeliveries: [stage],
    stageDeliveryCount: "1",
  };
  const continuingProgress = env.getQuickStageDeliveryProgress(file, continuing, [stage]);
  assert.equal(continuingProgress.stopped, 0);
  assert.equal(continuingProgress.dueToday, 1);
  assert.equal(env.getQuickStageStatusLabel(file, continuing, stage), "Due today");

  const stopped = { ...continuing, noFurtherAction: "Yes" };
  const stoppedProgress = env.getQuickStageDeliveryProgress(file, stopped, [stage]);
  assert.equal(stoppedProgress.stopped, 1);
  assert.equal(env.getQuickStageStatusLabel(file, stopped, stage), "Stopped");
});
test("shortclosed S.O. with NFA Yes stops unfinished order milestone cards", () => {
  const stoppedOrder = {
    ...order,
    shortclosure: "Yes",
    noFurtherAction: "Yes",
    stageDeliveries: [{}, {}],
  };
  const cards = env.getQuickViewerOrderMilestoneStatuses(file, stoppedOrder);
  for (const label of ["IR Preparation", "IR Receipt", "Bill preparation", "Payment"]) {
    assert.equal(cards.find((card) => card.label === label)?.status, "Stopped", label);
  }
  assert.equal(cards.some((card) => card.status === "Pending"), false);
});
test("S.O. timeline includes BG receipt and return dates", () => {
  const bgOrder = {
    ...order,
    psbBgReceivedDate: "2026-06-01",
    psbBgReturnDate: "2026-06-10",
    pwbBgReceivedDate: "2026-07-01",
    pwbBgReturnDate: "2026-07-10",
    combinedBgReceivedDate: "2026-08-01",
    combinedBgReturnDate: "2026-08-10",
  };
  const timeline = env.getQuickStatusOrderTimelineItems(file, bgOrder);
  for (const label of [
    "PSB received",
    "PSB returned",
    "PWB received",
    "PWB returned",
    "PSB+PWB received",
    "PSB+PWB returned",
  ]) {
    assert.ok(timeline.some((item) => item.label === label), label);
  }
});
test("Quick Entry recognizes all recorded S.O. numbers, not only the first", () => {
  assert.equal(
    env.getQuickStatusMatchedIdentifier({ soNumbers: "SO1, SO2, GEM3" }, "SO2").value,
    "SO2",
  );
});
test("Job Completion and Bill returned for correction resolve to the supply-order section", () => {
  for (const milestone of ["Job Completion", "Bill returned for correction"]) {
    const destination = env.getQuickEntryStageForCurrentMilestone({ currentMilestone: milestone });
    assert.ok(destination, milestone);
    assert.equal(destination.title, "Supply order and payment");
  }
});
test("Quick Entry cards use completion events instead of meeting dates", () => {
  const today = env.getQuickTodayIsoDate();
  const meetingOnly = {
    id: "milestone-file",
    currentMilestone: "CFA",
    scrutinyDate: today,
    highValue: "Yes",
    highValueMeetingDate: today,
    tcec: "Yes",
    preTcecDate: today,
    postTcecDate: today,
    cncDate: today,
  };
  const statuses = env.getQuickViewerMilestoneStatuses(meetingOnly);
  for (const label of ["Scrutiny", "High Value", "Pre-TCEC", "Post-TCEC", "CNC"]) {
    assert.equal(statuses.find((card) => card.label === label)?.status, "Pending", label);
  }
  const completed = env.getQuickViewerMilestoneStatuses({
    ...meetingOnly,
    scrutinyCompletionDate: today,
    highValueMinutesDate: today,
    preTcecMinutesDate: today,
    postTcecMinutesDate: today,
    cncApprovalDate: today,
  });
  for (const label of ["Scrutiny", "High Value", "Pre-TCEC", "Post-TCEC", "CNC"]) {
    assert.equal(completed.find((card) => card.label === label)?.status, "Completed", label);
  }
});
test("Quick Entry meeting cards complete only on or before today", () => {
  const today = env.getQuickTodayIsoDate();
  const future = new Date(`${today}T00:00:00`);
  future.setDate(future.getDate() + 1);
  const futureDate = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
  const futureStatuses = env.getQuickViewerMilestoneStatuses({
    currentMilestone: "CFA",
    preBidMeeting: "Yes",
    preBidMeetingDate: futureDate,
    refloat: "Yes",
    refloatPreBidMeeting: "Yes",
    refloatPreBidMeetingDate: futureDate,
  });
  for (const label of ["Pre-Bid Meeting", "Refloat Pre-Bid Meeting"]) {
    assert.equal(futureStatuses.find((card) => card.label === label)?.status, "Pending", label);
  }
  const pastStatuses = env.getQuickViewerMilestoneStatuses({
    currentMilestone: "CFA",
    preBidMeeting: "Yes",
    preBidMeetingDate: today,
    refloat: "Yes",
    refloatPreBidMeeting: "Yes",
    refloatPreBidMeetingDate: today,
  });
  for (const label of ["Pre-Bid Meeting", "Refloat Pre-Bid Meeting"]) {
    assert.equal(pastStatuses.find((card) => card.label === label)?.status, "Completed", label);
  }
});
test("Delivery Period remains in the order timeline but not the completion cards", () => {
  const orderWithDeliveryPeriod = { ...order, dpDate: env.getQuickTodayIsoDate() };
  const cards = env.getQuickViewerOrderMilestoneStatuses(file, orderWithDeliveryPeriod);
  assert.equal(cards.some((card) => card.label === "Delivery Period"), false);
  assert.ok(
    env
      .getQuickStatusOrderTimelineItems(file, orderWithDeliveryPeriod)
      .some((item) => item.label === "D.P."),
  );
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function saveHarness() {
  const pending = deferred();
  let calls = 0;
  const { env, evaluate } = await quickEntryHarness({
    context: { file: { id: "A" }, statuses: [] },
    contextRef: { current: { file: { id: "A" }, statuses: [] } },
    contextRevision: { current: 0 },
    statusDraft: "Original",
    statusDraftRef: { current: "Original" },
    editingStatusId: "s1",
    editingStatusText: "Edit original",
    editingStatusRef: { current: { id: "s1", text: "Edit original" } },
    statusSaveBusy: { current: false },
    canCreateFileStatus: true,
    createFileStatusUpdate: () => {
      calls++;
      return pending.promise;
    },
    updateFileStatusUpdate: () => {
      calls++;
      return pending.promise;
    },
  });
  for (const key of [
    "context",
    "statusDraft",
    "editingStatusId",
    "editingStatusText",
    "savingStatus",
    "lookupMessage",
  ]) {
    env[`set${key[0].toUpperCase() + key.slice(1)}`] = (value) => {
      env[key] = typeof value === "function" ? value(env[key]) : value;
    };
  }
  evaluate(
    editorHandlers(["saveStatus", "saveEditedStatus", "clearStatusContext"]) +
      "\nglobalThis.handlers={saveStatus,saveEditedStatus,clearStatusContext};",
  );
  return { env, pending, calls: () => calls };
}
test("File Status saves reject repeated clicks and preserve text typed after submission", async () => {
  const { env, pending, calls } = await saveHarness();
  const saving = env.handlers.saveStatus();
  await env.handlers.saveStatus();
  assert.equal(calls(), 1);
  assert.equal(env.savingStatus, true);
  env.statusDraft = "New text";
  env.statusDraftRef.current = "New text";
  pending.resolve({ statuses: [{ id: "s2" }] });
  await saving;
  assert.equal(env.statusDraft, "New text");
  assert.equal(env.context.statuses[0].id, "s2");
  assert.equal(env.savingStatus, false);
});
test("an old save response cannot restore a previous file or clear a different file draft", async () => {
  for (const action of ["saveStatus", "saveEditedStatus"]) {
    const { env, pending } = await saveHarness();
    const saving = env.handlers[action]("s1");
    env.handlers.clearStatusContext();
    env.context = { file: { id: "B" }, statuses: [] };
    env.contextRef.current = env.context;
    env.statusDraft = "B draft";
    env.statusDraftRef.current = "B draft";
    pending.resolve({ statuses: [{ id: "A-status" }] });
    await saving;
    assert.equal(env.context.file.id, "B");
    assert.equal(env.context.statuses.length, 0);
    assert.equal(env.statusDraft, "B draft");
  }
});
