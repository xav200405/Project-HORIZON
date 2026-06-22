const csrf = document.body.dataset.csrf;
let bundledSketch = null;

function qs(id) { return document.getElementById(id); }
function escapeHtml(value) {
  return String(value).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}

function setBadge(text, tone) {
  const badge = qs("firmwareResultBadge");
  badge.textContent = text;
  badge.className = `badge ${tone || "role"}`;
}

function setLog(text) {
  qs("firmwareLog").textContent = text || "No output.";
}

function activeFqbn() {
  return qs("firmwareCustomBoard").value.trim() || qs("firmwareBoard").value;
}

function updateSelectionLabels() {
  qs("firmwareSelectedPort").textContent = qs("firmwarePort").value || "-";
  qs("firmwareSelectedBoard").textContent = activeFqbn() || "-";
}

function firmwareReady() {
  return !qs("firmwareUploadButton").disabled;
}

async function refreshFirmwareStatus() {
  try {
    const res = await fetch("/api/firmware/status");
    const data = await res.json();
    qs("firmwareCliState").textContent = data.cli_available ? "Ready" : "Missing";
    qs("firmwareCliState").parentElement.classList.toggle("summary-alert", !data.cli_available);
    qs("firmwarePortCount").textContent = String((data.ports || []).length);
    qs("firmwareCliVersion").textContent = data.version || "-";
    qs("firmwareCliPath").textContent = data.cli || "-";
    qs("firmwareMaxUpload").textContent = `${data.max_mb || 0} MB`;
    bundledSketch = (data.bundled_sketches || []).find(item => item.id === "flight_controller_v2_6_1") || null;
    qs("bundledFirmwareLabel").textContent = bundledSketch?.label || "-";
    qs("bundledFirmwareVersion").textContent = bundledSketch?.version || "-";
    qs("bundledFirmwareRevision").textContent = bundledSketch?.revision || "-";

    const portSelect = qs("firmwarePort");
    const previousPort = portSelect.value;
    portSelect.innerHTML = (data.ports || []).map(port =>
      `<option value="${escapeHtml(port.device)}">${escapeHtml(port.device)} - ${escapeHtml(port.description || port.device)}</option>`
    ).join("");
    if (!portSelect.innerHTML) {
      portSelect.innerHTML = '<option value="">No serial ports detected</option>';
    }
    if (previousPort) portSelect.value = previousPort;

    const boardSelect = qs("firmwareBoard");
    const previousBoard = boardSelect.value || data.default_fqbn;
    boardSelect.innerHTML = (data.board_options || []).map(board =>
      `<option value="${escapeHtml(board.fqbn)}">${escapeHtml(board.label)} (${escapeHtml(board.fqbn)})</option>`
    ).join("");
    boardSelect.value = previousBoard || data.default_fqbn;

    qs("firmwarePorts").innerHTML = (data.ports || []).map(port => (
      `<div class="firmware-port"><b>${escapeHtml(port.device)}</b><span>${escapeHtml(port.description || "")}</span><small>${escapeHtml(port.hwid || "")}</small></div>`
    )).join("") || '<div class="firmware-port"><b>No ports</b><span>Connect the Arduino over USB and refresh.</span></div>';

    const disabled = !data.cli_available || !(data.ports || []).length;
    qs("firmwareUploadButton").disabled = disabled;
    qs("flashBundledFirmware").disabled = disabled || !bundledSketch?.available;
    updateSelectionLabels();
  } catch (err) {
    setBadge("Status error", "red");
    setLog(`Unable to read firmware status.\n${err}`);
  }
}

async function uploadFirmware(event) {
  event.preventDefault();
  const file = qs("sketchFile").files[0];
  if (!file) {
    setBadge("Select file", "amber");
    return;
  }
  const form = new FormData(qs("firmwareForm"));
  form.set("fqbn", activeFqbn());
  setBadge("Uploading", "amber");
  setLog("Pausing telemetry serial link, compiling sketch, then uploading firmware...");
  qs("firmwareUploadButton").disabled = true;
  try {
    const res = await fetch("/api/firmware/upload", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: form,
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setBadge("Failed", "red");
      const compile = data.compile?.output || "";
      const upload = data.upload?.output || "";
      setLog(`${data.error || "Firmware upload failed."}\n\n${compile}\n${upload}`.trim());
      return;
    }
    setBadge(qs("compileOnly").checked ? "Compiled" : "Uploaded", "green");
    const compile = data.compile?.output || "Compile completed.";
    const upload = data.upload?.output || "";
    setLog([compile, upload].filter(Boolean).join("\n\n"));
    await refreshFirmwareStatus();
  } catch (err) {
    setBadge("Failed", "red");
    setLog(`Firmware upload request failed.\n${err}`);
  } finally {
    qs("firmwareUploadButton").disabled = false;
  }
}

async function flashBundledFirmware() {
  if (!bundledSketch?.available || !firmwareReady()) return;
  if (!confirm(`Flash ${bundledSketch.label} ${bundledSketch.version || ""} ${bundledSketch.revision || ""} to the selected Arduino?`)) return;
  const form = new FormData();
  form.set("bundled", bundledSketch.id);
  form.set("port", qs("firmwarePort").value);
  form.set("fqbn", activeFqbn());
  if (qs("compileOnly").checked) form.set("compile_only", "1");
  setBadge("Uploading", "amber");
  setLog("Pausing telemetry serial link, compiling bundled flight firmware, then uploading...");
  qs("flashBundledFirmware").disabled = true;
  qs("firmwareUploadButton").disabled = true;
  try {
    const res = await fetch("/api/firmware/upload", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: form,
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setBadge("Failed", "red");
      setLog(`${data.error || "Bundled firmware upload failed."}\n\n${data.compile?.output || ""}\n${data.upload?.output || ""}`.trim());
      return;
    }
    setBadge(qs("compileOnly").checked ? "Compiled" : "Uploaded", "green");
    setLog([data.compile?.output || "Compile completed.", data.upload?.output || ""].filter(Boolean).join("\n\n"));
    await refreshFirmwareStatus();
  } catch (err) {
    setBadge("Failed", "red");
    setLog(`Bundled firmware upload request failed.\n${err}`);
  } finally {
    await refreshFirmwareStatus();
  }
}

qs("firmwareForm").addEventListener("submit", uploadFirmware);
qs("flashBundledFirmware").addEventListener("click", flashBundledFirmware);
qs("refreshFirmwareStatus").addEventListener("click", refreshFirmwareStatus);
qs("firmwarePort").addEventListener("change", updateSelectionLabels);
qs("firmwareBoard").addEventListener("change", updateSelectionLabels);
qs("firmwareCustomBoard").addEventListener("input", updateSelectionLabels);
refreshFirmwareStatus();
