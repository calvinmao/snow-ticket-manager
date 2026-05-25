# Alarm INC Quick Close — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Close Alarm" button to the Action tab that chains state transitions (New/In Progress → Service Restored → Resolved → Closed) for alarm INCs in one click.

**Architecture:** New `alarmClose` action in background.js receives ticket number + note text, fetches current state, determines the chain, then PATCHes each state sequentially via existing `updateBySysIdInPage`. Panel.js detects alarm INCs via `contact_type` and shows/hides a conditional UI section with template dropdown, textarea, and Close Alarm button.

**Tech Stack:** Chrome Extension (Manifest V3), vanilla JS, ServiceNow REST API

**Spec:** `docs/superpowers/specs/2026-05-21-alarm-quick-close-design.md`

---

### Task 1: Add alarm close HTML section to Action panel

**Files:**
- Modify: `chrome-extension/panel.html:190-237`

- [ ] **Step 1: Add alarm close section and CSS**

Insert a new section between the ticket number input (line 190) and the state/row-2 div (line 191). Also add a `.btn-success` CSS class to `<style>`.

Add to `<style>` (after line 36, `.btn-danger:hover`):

```css
.btn-success { background: #2e7d32; color: #fff; }
.btn-success:hover { background: #1b5e20; }
.btn-success:disabled { background: #999; cursor: not-allowed; }
```

Add alarm close section in `panel-action` div, after the ticket number form-group (line 190) and before the row-2 state div (line 191):

```html
  <div id="alarm-close-group" style="display:none;margin-bottom:10px;padding:8px;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:4px">
    <div style="font-weight:600;font-size:12px;color:#2e7d32;margin-bottom:6px">Alarm Quick Close</div>
    <div class="form-group">
      <label>Note Template</label>
      <select id="alarm-template">
        <option value="Investigated alarm, confirmed cleared. Closing ticket.">Investigated alarm, confirmed cleared</option>
        <option value="Alarm(s) cleared on access. Verified system restored to normal operation.">Alarms cleared on access</option>
        <option value="False alarm confirmed. No further action required.">False alarm confirmed</option>
        <option value="">Custom</option>
      </select>
    </div>
    <div class="form-group">
      <label>Close Note</label>
      <textarea id="alarm-note" rows="3" placeholder="Enter close note..."></textarea>
    </div>
    <button class="btn btn-success" id="btn-alarm-close" style="width:100%">Close Alarm</button>
  </div>
```

- [ ] **Step 2: Verify no syntax errors**

Reload the extension in chrome://extensions. Open the sidebar, go to Action tab. The alarm section should be hidden (no alarm INC entered yet). Existing Update controls should work as before.

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/panel.html
git commit -m "feat: add alarm close HTML section to Action panel"
```

---

### Task 2: Show/hide alarm section based on contact_type

**Files:**
- Modify: `chrome-extension/panel.js:308-333` (the `refreshActionState` function)

- [ ] **Step 1: Extend refreshActionState to detect alarm INCs**

In `refreshActionState()`, after setting `currentTicketState` (line 314), check `contact_type` and show/hide the alarm section. The ticket is already fetched by `getTicket` which returns all fields.

Replace the function from line 308 to line 333 with:

```javascript
async function refreshActionState(number) {
  if (!number) return;
  try {
    var ticket = await send({ action: "getTicket", ticketNumber: number });
    if (!ticket) { currentTicketState = null; document.getElementById("alarm-close-group").style.display = "none"; return; }
    var raw = typeof ticket.state === "object" ? ticket.state.value : ticket.state;
    currentTicketState = String(raw);
    // Show/hide alarm close section based on contact_type
    var contactType = displayVal(ticket.contact_type);
    var alarmGroup = document.getElementById("alarm-close-group");
    var isAlarm = contactType === "Alarm" && currentTicketState !== "7" && currentTicketState !== "8";
    alarmGroup.style.display = isAlarm ? "block" : "none";
    // Pre-fill template into note
    if (isAlarm) {
      var tmpl = document.getElementById("alarm-template");
      document.getElementById("alarm-note").value = tmpl.value;
    }
    // Update state dropdown to only show allowed transitions
    var allowed = ALLOWED_TRANSITIONS[currentTicketState] || [];
    var options = actionState.querySelectorAll("option");
    for (var i = 0; i < options.length; i++) {
      var val = options[i].value;
      if (!val) {
        options[i].disabled = false;
        continue;
      }
      options[i].disabled = allowed.length > 0 && allowed.indexOf(val) < 0;
      options[i].style.display = allowed.length > 0 && allowed.indexOf(val) < 0 ? "none" : "";
    }
    // Show current state info
    var stateLabel = STATE_LABELS[currentTicketState] || currentTicketState;
    actionResult.innerHTML = '<div style="color:#666;font-size:11px">Current state: ' + esc(stateLabel) + (isAlarm ? ' &mdash; <span style="color:#2e7d32">Alarm INC detected</span>' : '') + '</div>';
  } catch (e) {
    currentTicketState = null;
    document.getElementById("alarm-close-group").style.display = "none";
  }
}
```

- [ ] **Step 2: Add template dropdown change handler**

Add after the `refreshActionState` function (before line 335 `document.getElementById("action-number")...`):

```javascript
document.getElementById("alarm-template").addEventListener("change", function() {
  document.getElementById("alarm-note").value = this.value;
});
```

- [ ] **Step 3: Verify**

Reload extension. Enter an alarm INC number in Action tab → green "Alarm Quick Close" section should appear. Enter a non-alarm INC → section stays hidden. Switch between them to verify toggle.

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat: show/hide alarm close section based on contact_type"
```

---

### Task 3: Add alarmClose handler in background.js

**Files:**
- Modify: `chrome-extension/background.js:165-224` (the `handleMessage` function)

- [ ] **Step 1: Add alarmClose action handler**

Insert a new `if` block before the existing `updateTicket`/`addComment`/`resolveTicket` block (before line 187). This handler fetches the ticket, determines the chain from current state, and executes PATCH calls sequentially.

```javascript
  if (msg.action === "alarmClose") {
    const ticket = await injectAndExec(tab.id, getTicketInPage, [table, msg.ticketNumber]);
    if (!ticket) throw new Error("Ticket " + msg.ticketNumber + " not found");
    const sysId = typeof ticket.sys_id === "object" ? ticket.sys_id.value : ticket.sys_id;
    const rawState = typeof ticket.state === "object" ? ticket.state.value : ticket.state;
    const currentState = String(rawState);

    // Define chain from current state to Closed
    const CHAINS = {
      "1": ["2", "4", "6", "7"],
      "2": ["4", "6", "7"],
      "-5": ["4", "6", "7"],
      "5": ["4", "6", "7"],
      "4": ["6", "7"],
      "6": ["7"]
    };

    if (currentState === "7") throw new Error("Ticket is already closed");
    if (currentState === "8") throw new Error("Cannot close a cancelled ticket");

    const chain = CHAINS[currentState];
    if (!chain) throw new Error("Cannot auto-close from state " + (STATE_LABELS[currentState] || currentState));

    const STATE_NAMES = { "2": "In Progress", "4": "Service Restored", "6": "Resolved", "7": "Closed" };
    const steps = [];
    for (let i = 0; i < chain.length; i++) {
      const targetState = chain[i];
      const stepLabel = STATE_NAMES[targetState] || targetState;
      const fields = { state: targetState };
      if (targetState === "6" || targetState === "7") {
        fields.u_status_reason = "Alarm(s) Cleared on Access";
      }
      if (targetState === "7") {
        fields.work_notes = msg.note;
        fields.u_private_note = msg.note;
        fields.u_resolution_notes = msg.note;
      }
      const updateResult = await injectAndExec(tab.id, updateBySysIdInPage, [table, sysId, fields]);
      if (updateResult && updateResult._error) {
        throw new Error("Step " + (i + 1) + "/" + chain.length + " (" + stepLabel + ") failed: " + updateResult._error);
      }
      steps.push({ state: targetState, label: stepLabel });
    }
    return { success: true, steps, totalSteps: chain.length };
  }
```

Note: `STATE_LABELS` is defined in `panel.js`, not `background.js`. Define the local `STATE_NAMES` map inline as shown above for the chain labels.

- [ ] **Step 2: Verify handler registers**

No syntax errors on extension reload. The handler will be tested in Task 4 when wired to the UI.

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/background.js
git commit -m "feat: add alarmClose handler with sequential state chain"
```

---

### Task 4: Wire Close Alarm button to handler with progress display

**Files:**
- Modify: `chrome-extension/panel.js` (add after the alarm-template handler from Task 2)

- [ ] **Step 1: Add Close Alarm button click handler**

Add this after the `alarm-template` change listener (from Task 2, Step 2) and before the `action-number` change listener:

```javascript
document.getElementById("btn-alarm-close").addEventListener("click", async () => {
  const number = document.getElementById("action-number").value.trim();
  if (!number) return;
  const note = document.getElementById("alarm-note").value.trim();
  if (!note) {
    showError(actionResult, "Enter a close note");
    return;
  }
  const btn = document.getElementById("btn-alarm-close");
  btn.disabled = true;
  showLoading(actionResult);
  try {
    const data = await send({ action: "alarmClose", ticketNumber: number, note });
    // Show step-by-step progress
    let html = "";
    for (let i = 0; i < data.steps.length; i++) {
      html += '<div style="color:#2e7d32;font-size:11px">Step ' + (i + 1) + '/' + data.totalSteps + ': ' + esc(data.steps[i].label) + ' ✓</div>';
    }
    html += '<div class="success">Alarm ticket closed successfully</div>';
    actionResult.innerHTML = html;
    // Refresh state and hide alarm section (ticket is now closed)
    refreshActionState(number);
  } catch (e) {
    showError(actionResult, e.message);
  }
  btn.disabled = false;
});
```

- [ ] **Step 2: End-to-end test**

1. Reload extension
2. Go to Action tab, enter an alarm INC number (one in New or In Progress state)
3. Verify green "Alarm Quick Close" section appears
4. Select a template, verify textarea fills
5. Edit the note if desired
6. Click "Close Alarm"
7. Verify progress shows: Step 1/N: In Progress ✓, Step 2/N: Service Restored ✓, etc.
8. Verify final message: "Alarm ticket closed successfully"
9. Verify alarm section disappears after close (ticket is now Closed)
10. Test with a non-alarm INC → no alarm section shown
11. Test with an already-closed alarm INC → no alarm section shown

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat: wire Close Alarm button with progress display"
```

---

### Task 5: Also show "Close Alarm" option on List tab alarm tickets

**Files:**
- Modify: `chrome-extension/panel.js:218-231` (list ticket card rendering)

- [ ] **Step 1: Add "Close Alarm" jump link to alarm ticket cards in List tab**

In the list ticket card rendering, after the existing "Update Status" jump link and before the closing `</div>` of the links row, add a conditional "Close Alarm" link for alarm INCs.

Find this block (around line 228-230):
```javascript
      html += `<a class="jump-link" data-target="comment" data-ticket="${esc(displayVal(t.number))}" style="color:#293e6b;cursor:pointer;margin-right:12px">+ Add Note</a>`;
      html += `<a class="jump-link" data-target="action" data-ticket="${esc(displayVal(t.number))}" style="color:#293e6b;cursor:pointer">Update Status</a>`;
```

Replace with:
```javascript
      html += `<a class="jump-link" data-target="comment" data-ticket="${esc(displayVal(t.number))}" style="color:#293e6b;cursor:pointer;margin-right:12px">+ Add Note</a>`;
      html += `<a class="jump-link" data-target="action" data-ticket="${esc(displayVal(t.number))}" style="color:#293e6b;cursor:pointer;margin-right:12px">Update Status</a>`;
      if (displayVal(t.contact_type) === "Alarm") html += `<a class="jump-link" data-target="alarm-close" data-ticket="${esc(displayVal(t.number))}" style="color:#2e7d32;cursor:pointer;font-weight:600">Close Alarm</a>`;
```

- [ ] **Step 2: Handle the alarm-close jump link in delegated click handler**

In the existing delegated click handler (around line 96-108), add a new `data-target` case. Find:

```javascript
    } else if (target === "action") {
      document.getElementById("action-number").value = ticket;
      switchTab("action");
      refreshActionState(ticket);
    }
```

After the `refreshActionState(ticket);` line and before the closing `}`, add:

```javascript
    } else if (target === "alarm-close") {
      document.getElementById("action-number").value = ticket;
      switchTab("action");
      // refreshActionState will be triggered by switchTab setting the number
    }
```

- [ ] **Step 3: Verify**

1. Reload extension
2. Go to List tab, ensure alarm INCs show a green "Close Alarm" link
3. Click "Close Alarm" → switches to Action tab, alarm close section appears
4. Non-alarm INCs should NOT show the "Close Alarm" link

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat: add Close Alarm jump link to List tab alarm tickets"
```

---

## Self-Review

**Spec coverage:**
- ✅ UI with template dropdown, textarea, Close Alarm button → Task 1, 2
- ✅ Only shown for `contact_type === "Alarm"` → Task 2
- ✅ Sequential PATCH chain → Task 3
- ✅ State chain from all starting states → Task 3
- ✅ `u_status_reason` on Resolved and Closed → Task 3
- ✅ Work note on Closed step → Task 3
- ✅ Progress display → Task 4
- ✅ Error handling (stop on failure) → Task 3
- ✅ Template presets → Task 1
- ✅ Hidden for closed/cancelled → Task 2

**Placeholder scan:** No TBD/TODO found. All code blocks are complete.

**Type consistency:** `alarmClose` action sends `{ action: "alarmClose", ticketNumber, note }` from panel.js Task 4, matches what background.js Task 3 expects. Chain keys match state values used throughout. `STATE_NAMES` in background.js Task 3 covers all chain targets (2, 4, 6, 7).
