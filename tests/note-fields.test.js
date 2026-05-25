const test = require("node:test");
const assert = require("node:assert/strict");

const { buildCommentFields, formatEffort } = require("../chrome-extension/note-fields.js");

test("public visibility writes comments only", () => {
  const fields = buildCommentFields({
    comment: "Customer-facing update",
    visibility: "public",
    noteType: "Status Update",
    effortMinutes: 15,
  });

  assert.equal(fields.comments, undefined);
  assert.equal(fields.u_public_note, "Customer-facing update");
  assert.equal(fields.work_notes, "Customer-facing update");
  assert.equal(fields.u_private_note, undefined);
  assert.equal(fields.u_wn_public, true);
  assert.equal(fields.u_wn_type, "Status Update");
  assert.equal(fields.u_wn_effort, "1970-01-01 00:15:00");
});

test("internal visibility writes work notes only", () => {
  const fields = buildCommentFields({
    comment: "Internal investigation details",
    visibility: "internal",
  });

  assert.equal(fields.work_notes, "Internal investigation details");
  assert.equal(fields.u_private_note, "Internal investigation details");
  assert.equal(fields.comments, undefined);
  assert.equal(fields.u_public_note, undefined);
  assert.equal(fields.u_wn_public, false);
});

test("formatEffort formats minutes correctly", () => {
  assert.equal(formatEffort(15), "1970-01-01 00:15:00");
  assert.equal(formatEffort(90), "1970-01-01 01:30:00");
  assert.equal(formatEffort(0), null);
  assert.equal(formatEffort(null), null);
});
