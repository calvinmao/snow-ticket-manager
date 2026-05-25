// tests/siebel-note.test.js
// Unit tests for content-gct.js helper logic (not live Siebel DOM).

const assert = require("assert");

// We can't run the full DOM automation in a test (no Siebel page),
// so we test the structural patterns: that content-gct.js is valid JS,
// that the _siebel namespace is properly structured, and that each
// step function exists and returns a Promise.

describe("content-gct.js structure", () => {
  // Test data representing what we'd pass through the automation
  const validParams = {
    srNumber: "1-23642931672",
    activityType: "SR Status - Outbound",
    comments: "Test comment",
    time: 15,
    status: "Done",
  };

  it("content-gct.js parses as valid JavaScript", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "content-gct.js"),
      "utf-8"
    );
    assert.ok(content.length > 100, "content-gct.js should not be empty");
    assert.ok(
      content.includes("window._siebel"),
      "should export window._siebel namespace"
    );
  });

  it("_siebel namespace has all required step functions", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "content-gct.js"),
      "utf-8"
    );
    const required = [
      "navigateToServiceRequests",
      "querySR",
      "drillIntoSR",
      "navigateActivities",
      "createNewActivity",
      "fillActivityForm",
      "uncheckSendEmail",
      "save",
      "logTime",
    ];
    for (const fn of required) {
      assert.ok(
        content.includes(fn + ":"),
        "content-gct.js should define " + fn
      );
    }
  });

  it("panel.js has siebel-note form handler", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "panel.js"),
      "utf-8"
    );
    assert.ok(
      content.includes("siebelCreateActivity"),
      "panel.js should reference siebelCreateActivity action"
    );
    assert.ok(
      content.includes("btn-siebel-create"),
      "panel.js should handle btn-siebel-create click"
    );
  });

  it("background.js has siebelCreateActivity handler", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "background.js"),
      "utf-8"
    );
    assert.ok(
      content.includes('action === "siebelCreateActivity"'),
      "background.js should handle siebelCreateActivity action"
    );
    assert.ok(
      content.includes("findGctTab"),
      "background.js should define findGctTab"
    );
    assert.ok(
      content.includes("injectAndExecGct"),
      "background.js should define injectAndExecGct"
    );
  });

  it("panel.html has siebel-note tab and form elements", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "panel.html"),
      "utf-8"
    );
    assert.ok(
      content.includes('data-tab="siebel-note"'),
      "panel.html should have siebel-note tab button"
    );
    const requiredIds = [
      "siebel-sr",
      "siebel-type",
      "siebel-comments",
      "siebel-time",
      "siebel-status",
      "btn-siebel-create",
      "siebel-result",
    ];
    for (const id of requiredIds) {
      assert.ok(
        content.includes('id="' + id + '"'),
        "panel.html should have element with id=" + id
      );
    }
  });

  it("validParams has all required fields", () => {
    assert.ok(validParams.srNumber, "srNumber is required");
    assert.ok(validParams.activityType, "activityType is required");
    assert.ok(validParams.comments, "comments is required");
    assert.ok(validParams.time > 0, "time should be positive");
    assert.ok(validParams.status, "status is required");
  });
});

describe("content-gct.js Siebel API correctness", () => {
  let content;
  before(() => {
    const fs = require("fs");
    const path = require("path");
    content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "content-gct.js"),
      "utf-8"
    );
  });

  it("uses applet-level NewRecord (not BC-level)", () => {
    // NewRecord MUST be called on the applet, not the BC.
    // bc.InvokeMethod("NewRecord", 1) silently fails — no new record is created.
    // Only applet.InvokeMethod("NewRecord") properly creates a new record
    // in the child BC context with parent linkage set by the BO definition.
    assert.ok(
      content.includes('applet.InvokeMethod("NewRecord")'),
      "createNewActivity should use applet-level InvokeMethod for NewRecord"
    );
    assert.ok(
      content.includes('timeApplet.InvokeMethod("NewRecord")'),
      "logTime should use applet-level InvokeMethod for NewRecord on time applet"
    );
    // Verify no CODE-level bc.InvokeMethod("NewRecord") — comments are ok
    const codeOnly = content.replace(/\/\/.*$/gm, '');
    assert.ok(
      !codeOnly.includes('bc.InvokeMethod("NewRecord"'),
      "should NOT use bc.InvokeMethod for NewRecord in code (silently fails)"
    );
  });

  it("uses InvokeMethod for BC write operations", () => {
    // These BC-level methods use InvokeMethod — direct calls throw "is not a function"
    const invokeMethods = [
      "ClearToQuery",
      "FirstRecord",
      "WriteRecord",
    ];
    for (const method of invokeMethods) {
      assert.ok(
        content.includes('InvokeMethod("' + method + '"'),
        'should use InvokeMethod("' + method + '") for BC operations'
      );
    }
    // SetFieldValue must use DIRECT call, not InvokeMethod.
    // bc.InvokeMethod("SetFieldValue", ...) silently does NOTHING.
    assert.ok(
      content.includes('bc.SetFieldValue('),
      "should use direct bc.SetFieldValue() for field setting (InvokeMethod silently fails)"
    );
  });

  it("uses execCommand for query input, not SetSearchSpec", () => {
    // Query input is typed via document.execCommand('insertText'), not API SetSearchSpec
    assert.ok(
      content.includes('execCommand("insertText"'),
      "should use document.execCommand for typing query input"
    );
    assert.ok(
      !content.includes('InvokeMethod("SetSearchSpec"'),
      "should NOT use SetSearchSpec for queries (silently fails in Siebel Open UI)"
    );
  });

  it("uses applet-level InvokeMethod for query execution", () => {
    // NewQuery and ExecuteQuery must be called on applet, not bc
    assert.ok(
      content.includes("applet.InvokeMethod(\"NewQuery\")"),
      "should call NewQuery at applet level"
    );
    assert.ok(
      content.includes("applet.InvokeMethod(\"ExecuteQuery\")"),
      "should call ExecuteQuery at applet level"
    );
  });

  it("checks for Siebel errors after query and save", () => {
    assert.ok(
      content.includes("GetErrorCount"),
      "should check GetErrorCount after operations"
    );
    assert.ok(
      content.includes("GetErrorMsg"),
      "should check GetErrorMsg for error details"
    );
  });

  it("uses SiebelApp.S_App.GotoView for internal drill-in navigation", () => {
    assert.ok(
      content.includes("SiebelApp.S_App.GotoView"),
      "should use SiebelApp.S_App.GotoView for drill-in (internal AJAX navigation)"
    );
    assert.ok(
      content.includes("Service Request Detail View"),
      "should navigate to Service Request Detail View"
    );
  });

  it("drillIntoSR verifies applets are loaded before resolving", () => {
    // Two-phase polling: first view name, then applet availability
    assert.ok(
      content.includes("viewReady"),
      "should track view readiness phase"
    );
    assert.ok(
      content.includes('FindApplet("Activity List Applet With Navigation")') &&
      content.includes("drillIntoSR"),
      "should verify Activity List Applet is loaded before resolving drill-in"
    );
    assert.ok(
      content.includes("Detail view loaded but applets not ready"),
      "should report meaningful error when view loads but applets don't"
    );
  });

  it("suppresses window.alert and window.confirm to prevent blocking", () => {
    assert.ok(
      content.includes("window.alert") && content.includes("window._siebelDialogs"),
      "should override window.alert to capture dialogs without blocking"
    );
    assert.ok(
      content.includes("window.confirm"),
      "should override window.confirm to auto-accept"
    );
  });

  it("uses correct applet names from live GCT", () => {
    assert.ok(
      content.includes('"Activity Daily Hour Applet"'),
      "should use Activity Daily Hour Applet for time logging (verified in live GCT)"
    );
    assert.ok(
      content.includes('"Activity List Applet With Navigation"'),
      "should use Activity List Applet With Navigation for activity creation"
    );
    // Also accepts alternate names from a11y snapshot
    assert.ok(
      content.includes('"Activities List Applet"'),
      "should accept Activities List Applet as alternate name (from a11y snapshot)"
    );
    assert.ok(
      content.includes('"Time List Applet"'),
      "should accept Time List Applet as alternate name (from a11y snapshot)"
    );
  });

  it("has applet discovery helpers", () => {
    assert.ok(
      content.includes("function findActivitiesApplet"),
      "should define findActivitiesApplet helper"
    );
    assert.ok(
      content.includes("function findFormApplet"),
      "should define findFormApplet helper"
    );
    assert.ok(
      content.includes("function findTimeApplet"),
      "should define findTimeApplet helper"
    );
    // Form applet uses dynamic name discovery via GetAppletMap
    assert.ok(
      content.includes("GetAppletMap") && content.includes("Activity - .* Form Applet"),
      "findFormApplet should discover type-specific form applets via regex on applet map"
    );
  });

  it("uses PM API for field setting with DOM fallback", () => {
    // PM API approach
    assert.ok(
      content.includes("GetPModel"),
      "should use GetPModel to access Presentation Model"
    );
    assert.ok(
      content.includes('ExecuteMethod("GetControl"'),
      "should use PM GetControl to find field controls"
    );
    assert.ok(
      content.includes('ExecuteMethod("LeaveField"'),
      "should try PM LeaveField for form applet field setting"
    );
    assert.ok(
      content.includes('ExecuteMethod("OnCtrlBlur"'),
      "should try PM OnCtrlBlur for list applet field setting"
    );
    assert.ok(
      content.includes("setFieldViaPM"),
      "should define setFieldViaPM helper for PM-level field setting"
    );

    // PM metadata for DOM element discovery
    assert.ok(
      content.includes("findElementViaPM"),
      "should define findElementViaPM helper that uses PM.GetInputName for DOM discovery"
    );
    assert.ok(
      content.includes("GetInputName"),
      "should use control.GetInputName() to find actual HTML element name"
    );

    // Label-based DOM search (Siebel uses <label> elements, NOT aria-label)
    assert.ok(
      content.includes("findInputByLabel"),
      "should define findInputByLabel helper for label-based element discovery"
    );

    // BC SetFieldValue is kept as last-resort fallback
    assert.ok(
      content.includes('bc.SetFieldValue("Description"') || content.includes('bcAfter.SetFieldValue("Description"'),
      "should fall back to bc.SetFieldValue for Description"
    );
    assert.ok(
      content.includes('bc.SetFieldValue("Status"') || content.includes('bcAfter.SetFieldValue("Status"'),
      "should fall back to bc.SetFieldValue for Status"
    );
  });

  it("tracks field setting results per strategy", () => {
    // fillActivityForm tracks which strategy worked for each field
    assert.ok(
      content.includes("results.description") && content.includes("results.status"),
      "should track results for each field separately"
    );
    assert.ok(
      content.includes('"form-pm"') && content.includes('"dom"') && content.includes('"bc"'),
      "should track which strategy (form-pm, dom, or bc) was used"
    );
    // Only uses BC fallback for fields not yet set
    assert.ok(
      content.includes("!results.description"),
      "should only try BC fallback for Description if not already set"
    );
    assert.ok(
      content.includes("!results.status"),
      "should only try BC fallback for Status if not already set"
    );
  });

  it("uses correct Siebel field names (verified in live GCT)", () => {
    // Field names verified via bc.GetFieldValue() in live GCT console:
    //   "Description" (NOT "Comments" — returns empty)
    //   "Status" (LOV field, may have BC-level constraints)
    //   "AVAYA Reported Time Minutes" (NOT "Minutes" which returns empty)
    assert.ok(
      content.includes('SetFieldValue("Description"') ||
      content.includes('GetControl", "Description"'),
      'should use "Description" field for comments (not "Comments")'
    );
    assert.ok(
      content.includes('SetFieldValue("AVAYA Reported Time Minutes"') ||
      content.includes('GetControl", "AVAYA Reported Time Minutes"'),
      'should use "AVAYA Reported Time Minutes" for time field'
    );
    assert.ok(
      !content.includes('SetFieldValue("Activity Type"'),
      'should NOT use "Activity Type" (invalid field name)'
    );
    assert.ok(
      !content.includes('SetFieldValue("Comments"'),
      'should NOT use "Comments" (invalid field name)'
    );
  });

  it("uncheckSendEmail uses PM control iteration and label-based DOM search", () => {
    // Send Email checkbox — uses PM GetControls to find checkbox, then label-based search
    assert.ok(
      content.includes("clickCheckbox"),
      "should use clickCheckbox helper for unchecking"
    );
    // PM-based strategy: iterates GetControls to find Send checkbox by name/UI type
    assert.ok(
      content.includes('pm.Get("GetControls")') && content.includes("GetInputName"),
      "should iterate PM controls and use GetInputName to find checkbox DOM element"
    );
    // Label-based fallback: searches for <label> with "Send" text
    assert.ok(
      content.includes("/send.*(?:update|email)/i"),
      "should search for label text matching Send Update/Send Email pattern"
    );
    // Never rejects — best-effort
    assert.ok(
      content.includes("uncheckSendEmail") && content.includes("Send Email"),
      "uncheckSendEmail should resolve with warning if checkbox not found"
    );
  });
});

describe("background.js navigation and step orchestration", () => {
  let content;
  before(() => {
    const fs = require("fs");
    const path = require("path");
    content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "background.js"),
      "utf-8"
    );
  });

  it("uses pollSiebelReady instead of fixed setTimeout delay", () => {
    assert.ok(
      content.includes("pollSiebelReady"),
      "should define pollSiebelReady function"
    );
    assert.ok(
      content.includes("ActiveViewName"),
      "should poll ActiveViewName for Siebel readiness"
    );
    // Should NOT have fixed setTimeout(resolve, 3000) anymore
    const hasFixedDelay = content.includes("setTimeout(resolve, 3000)")
      || content.includes("setTimeout(resolve,3000)");
    assert.ok(!hasFixedDelay, "should not use fixed 3s delay after navigation");
  });

  it("resets gctInjected flag before polling", () => {
    // After page load, gctInjected must be set to false before polling
    const navListener = content.match(
      /gctInjected\s*=\s*false[\s\S]*?pollSiebelReady/
    );
    assert.ok(navListener, "should reset gctInjected before calling pollSiebelReady");
  });

  it("uses internal GotoView for drill-in instead of URL navigation", () => {
    // Step 3 should use injectAndExecGct (SiebelApp GotoView), not navigateGctTab
    assert.ok(
      content.includes("gctDrillIntoSR"),
      "should reference gctDrillIntoSR step function"
    );
    // The drill-in step should NOT use navigateGctTab with rowIds
    const drillInStep = content.match(
      /Step 3[\s\S]*?injectAndExecGct[\s\S]*?gctDrillIntoSR/
    );
    assert.ok(drillInStep, "step 3 should use injectAndExecGct with gctDrillIntoSR (internal navigation)");
  });

  it("step sequence is in correct order", () => {
    const expectedOrder = [
      "gctNavigateToServiceRequests",
      "gctQuerySR",
      "gctDrillIntoSR",
      "gctNavigateActivities",
      "gctCreateNewActivity",
      "gctFillActivityForm",
      "gctUncheckSendEmail",
      "gctSave",
      "gctLogTime",
    ];

    // Verify each step function is referenced
    for (let i = 0; i < expectedOrder.length; i++) {
      const fnName = expectedOrder[i];
      assert.ok(
        content.includes(fnName),
        fnName + " should be referenced in background.js"
      );
    }

    // Verify save comes before logTime (save must commit parent activity first)
    const savePos = content.indexOf("gctSave");
    const logTimePos = content.indexOf("gctLogTime");
    assert.ok(
      savePos < logTimePos,
      "save step should come before logTime step (parent must be committed first)"
    );
  });
});
