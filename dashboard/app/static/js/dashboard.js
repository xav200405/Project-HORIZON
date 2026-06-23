const role = document.body.dataset.role;
const csrf = document.body.dataset.csrf;
const currentView = document.body.dataset.view || "ops";
const rmsKillEnabled = Boolean(window.RMS_KILL_ENABLED);
const socketAvailable = typeof window.io === "function";
const socket = socketAvailable
  ? io()
  : {
      connected: false,
      id: "",
      io: { engine: { transport: { name: "api-poll" } } },
      on() {},
    };
const history = [];
let activeTab = "Power";
let windowSeconds = 60;
let live = true;
let sessionStart = Date.now();
let pidEdit = false;
let pidValues = {
  roll: { kp: 2.000, ki: 0.010, kd: 0.030 },
  pitch: { kp: 2.000, ki: 0.010, kd: 0.030 },
  yaw: { kp: 0.500, ki: 0.000, kd: 0.000 },
};
let pendingPidValues = null;
let pendingPidSentAt = 0;
let lastAnalysis = null;
let telemetryPacketCount = 0;
let packetTimes = [];
let networkEvents = [];
let lastTelemetryArrival = 0;
let lastStateTimestamp = 0;
let lastFallbackSignature = "";
let chartUpdatePending = false;
let lastChartRender = 0;
let lastFieldCatalogRender = 0;
let lastLiveTableRender = 0;
let userSelectedChartTab = false;
let lastBatteryAlarmToneAt = -Infinity;
const CHART_FRAME_MS = 150;
const FIELD_FRAME_MS = 900;
const TABLE_FRAME_MS = 700;
const MAX_HISTORY_POINTS = 7200;
const BATTERY_EMPTY_SCALE_VOLTAGE = 3.70;
const BATTERY_FULL_SCALE_VOLTAGE = 5.00;
const BATTERY_SIGNAL_PRESENT_MIN_VOLTAGE = 0.05;
const BATTERY_LOW_SOC_PERCENT = 20;
const BATTERY_CRITICAL_SOC_PERCENT = 9;
const BATTERY_EMERGENCY_SOC_PERCENT = 0;
const PID_ACK_GRACE_MS = 3500;
const PID_MATCH_EPSILON = 0.00001;

const tabs = {
  Power: [["battery_soc", "Battery %"], ["battery_voltage", "A0 V"]],
  Attitude: [["roll", "Roll"], ["pitch", "Pitch"], ["yaw", "Heading"], ["heading_error", "Head err"]],
  Barometer: [["baro_relative_altitude_m", "Relative alt"], ["baro_altitude_m", "Altitude"], ["baro_pressure_hpa", "Pressure"], ["baro_temperature_c", "Temp"]],
  Motors: [["m1", "M1"], ["m2", "M2"], ["m3", "M3"], ["m4", "M4"]],
  Control: [["throttle", "Throttle"], ["rc_roll", "RC roll"], ["rc_pitch", "RC pitch"], ["rc_yaw", "RC yaw"], ["roll_cmd", "Roll cmd"], ["pitch_cmd", "Pitch cmd"], ["yaw_cmd", "Yaw cmd"]],
  Health: [["rx_ok", "RX"], ["imu_ok", "IMU"], ["compass_ok", "Compass"], ["loop_overrun", "Overrun"]],
};
const enabledSeries = new Set();
Object.values(tabs).flat().forEach(([key]) => enabledSeries.add(key));

const fieldLabels = {
  timestamp: "Received",
  packet_type: "Packet",
  controller_ms: "Controller clock",
  heading_setpoint: "Heading setpoint",
  heading_error: "Heading error",
  heading_lock: "Heading lock",
  gyro_roll_rate: "Gyro roll",
  gyro_pitch_rate: "Gyro pitch",
  gyro_yaw_rate: "Gyro yaw",
  roll_cmd: "Roll command",
  pitch_cmd: "Pitch command",
  yaw_cmd: "Yaw command",
  roll_control_source: "Roll control",
  pitch_control_source: "Pitch control",
  yaw_control_source: "Yaw control",
  pid_roll: "PID roll output",
  pid_pitch: "PID pitch output",
  pid_yaw: "PID yaw output",
  pid_roll_p: "Roll Kp",
  pid_roll_i: "Roll Ki",
  pid_roll_d: "Roll Kd",
  pid_pitch_p: "Pitch Kp",
  pid_pitch_i: "Pitch Ki",
  pid_pitch_d: "Pitch Kd",
  pid_yaw_p: "Yaw Kp",
  pid_yaw_i: "Yaw Ki",
  pid_yaw_d: "Yaw Kd",
  rx_ok: "Receiver",
  imu_ok: "IMU",
  sensors_ok: "Sensors",
  gyro_calibrated: "Gyro calibrated",
  compass_ok: "Compass",
  compass_status: "Compass status",
  compass_driver: "Compass driver",
  compass_chip_id: "Compass chip",
  compass_bad_reason: "Compass fault",
  compass_flatline_count: "Compass flatline",
  baro_ok: "Barometer",
  baro_status: "Barometer status",
  baro_chip_id: "Barometer chip",
  baro_pressure_pa: "Barometer pressure",
  baro_pressure_hpa: "Barometer pressure",
  baro_temperature_c: "Barometer temperature",
  baro_altitude_m: "Barometer altitude",
  baro_relative_altitude_m: "Barometer relative altitude",
  baro_raw_pressure: "Barometer raw pressure",
  baro_raw_temperature: "Barometer raw temperature",
  baro_baseline_raw: "Barometer baseline raw",
  baro_baseline_pressure_pa: "Barometer baseline pressure",
  mag_x: "Mag X",
  mag_y: "Mag Y",
  mag_z: "Mag Z",
  mode_cap: "Mode cap",
  loop_overrun: "Loop overrun",
  motor_front_left: "Motor front left",
  motor_front_right: "Motor front right",
  motor_back_left: "Motor back left",
  motor_back_right: "Motor back right",
  battery_voltage: "A0 voltage",
  battery_monitor_voltage: "A0 voltage",
  battery_cell_voltage: "Legacy battery voltage",
  battery_empty_scale_voltage: "Battery empty scale",
  battery_full_scale_voltage: "Battery full scale",
  battery_monitor_enabled: "Battery monitor",
  battery_adc: "Battery ADC",
  battery_soc: "Battery",
  battery_alarm: "Battery alarm",
  battery_valid: "Battery data",
};

const fieldUnits = {
  roll: "deg",
  pitch: "deg",
  yaw: "deg",
  heading: "deg",
  heading_setpoint: "deg",
  heading_error: "deg",
  gyro_roll_rate: "deg/s",
  gyro_pitch_rate: "deg/s",
  gyro_yaw_rate: "deg/s",
  roll_cmd: "deg/s",
  pitch_cmd: "deg/s",
  yaw_cmd: "deg/s",
  battery_voltage: "V",
  battery_monitor_voltage: "V",
  battery_cell_voltage: "V",
  battery_empty_scale_voltage: "V",
  battery_full_scale_voltage: "V",
  battery_soc: "%",
  baro_pressure_pa: "Pa",
  baro_pressure_hpa: "hPa",
  baro_temperature_c: "C",
  baro_altitude_m: "m",
  baro_relative_altitude_m: "m",
  baro_baseline_pressure_pa: "Pa",
  throttle: "",
  rc_roll: "",
  rc_pitch: "",
  rc_yaw: "",
  m1: "us",
  m2: "us",
  m3: "us",
  m4: "us",
  d6: "us",
  d9: "us",
  d10: "us",
  d11: "us",
  motor_front_left: "us",
  motor_front_right: "us",
  motor_back_left: "us",
  motor_back_right: "us",
  controller_ms: "ms",
};

const booleanFields = new Set([
  "armed", "lockout", "rx_ok", "imu_ok", "sensors_ok", "gyro_calibrated",
  "compass_ok", "baro_ok", "heading_lock", "battery_monitor_enabled", "battery_valid", "loop_overrun",
]);

class TelemetryChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.data = { datasets: [] };
    this.options = { scales: { x: {}, y: {} } };
    this.dpr = window.devicePixelRatio || 1;
    window.addEventListener("resize", () => this.update());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width * this.dpr));
    const height = Math.max(220, Math.floor(rect.height * this.dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return { width, height };
  }

  finitePoints() {
    return this.data.datasets.flatMap(dataset =>
      dataset.data
        .map(point => ({ x: Number(point.x), y: Number(point.y), dataset }))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    );
  }

  bounds(points) {
    const xScale = this.options.scales.x || {};
    const yScale = this.options.scales.y || {};
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const now = Date.now() / 1000;
    const xMin = Number.isFinite(xScale.min) ? xScale.min : (xs.length ? Math.min(...xs) : now - 60);
    const xMax = Number.isFinite(xScale.max) ? xScale.max : (xs.length ? Math.max(...xs) : now);
    let yMin = Number.isFinite(yScale.min) ? yScale.min : (ys.length ? Math.min(...ys) : -1);
    let yMax = Number.isFinite(yScale.max) ? yScale.max : (ys.length ? Math.max(...ys) : 1);
    if (yMin === yMax) {
      const pad = Math.max(1, Math.abs(yMin) * 0.08);
      yMin -= pad;
      yMax += pad;
    } else if (!Number.isFinite(yScale.min) || !Number.isFinite(yScale.max)) {
      const pad = Math.max((yMax - yMin) * 0.12, 0.5);
      if (!Number.isFinite(yScale.min)) yMin -= pad;
      if (!Number.isFinite(yScale.max)) yMax += pad;
    }
    return { xMin, xMax: xMax <= xMin ? xMin + 1 : xMax, yMin, yMax };
  }

  update() {
    const { width, height } = this.resize();
    const ctx = this.ctx;
    const pad = { left: 56 * this.dpr, right: 16 * this.dpr, top: 24 * this.dpr, bottom: 34 * this.dpr };
    const plotW = Math.max(1, width - pad.left - pad.right);
    const plotH = Math.max(1, height - pad.top - pad.bottom);
    const points = this.finitePoints();
    const bounds = this.bounds(points);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1 * this.dpr;
    ctx.font = `${12 * this.dpr}px Segoe UI, Arial`;
    ctx.fillStyle = "#667085";

    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      const value = bounds.yMax - ((bounds.yMax - bounds.yMin) * i) / 4;
      ctx.fillText(formatAxisValue(value), 8 * this.dpr, y + 4 * this.dpr);
    }
    for (let i = 0; i <= 5; i += 1) {
      const x = pad.left + (plotW * i) / 5;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, height - pad.bottom);
      ctx.stroke();
      const value = bounds.xMin + ((bounds.xMax - bounds.xMin) * i) / 5;
      ctx.fillText(`${Math.max(0, Math.round((Date.now() / 1000) - value))}s`, x - 10 * this.dpr, height - 10 * this.dpr);
    }

    if (!points.length) {
      ctx.fillStyle = "#667085";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for telemetry", width / 2, height / 2);
      ctx.textAlign = "left";
      return;
    }

    const toX = value => pad.left + ((value - bounds.xMin) / (bounds.xMax - bounds.xMin)) * plotW;
    const toY = value => pad.top + (1 - ((value - bounds.yMin) / (bounds.yMax - bounds.yMin))) * plotH;
    this.data.datasets.forEach(dataset => {
      const series = dataset.data
        .map(point => ({ x: Number(point.x), y: Number(point.y) }))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
      if (!series.length) return;
      ctx.strokeStyle = dataset.borderColor;
      ctx.lineWidth = (dataset.borderWidth || 2) * this.dpr;
      ctx.beginPath();
      series.forEach((point, index) => {
        const x = toX(point.x);
        const y = toY(point.y);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    let legendX = pad.left;
    this.data.datasets.forEach(dataset => {
      ctx.fillStyle = dataset.borderColor;
      ctx.fillRect(legendX, 7 * this.dpr, 10 * this.dpr, 10 * this.dpr);
      ctx.fillStyle = "#17202a";
      ctx.fillText(dataset.label, legendX + 14 * this.dpr, 16 * this.dpr);
      legendX += (dataset.label.length * 7 + 34) * this.dpr;
    });
  }

  toBase64Image(type = "image/png", quality) {
    return this.canvas.toDataURL(type, quality);
  }
}

const chart = new TelemetryChart(document.getElementById("telemetryChart"));

function qs(id) { return document.getElementById(id); }
function setText(id, value) {
  const el = qs(id);
  if (el) el.textContent = value;
}
function fixed(value, digits) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(digits) : (0).toFixed(digits);
}
function fmt(value, digits = 2) {
  if (typeof value === "number") return fixed(value, digits);
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}
function exportTimestamp() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
}
function dataUrlBytes(dataUrl) {
  const encoded = dataUrl.split(",", 2)[1] || "";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function asciiBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 255;
  return bytes;
}
function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach(part => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}
function pdfText(text) {
  return String(text ?? "").replace(/[\\()]/g, "\\$&").replace(/[\r\n]+/g, " ");
}
function pdfOffset(value) {
  return String(value).padStart(10, "0");
}
function buildChartPdfBlob() {
  chart.update();
  const imageBytes = dataUrlBytes(chart.toBase64Image("image/jpeg", 0.92));
  const pageW = 842;
  const pageH = 595;
  const margin = 36;
  const title = `TP-ARC Telemetry Graph - ${activeTab}`;
  const visibleSeries = (tabs[activeTab] || [])
    .filter(([key]) => enabledSeries.has(key))
    .map(([, label]) => label);
  const subtitle = `${visibleSeries.join(", ") || "No series selected"} | ${qs("chartStatus")?.textContent || "Current view"}`;
  const imageW = pageW - margin * 2;
  const imageH = Math.min(450, imageW * chart.canvas.height / Math.max(1, chart.canvas.width));
  const imageX = margin;
  const imageY = 58;
  const content = [
    "BT /F1 18 Tf 36 560 Td (", pdfText(title), ") Tj ET\n",
    "BT /F1 10 Tf 36 542 Td (", pdfText(subtitle), ") Tj ET\n",
    "BT /F1 9 Tf 36 526 Td (Generated ", pdfText(new Date().toLocaleString()), ") Tj ET\n",
    "q ", fixed(imageW, 2), " 0 0 ", fixed(imageH, 2), " ", fixed(imageX, 2), " ", fixed(imageY, 2), " cm /Im0 Do Q\n",
  ].join("");
  const objects = [
    [asciiBytes("<< /Type /Catalog /Pages 2 0 R >>")],
    [asciiBytes("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")],
    [asciiBytes("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> /XObject << /Im0 5 0 R >> >> /Contents 6 0 R >>")],
    [asciiBytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")],
    [
      asciiBytes(`<< /Type /XObject /Subtype /Image /Width ${chart.canvas.width} /Height ${chart.canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`),
      imageBytes,
      asciiBytes("\nendstream"),
    ],
    [asciiBytes(`<< /Length ${content.length} >>\nstream\n${content}endstream`)],
  ];
  const chunks = [asciiBytes("%PDF-1.4\n")];
  const offsets = [0];
  let position = chunks[0].length;
  objects.forEach((parts, index) => {
    offsets[index + 1] = position;
    const prefix = asciiBytes(`${index + 1} 0 obj\n`);
    const suffix = asciiBytes("\nendobj\n");
    chunks.push(prefix, ...parts, suffix);
    position += prefix.length + parts.reduce((sum, part) => sum + part.length, 0) + suffix.length;
  });
  const xrefStart = position;
  const xref = [
    "xref\n0 7\n",
    "0000000000 65535 f \n",
    ...offsets.slice(1).map(offset => `${pdfOffset(offset)} 00000 n \n`),
    "trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n",
    String(xrefStart),
    "\n%%EOF\n",
  ].join("");
  chunks.push(asciiBytes(xref));
  return new Blob([concatBytes(chunks)], { type: "application/pdf" });
}
function exportChartImage() {
  const blob = dataUrlBytes(chart.toBase64Image());
  downloadBlob(new Blob([blob], { type: "image/png" }), `tparc_chart_${exportTimestamp()}.png`);
}
function exportChartPdf() {
  downloadBlob(buildChartPdfBlob(), `tparc_chart_${exportTimestamp()}.pdf`);
}
function latestSampleRate() {
  if (history.length < 2) return 0;
  const first = history[Math.max(0, history.length - 20)];
  const last = history[history.length - 1];
  const dt = chartTimestamp(last) - chartTimestamp(first);
  return dt > 0 ? (history.length - Math.max(0, history.length - 20) - 1) / dt : 0;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function motorSpread(data) {
  const values = ["m1", "m2", "m3", "m4"].map(key => Number(data[key] ?? 1000));
  return Math.max(...values) - Math.min(...values);
}
function escapeHtml(value) {
  return String(value).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
function secondsText(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return `${fixed(Number(value), Number(value) < 10 ? 2 : 1)}s`;
}
function formatAxisValue(value) {
  const abs = Math.abs(Number(value));
  if (abs >= 1000) return fixed(value, 0);
  if (abs >= 100) return fixed(value, 1);
  return fixed(value, 2);
}
function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function batterySocFromVoltage(voltage, emptyScale, fullScale) {
  const usableRange = fullScale - emptyScale;
  if (!Number.isFinite(voltage) || !Number.isFinite(emptyScale) || !Number.isFinite(fullScale) || usableRange <= 0) return 0;
  return clamp(((voltage - emptyScale) / usableRange) * 100, 0, 100);
}
function batteryAlarmFromSoc(soc) {
  if (!Number.isFinite(soc)) return 0;
  if (soc <= BATTERY_EMERGENCY_SOC_PERCENT) return 3;
  if (soc <= BATTERY_CRITICAL_SOC_PERCENT) return 2;
  if (soc <= BATTERY_LOW_SOC_PERCENT) return 1;
  return 0;
}
function chartTimestamp(row) {
  const received = Number(row?.received_at);
  if (Number.isFinite(received)) return received;
  const timestamp = Number(row?.timestamp);
  return Number.isFinite(timestamp) ? timestamp : Date.now() / 1000;
}
function normalizeTelemetryPacket(data) {
  const receivedAt = Date.now() / 1000;
  const packet = { ...(data || {}) };
  const timestamp = Number(packet.timestamp);
  packet.timestamp = Number.isFinite(timestamp) ? timestamp : receivedAt;
  packet.received_at = receivedAt;
  const voltage = Number(packet.battery_voltage ?? packet.battery_monitor_voltage);
  const emptyScale = Number(packet.battery_empty_scale_voltage ?? BATTERY_EMPTY_SCALE_VOLTAGE);
  const fullScale = Number(packet.battery_full_scale_voltage ?? BATTERY_FULL_SCALE_VOLTAGE);
  if (!Number.isFinite(Number(packet.battery_empty_scale_voltage))) packet.battery_empty_scale_voltage = BATTERY_EMPTY_SCALE_VOLTAGE;
  if (!Number.isFinite(Number(packet.battery_full_scale_voltage))) packet.battery_full_scale_voltage = BATTERY_FULL_SCALE_VOLTAGE;
  if (Number.isFinite(voltage) && voltage >= BATTERY_SIGNAL_PRESENT_MIN_VOLTAGE) {
    packet.battery_voltage = voltage;
    if (!Number.isFinite(Number(packet.battery_monitor_voltage))) packet.battery_monitor_voltage = voltage;
    packet.battery_soc = batterySocFromVoltage(voltage, emptyScale, fullScale);
  }
  return packet;
}
function telemetrySignature(data) {
  const parts = [
    data?.timestamp, data?.raw, data?.controller_ms, data?.roll, data?.pitch, data?.yaw,
    data?.battery_soc, data?.battery_voltage, data?.m1, data?.m2, data?.m3, data?.m4,
    data?.baro_ok, data?.baro_pressure_pa, data?.baro_pressure_hpa, data?.baro_relative_altitude_m, data?.baro_temperature_c,
  ];
  return JSON.stringify(parts);
}
function formatFieldName(key) {
  if (fieldLabels[key]) return fieldLabels[key];
  return String(key)
    .replace(/_/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}
function formatTelemetryValue(key, value) {
  if (key === "timestamp") {
    return new Date((Number(value) || Date.now() / 1000) * 1000).toLocaleTimeString();
  }
  if (value === undefined || value === null || value === "") return "-";
  if (booleanFields.has(key)) return Number(value) ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  const unit = fieldUnits[key];
  const number = Number(value);
  if (Number.isFinite(number) && typeof value !== "string") {
    const digits = Math.abs(number) >= 100 || Number.isInteger(number) ? 0 : 2;
    return unit !== undefined && unit !== "" ? `${fixed(number, digits)} ${unit}` : fixed(number, digits);
  }
  return unit ? `${value} ${unit}` : String(value);
}
function scheduleChartUpdate() {
  if (chartUpdatePending) return;
  chartUpdatePending = true;
  const elapsed = performance.now() - lastChartRender;
  const delay = Math.max(0, CHART_FRAME_MS - elapsed);
  setTimeout(() => {
    requestAnimationFrame(() => {
      chartUpdatePending = false;
      lastChartRender = performance.now();
      updateChart();
    });
  }, delay);
}
function addNetworkEvent(kind, value) {
  networkEvents.push({ kind, value, time: new Date().toLocaleTimeString() });
  networkEvents = networkEvents.slice(-12);
  renderNetworkEvents();
}

function setupTabs() {
  const tabBox = qs("chartTabs");
  Object.keys(tabs).forEach(name => {
    const button = document.createElement("button");
    button.textContent = name;
    button.onclick = () => {
      userSelectedChartTab = true;
      activeTab = name;
      renderTabs();
      updateChart();
    };
    tabBox.appendChild(button);
  });
  renderTabs();
}

function renderTabs() {
  [...qs("chartTabs").children].forEach(btn => btn.classList.toggle("active", btn.textContent === activeTab));
  const series = qs("seriesToggles");
  series.innerHTML = "";
  tabs[activeTab].forEach(([key, label]) => {
    const button = document.createElement("button");
    button.textContent = label;
    button.className = enabledSeries.has(key) ? "active" : "";
    button.onclick = () => {
      enabledSeries.has(key) ? enabledSeries.delete(key) : enabledSeries.add(key);
      renderTabs();
      updateChart();
    };
    series.appendChild(button);
  });
}

function selectedChartSeries(tabName) {
  return (tabs[tabName] || []).filter(([key]) => enabledSeries.has(key));
}

function finiteChartCount(tabName, points) {
  return selectedChartSeries(tabName).reduce((count, [key]) => {
    return count + points.reduce((seriesCount, point) => seriesCount + (numericValue(point[key]) === null ? 0 : 1), 0);
  }, 0);
}

function bestTelemetryTab(points) {
  return Object.keys(tabs).find(name => finiteChartCount(name, points) > 0);
}

function updateChart() {
  const now = Date.now() / 1000;
  const minTime = windowSeconds === "full" ? 0 : now - windowSeconds;
  const points = history.filter(p => chartTimestamp(p) >= minTime);
  if (!userSelectedChartTab && points.length && finiteChartCount(activeTab, points) === 0) {
    const nextTab = bestTelemetryTab(points);
    if (nextTab && nextTab !== activeTab) {
      activeTab = nextTab;
      renderTabs();
    }
  }
  const selectedSeries = selectedChartSeries(activeTab);
  chart.data.datasets = selectedSeries
    .map(([key, label], index) => ({
      label,
      data: downsample(points.map(p => ({ x: chartTimestamp(p), y: numericValue(p[key]) }))),
      borderColor: ["#1f6feb", "#138a4b", "#bd1e1e", "#b56b00"][index % 4],
      pointRadius: 0,
      borderWidth: 2,
    }));
  chart.options.scales.x.min = windowSeconds === "full" ? undefined : minTime;
  chart.options.scales.x.max = live ? now : undefined;
  chart.options.scales.y.min = activeTab === "Motors" ? 1000 : undefined;
  chart.options.scales.y.max = activeTab === "Motors" ? 2000 : undefined;
  const finiteCount = chart.finitePoints().length;
  const status = finiteCount
    ? `${finiteCount} plotted samples in ${windowSeconds === "full" ? "the full recording" : `${windowSeconds}s`}`
    : points.length
      ? `Telemetry received; no ${activeTab} samples in this window`
      : "Waiting for telemetry";
  setText("chartStatus", status);
  chart.update("none");
}

function downsample(points) {
  if (points.length <= 900) return points;
  const stride = Math.ceil(points.length / 900);
  return points.filter((_, i) => i % stride === 0);
}

function updateBattery(data) {
  const voltage = Number(data.battery_voltage);
  const emptyScale = Number(data.battery_empty_scale_voltage ?? BATTERY_EMPTY_SCALE_VOLTAGE);
  const fullScale = Number(data.battery_full_scale_voltage ?? BATTERY_FULL_SCALE_VOLTAGE);
  const packetFields = Array.isArray(data.fields) ? data.fields.map(field => String(field).toLowerCase()) : [];
  const packetIncludesBattery = packetFields.some(field => field.includes("battery") || field === "vbat" || field === "bv");
  const usableRange = fullScale - emptyScale;
  const hasVoltage = Number.isFinite(voltage) && voltage >= BATTERY_SIGNAL_PRESENT_MIN_VOLTAGE;
  const calculatedSoc = hasVoltage && Number.isFinite(emptyScale) && Number.isFinite(fullScale) && usableRange > 0
    ? batterySocFromVoltage(voltage, emptyScale, fullScale)
    : 0;
  const soc = calculatedSoc;
  const monitorEnabled = Number(data.battery_monitor_enabled ?? 0) === 1;
  const valid = Number(data.battery_valid ?? 0) === 1;
  const packetAlarm = Number(data.battery_alarm ?? 0);
  const alarm = hasVoltage ? Math.max(packetAlarm, batteryAlarmFromSoc(soc)) : packetAlarm;
  qs("batteryVoltage").textContent = hasVoltage ? `${fixed(soc, 0)}%` : "No signal";
  qs("cellVoltage").textContent = hasVoltage ? `${fixed(voltage, 2)}V on A0` : "A0 idle";
  qs("batterySoc").textContent = hasVoltage ? `${fixed(soc, 0)}%` : "--";
  const missingTelemetry = packetFields.length > 0 && !packetIncludesBattery && !hasVoltage;
  setText("batteryStatus", hasVoltage
    ? (valid ? `${fixed(emptyScale, 2)}-${fixed(fullScale, 2)}V scale` : "A0 reading outside safe range")
    : missingTelemetry
      ? "No battery field in latest packet"
      : (monitorEnabled ? "A0 enabled, no voltage" : "Monitor inactive"));
  const fill = qs("socFill");
  fill.style.width = `${hasVoltage ? soc : 0}%`;
  fill.style.background = !hasVoltage || soc <= BATTERY_CRITICAL_SOC_PERCENT ? "#bd1e1e" : soc <= BATTERY_LOW_SOC_PERCENT ? "#b56b00" : "#138a4b";
  const card = qs("batteryCard");
  card.classList.toggle("battery-warning", hasVoltage && (alarm > 0 || !valid));
  card.style.borderColor = alarm >= 3 ? "#bd1e1e" : alarm >= 1 || (hasVoltage && !valid) ? "#b56b00" : "#d8dee9";
  if (alarm > 0 && hasVoltage) showBatteryAlert({ ...data, battery_alarm: alarm, battery_soc: soc });
}

function updateBarometer(data) {
  const ok = Number(data.baro_ok ?? 0) === 1;
  const pressurePa = Number(data.baro_pressure_pa);
  const pressureHpa = Number.isFinite(Number(data.baro_pressure_hpa)) ? Number(data.baro_pressure_hpa) : pressurePa / 100.0;
  const altitude = Number(data.baro_altitude_m);
  const relativeAltitude = Number(data.baro_relative_altitude_m);
  const temperature = Number(data.baro_temperature_c);
  const status = fmt(data.baro_status || (ok ? "OK" : "NOT_STARTED"));

  qs("baroRelativeAltitude").textContent = Number.isFinite(relativeAltitude) ? fixed(relativeAltitude, 2) : "--";
  qs("baroPressure").textContent = Number.isFinite(pressureHpa) && pressureHpa > 0 ? fixed(pressureHpa, 1) : "--";
  qs("baroStatus").textContent = ok ? `OK, ${fixed(temperature, 1)} C` : status;
  qs("baroAltitudeValue").textContent = `${fixed(altitude, 2)} m`;
  qs("baroRelativeValue").textContent = `${fixed(relativeAltitude, 2)} m`;
  qs("baroPressureValue").textContent = `${Number.isFinite(pressureHpa) ? fixed(pressureHpa, 1) : "0.0"} hPa`;
  qs("baroTemperatureValue").textContent = `${fixed(temperature, 1)} C`;
  qs("baroSystemStatusValue").textContent = status;

  const card = qs("barometerCard");
  if (card) card.classList.toggle("sensor-warning", !ok);
}

function showBatteryAlert(data) {
  const names = ["OK", "LOW", "CRITICAL", "EMERGENCY"];
  const banner = qs("alertBanner");
  banner.classList.remove("hidden");
  banner.style.background = data.battery_alarm >= 2 ? "#bd1e1e" : "#b56b00";
  qs("alertTitle").textContent = `Battery ${names[data.battery_alarm]}`;
  qs("alertMessage").textContent = data.battery_alarm >= 2
    ? `${fixed(data.battery_soc, 0)}% battery, ${fixed(data.battery_voltage, 2)}V on A0. Critically low battery. Land immediately.`
    : `${fixed(data.battery_soc, 0)}% battery, ${fixed(data.battery_voltage, 2)}V on A0. Low battery warning. Prepare to land.`;
  qs("dismissAlert").style.display = data.battery_alarm === 1 ? "inline-block" : "none";
  playBatteryAlarm(data.battery_alarm);
}

function playBatteryAlarm(level) {
  const now = performance.now();
  const minGap = level >= 2 ? 2500 : 6000;
  if (now - lastBatteryAlarmToneAt < minGap) return;
  lastBatteryAlarmToneAt = now;

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const pattern = level >= 2
    ? [1040, 760, 1040, 760, 1040, 760]
    : [820, 820, 820];
  const pulseSeconds = level >= 2 ? 0.16 : 0.18;
  const gapSeconds = level >= 2 ? 0.08 : 0.12;
  const master = ctx.createGain();
  master.gain.value = level >= 2 ? 0.18 : 0.13;
  master.connect(ctx.destination);

  pattern.forEach((frequency, index) => {
    const start = ctx.currentTime + index * (pulseSeconds + gapSeconds);
    const stop = start + pulseSeconds;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(1.0, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, stop);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(stop + 0.02);
  });

  const totalMs = (pattern.length * (pulseSeconds + gapSeconds) + 0.2) * 1000;
  setTimeout(() => ctx.close(), totalMs);
}

function beep() {
  playBatteryAlarm(1);
}

function updateMotors(data) {
  const box = qs("motorBars");
  box.innerHTML = "";
  const labels = [["m1", "M1 FR / D6"], ["m2", "M2 BR / D9"], ["m3", "M3 BL / D10"], ["m4", "M4 FL / D11"]];
  labels.forEach(([key, label]) => {
    const value = data[key] ?? 1000;
    const pct = Math.max(0, Math.min(100, (value - 1000) / 10));
    const color = value <= 1000 ? "#8792a2" : value >= 1950 ? "#bd1e1e" : value >= 1800 ? "#b56b00" : "#1f6feb";
    const row = document.createElement("div");
    row.className = "motor-row";
    row.innerHTML = `<b>${label}</b><div class="motor-track"><div class="motor-fill" style="width:${pct}%;background:${color}"></div></div><span>${value}</span>`;
    box.appendChild(row);
  });
}

function updateSticks(data) {
  positionDot("leftStick", data.rc_yaw ?? 0, (data.throttle ?? 0) * 2 - 1);
  positionDot("rightStick", data.rc_roll ?? 0, -(data.rc_pitch ?? 0));
  qs("rcThrottle").textContent = fixed(data.throttle, 2);
  qs("rcRoll").textContent = fixed(data.rc_roll, 2);
  qs("rcPitch").textContent = fixed(data.rc_pitch, 2);
  qs("rcYaw").textContent = fixed(data.rc_yaw, 2);
  ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6"].forEach(key => {
    qs(`${key}Value`).textContent = fmt(data[key], 0);
  });
}

function positionDot(id, x, y) {
  const dot = qs(id).querySelector("span");
  dot.style.left = `${50 + x * 45}%`;
  dot.style.top = `${50 + y * 45}%`;
}

function updateTelemetry(data) {
  if (!data) return;
  data = normalizeTelemetryPacket(data);
  lastStateTimestamp = Math.max(lastStateTimestamp, Number(data.timestamp));
  telemetryPacketCount += 1;
  const nowPacket = Date.now() / 1000;
  lastTelemetryArrival = nowPacket;
  packetTimes.push(nowPacket);
  packetTimes = packetTimes.filter(t => nowPacket - t <= 2.0);
  history.push(data);
  while (history.length > MAX_HISTORY_POINTS) history.shift();
  qs("armingBadge").textContent = data.armed ? "Armed" : "Disarmed";
  qs("armingBadge").className = `badge ${data.armed ? "green" : "red"}`;
  qs("headingValue").textContent = fixed(data.yaw, 1);
  qs("headingMode").textContent = data.heading_mode === "COMMAND" ? "Command" : "Hold";
  qs("headingMode").className = `badge ${data.heading_mode === "COMMAND" ? "amber" : "green"}`;
  qs("compassNeedle").style.transform = `rotate(${data.yaw ?? 0}deg)`;
  qs("horizonLine").style.transform = `rotate(${data.roll ?? 0}deg) translateY(${data.pitch ?? 0}px)`;
  qs("rollValue").textContent = fixed(data.roll, 2);
  qs("pitchValue").textContent = fixed(data.pitch, 2);
  qs("sampleRateHz").textContent = fixed(lastAnalysis?.sample_rate_hz ?? latestSampleRate(), 1);
  qs("controllerMs").textContent = fmt(data.controller_ms, 0);
  qs("loopOverrun").textContent = fmt(data.loop_overrun, 0);
  ["Roll", "Pitch", "Yaw", "Setpoint", "HeadingError"].forEach(name => {
    const map = { Roll: ["fusionRoll", data.roll, " deg"], Pitch: ["fusionPitch", data.pitch, " deg"], Yaw: ["fusionYaw", data.yaw, " deg"], Setpoint: ["fusionSetpoint", data.heading_setpoint, " deg"], HeadingError: ["fusionHeadingError", data.heading_error, " deg"] };
    const [id, value, unit] = map[name];
    qs(id).textContent = `${fixed(value, name === "Altitude" ? 1 : 2)}${unit}`;
  });
  qs("fusionMode").textContent = data.heading_mode === "COMMAND" ? "Command" : "Hold";
  qs("gyroRollRate").textContent = `${fixed(data.gyro_roll_rate, 1)} deg/s`;
  qs("gyroPitchRate").textContent = `${fixed(data.gyro_pitch_rate, 1)} deg/s`;
  qs("gyroYawRate").textContent = `${fixed(data.gyro_yaw_rate, 1)} deg/s`;
  updateBarometer(data);
  qs("magXValue").textContent = fmt(data.mag_x, 0);
  qs("magYValue").textContent = fmt(data.mag_y, 0);
  qs("magZValue").textContent = fmt(data.mag_z, 0);
  if (currentView === "telemetry") {
    const uiNow = performance.now();
    if (uiNow - lastFieldCatalogRender >= FIELD_FRAME_MS) {
      lastFieldCatalogRender = uiNow;
      updateFieldCatalog(data);
    }
    if (uiNow - lastLiveTableRender >= TABLE_FRAME_MS) {
      lastLiveTableRender = uiNow;
      updateLiveTelemetryTable(data);
    }
  }
  if (currentView === "telemetry") {
    updateSystemState(data);
  }
  updatePidFromTelemetry(data);
  updateNetworkFromTelemetry(data);
  if (currentView === "ops") updateOverviewSummary(data);
  qs("rawData").textContent = (data.raw_lines || [data.raw || ""]).join("\n");
  updateBattery(data);
  if (currentView === "telemetry") {
    updateMotors(data);
    updateSticks(data);
  }
  if (currentView !== "network") {
    scheduleChartUpdate();
  }
}

function updateNetworkFromTelemetry(data) {
  const age = (Date.now() / 1000) - (data.timestamp || Date.now() / 1000);
  qs("latency").textContent = `${fixed(Math.max(0, age * 1000), 0)} ms`;
  qs("networkPacketRate").textContent = `${fixed(livePacketRate(), 1)} Hz`;
  qs("networkPacketAge").textContent = secondsText(age);
  qs("networkLatencyValue").textContent = secondsText(age);
}

function livePacketRate() {
  if (packetTimes.length < 2) return 0;
  const span = packetTimes[packetTimes.length - 1] - packetTimes[0];
  return span > 0 ? (packetTimes.length - 1) / span : 0;
}

function updateLiveTelemetryTable(data) {
  const table = qs("liveFieldTable");
  if (!table) return;
  const priority = [
    "timestamp", "packet_type", "controller_ms", "state", "mode", "armed", "lockout",
    "battery_monitor_enabled", "battery_soc", "battery_voltage", "battery_monitor_voltage", "battery_empty_scale_voltage", "battery_full_scale_voltage", "battery_alarm", "battery_valid", "battery_adc",
    "baro_ok", "baro_status", "baro_pressure_hpa", "baro_pressure_pa", "baro_temperature_c", "baro_altitude_m", "baro_relative_altitude_m", "baro_raw_pressure", "baro_baseline_raw",
    "roll", "pitch", "yaw", "heading", "heading_setpoint", "heading_error", "heading_lock",
    "gyro_roll_rate", "gyro_pitch_rate", "gyro_yaw_rate", "roll_cmd", "pitch_cmd", "yaw_cmd",
    "pid_roll", "pid_pitch", "pid_yaw", "pid_roll_p", "pid_roll_i", "pid_roll_d",
    "ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "throttle", "rc_roll", "rc_pitch", "rc_yaw",
    "m1", "m2", "m3", "m4", "d6", "d9", "d10", "d11",
    "rx_ok", "imu_ok", "sensors_ok", "gyro_calibrated", "compass_ok", "compass_status",
    "compass_driver", "mag_x", "mag_y", "mag_z", "led", "eeprom", "loop_overrun",
  ];
  const fields = [...new Set([...priority, ...(data.fields || []), ...Object.keys(data)])]
    .filter(key => !["raw_lines", "fields"].includes(key));
  table.innerHTML = fields.map(key => {
    const value = formatTelemetryValue(key, data[key]);
    return `<div class="live-field"><b title="${escapeHtml(key)}">${escapeHtml(formatFieldName(key))}</b><span>${escapeHtml(value)}</span></div>`;
  }).join("");
  qs("livePacketRate").textContent = fixed(livePacketRate(), 1);
  qs("livePacketCount").textContent = String(telemetryPacketCount);
  qs("liveLastPacket").textContent = new Date().toLocaleTimeString();
}

function renderNetworkEvents() {
  const box = qs("networkEvents");
  if (!box) return;
  box.innerHTML = networkEvents.slice().reverse().map(event => (
    `<div class="network-event"><b>${escapeHtml(event.kind)}</b><span>${escapeHtml(event.value)}</span><small>${escapeHtml(event.time)}</small></div>`
  )).join("");
}

function initializeConnectionMode() {
  if (socketAvailable) return;
  qs("connectionBadge").textContent = "API polling";
  qs("connectionBadge").className = "badge amber";
  addNetworkEvent("Browser", "using API polling");
}

async function refreshNetworkState() {
  const serialBadge = qs("serialStatusBadge");
  if (!serialBadge) return;
  try {
    const res = await fetch("/api/network/state");
    if (!res.ok) return;
    const data = await res.json();
    const serialStatus = data.serial_status || "unknown";
    serialBadge.textContent = serialStatus;
    serialBadge.className = `badge ${serialStatus === "connected" ? "green" : serialStatus === "lost" || serialStatus === "error" ? "red" : "amber"}`;
    qs("serialPortValue").textContent = fmt(data.serial_port);
    qs("serialBaudValue").textContent = fmt(data.serial_baud, 0);
    qs("serialAgeValue").textContent = secondsText(data.last_serial_age_s);
    qs("serialPacketsValue").textContent = fmt(data.packets_received, 0);
    qs("serialBytesValue").textContent = fmt(data.bytes_received, 0);
    qs("serialPacketTypeValue").textContent = fmt(data.latest_packet_type);
    qs("serverTimeValue").textContent = new Date((data.server_time || Date.now() / 1000) * 1000).toLocaleTimeString();
    qs("clientTimeValue").textContent = new Date().toLocaleTimeString();
    qs("clockDeltaValue").textContent = secondsText((Date.now() / 1000) - (data.server_time || Date.now() / 1000));
    qs("latestStateAgeValue").textContent = secondsText(data.latest_state_age_s);
    qs("rawLineCountValue").textContent = fmt(data.raw_line_count, 0);
    qs("networkRawLine").textContent = data.last_line || "";
  } catch (_) {
    addNetworkEvent("API", "network state unavailable");
  }
  const connected = socketAvailable && socket.connected;
  qs("socketStatusBadge").textContent = connected ? "Connected" : socketAvailable ? "Disconnected" : "API polling";
  qs("socketStatusBadge").className = `badge ${connected ? "green" : socketAvailable ? "red" : "amber"}`;
  qs("socketTransportValue").textContent = socket.io?.engine?.transport?.name || "-";
  qs("browserOnlineValue").textContent = navigator.onLine ? "online" : "offline";
  qs("socketIdValue").textContent = socket.id || "-";
  if (lastTelemetryArrival) {
    qs("networkPacketAge").textContent = secondsText((Date.now() / 1000) - lastTelemetryArrival);
  }
}

async function hydrateRecentTelemetry() {
  try {
    const res = await fetch("/api/telemetry/recent?seconds=1800&limit=600");
    if (!res.ok) return;
    const data = await res.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const freshRows = rows
      .filter(row => Number.isFinite(Number(row.timestamp)) && Number(row.timestamp) > lastStateTimestamp)
      .slice(-MAX_HISTORY_POINTS);
    if (!freshRows.length) return;
    freshRows.slice(0, -1).forEach(row => history.push(normalizeTelemetryPacket(row)));
    while (history.length > MAX_HISTORY_POINTS) history.shift();
    const latest = freshRows[freshRows.length - 1];
    lastStateTimestamp = Number(latest.timestamp);
    updateTelemetry(latest);
  } catch (_) {
    // Live socket updates or the latest-state fallback can still keep the page useful.
  }
}

async function refreshLatestStateFallback() {
  const now = Date.now() / 1000;
  if (socketAvailable && socket.connected && lastTelemetryArrival && now - lastTelemetryArrival < 3) return;
  try {
    const res = await fetch("/api/state");
    if (!res.ok) return;
    const data = await res.json();
    const timestamp = Number(data.timestamp);
    const signature = telemetrySignature(data);
    if (!Number.isFinite(timestamp)) return;
    if (timestamp <= lastStateTimestamp && signature === lastFallbackSignature) return;
    lastFallbackSignature = signature;
    updateTelemetry(data);
  } catch (_) {
    // Network state polling will surface connection health separately.
  }
}

function updateOverviewSummary(data) {
  const peakTilt = Math.max(
    Math.abs(lastAnalysis?.numeric?.roll?.min ?? Number(data.roll ?? 0)),
    Math.abs(lastAnalysis?.numeric?.roll?.max ?? Number(data.roll ?? 0)),
    Math.abs(lastAnalysis?.numeric?.pitch?.min ?? Number(data.pitch ?? 0)),
    Math.abs(lastAnalysis?.numeric?.pitch?.max ?? Number(data.pitch ?? 0)),
  );
  setText("overviewState", fmt(data.state));
  setText("overviewMode", fmt(data.mode || data.heading_mode));
  setText("overviewSamples", fmt(lastAnalysis?.count ?? history.length, 0));
  setText("overviewPeakTilt", `${fixed(peakTilt, 1)} deg`);
  setText("overviewMotorSpread", `${motorSpread(data)} us`);
}

function updateSystemState(data) {
  qs("systemState").textContent = fmt(data.state);
  qs("flightMode").textContent = fmt(data.mode);
  qs("modeCapValue").textContent = fmt(data.mode_cap, 0);
  qs("rxOkValue").textContent = fmt(data.rx_ok, 0);
  qs("imuOkValue").textContent = fmt(data.imu_ok, 0);
  qs("sensorsOkValue").textContent = fmt(data.sensors_ok, 0);
  qs("gyroCalValue").textContent = fmt(data.gyro_calibrated, 0);
  qs("compassStatusValue").textContent = fmt(data.compass_status);
  qs("compassDriverValue").textContent = fmt(data.compass_driver);
  qs("baroSystemStatusValue").textContent = fmt(data.baro_status);
  qs("eepromValue").textContent = fmt(data.eeprom);
  qs("ledValue").textContent = fmt(data.led);
  qs("lockoutValue").textContent = fmt(data.lockout, 0);
}

function updatePidFromTelemetry(data) {
  if (pidEdit) return;

  const incoming = pidValuesFromPacket(data);
  if (!incoming) return;

  if (pendingPidValues) {
    if (pidValuesMatch(incoming, pendingPidValues) || data?.ack?.startsWith("PID")) {
      pendingPidValues = null;
      pendingPidSentAt = 0;
    } else if ((Date.now() - pendingPidSentAt) < PID_ACK_GRACE_MS) {
      return;
    } else {
      pendingPidValues = null;
      pendingPidSentAt = 0;
      qs("pidMessage").textContent = "No controller ACK; showing latest telemetry";
    }
  }

  pidValues = incoming;
  renderPidGrid();
}

function pidValuesFromPacket(data) {
  if (data?.pid_roll_p === undefined) return null;
  const next = {
    roll: {
      kp: Number(data.pid_roll_p),
      ki: Number(data.pid_roll_i),
      kd: Number(data.pid_roll_d),
    },
    pitch: {
      kp: Number(data.pid_pitch_p),
      ki: Number(data.pid_pitch_i),
      kd: Number(data.pid_pitch_d),
    },
    yaw: {
      kp: Number(data.pid_yaw_p),
      ki: Number(data.pid_yaw_i),
      kd: Number(data.pid_yaw_d),
    },
  };
  return pidValuesInRange(next) ? next : null;
}

function pidValuesMatch(left, right) {
  return ["roll", "pitch", "yaw"].every(axis =>
    ["kp", "ki", "kd"].every(term =>
      Math.abs(Number(left[axis][term]) - Number(right[axis][term])) <= PID_MATCH_EPSILON
    )
  );
}

function updateFieldCatalog(data) {
  const priority = [
    "state", "mode", "armed", "lockout", "battery_monitor_enabled", "battery_soc", "battery_voltage", "battery_monitor_voltage", "battery_empty_scale_voltage", "battery_full_scale_voltage", "battery_alarm", "battery_valid", "roll", "pitch", "yaw", "heading_error",
    "gyro_roll_rate", "gyro_pitch_rate", "gyro_yaw_rate", "m1", "m2", "m3", "m4",
    "ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "compass_status", "loop_overrun",
  ];
  const fields = [...new Set([...priority, ...(data.fields || []), ...Object.keys(data)])]
    .filter(key => !["raw", "raw_lines", "timestamp", "fields"].includes(key));
  qs("fieldCatalog").innerHTML = fields.map(key => {
    const value = data[key];
    return `<span class="field-chip"><b title="${escapeHtml(key)}">${escapeHtml(formatFieldName(key))}</b><span>${escapeHtml(formatTelemetryValue(key, value))}</span></span>`;
  }).join("");
}

async function refreshAnalysis() {
  try {
    const res = await fetch("/api/analysis/summary?seconds=1800");
    if (!res.ok) return;
    lastAnalysis = await res.json();
    qs("analysisSamples").textContent = fmt(lastAnalysis.count, 0);
    qs("analysisRate").textContent = `${fixed(lastAnalysis.sample_rate_hz, 1)} Hz`;
    qs("analysisDuration").textContent = `${fixed(lastAnalysis.duration_s, 0)}s`;
    qs("analysisRoll").textContent = `${fixed(Math.max(Math.abs(lastAnalysis.numeric?.roll?.min ?? 0), Math.abs(lastAnalysis.numeric?.roll?.max ?? 0)), 1)} deg`;
    qs("analysisPitch").textContent = `${fixed(Math.max(Math.abs(lastAnalysis.numeric?.pitch?.min ?? 0), Math.abs(lastAnalysis.numeric?.pitch?.max ?? 0)), 1)} deg`;
    qs("analysisMotorSpread").textContent = `${fmt(lastAnalysis.motor_spread, 0)} us`;
    qs("stateTimeline").innerHTML = Object.entries(lastAnalysis.states || {})
      .map(([state, count]) => `<span class="state-chip">${state}: ${count}</span>`)
      .join("");
  } catch (_) {
    // Keep the live display running if a summary request races startup.
  }
}

function renderPidGrid() {
  const rows = [["Roll", "roll"], ["Pitch", "pitch"], ["Yaw", "yaw"]];
  qs("pidGrid").innerHTML = `<b></b><b>Kp</b><b>Ki</b><b>Kd</b>` + rows.map(([axis]) => {
    const key = axis.toLowerCase();
    return `<b>${axis}</b>` + ["kp", "ki", "kd"].map(term => (
      pidEdit
        ? `<input data-pid-axis="${key}" data-pid-term="${term}" type="number" step="0.001" value="${formatPidValue(pidValues[key][term])}">`
        : `<span>${formatPidValue(pidValues[key][term])}</span>`
    )).join("");
  }).join("");
}

function formatPidValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6).replace(/\.?0+$/, "") : "0";
}

function pidValuesInRange(values) {
  return ["roll", "pitch", "yaw"].every(axis => {
    const item = values[axis] || {};
    return Number.isFinite(item.kp) &&
      Number.isFinite(item.ki) &&
      Number.isFinite(item.kd);
  });
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body || {}) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function setupControls() {
  qs("dismissAlert").onclick = () => qs("alertBanner").classList.add("hidden");
  qs("editPid").onclick = () => { pidEdit = true; togglePidButtons(); renderPidGrid(); };
  qs("cancelPid").onclick = () => { pidEdit = false; togglePidButtons(); renderPidGrid(); };
  qs("sendPid").onclick = async () => {
    const values = JSON.parse(JSON.stringify(pidValues));
    [...document.querySelectorAll("[data-pid-axis][data-pid-term]")].forEach(input => {
      values[input.dataset.pidAxis][input.dataset.pidTerm] = Number(input.value);
    });
    if (!pidValuesInRange(values)) {
      qs("pidMessage").textContent = "PID values must be numeric.";
      return;
    }
    const result = await postJson("/api/pid", values);
    pidValues = result.values || values;
    pendingPidValues = pidValues;
    pendingPidSentAt = Date.now();
    pidEdit = false;
    qs("pidMessage").textContent = "Sent to controller";
    togglePidButtons();
    renderPidGrid();
  };
  qs("resetPid").onclick = async () => {
    if (!confirm("Reset all PID gains to factory defaults? This will send new values to the UAV.")) return;
    const defaults = {
      roll: { kp: 2.000, ki: 0.010, kd: 0.030 },
      pitch: { kp: 2.000, ki: 0.010, kd: 0.030 },
      yaw: { kp: 0.500, ki: 0.000, kd: 0.000 },
    };
    const result = await postJson("/api/pid", defaults);
    pidValues = result.values || defaults;
    pendingPidValues = pidValues;
    pendingPidSentAt = Date.now();
    pidEdit = false;
    qs("pidMessage").textContent = "Factory defaults sent to controller";
    togglePidButtons();
    renderPidGrid();
  };
  qs("killButton").onclick = () => {
    if (!rmsKillEnabled) return;
    qs("confirmKill").showModal();
  };
  qs("confirmKillNo").onclick = () => qs("confirmKill").close();
  qs("confirmKillYes").onclick = async () => {
    if (!rmsKillEnabled) return;
    await postJson("/api/command/kill", {});
    qs("confirmKill").close();
    qs("armingBadge").textContent = "Disarmed";
    qs("armingBadge").className = "badge red";
    qs("alertBanner").classList.remove("hidden");
    qs("alertBanner").style.background = "#bd1e1e";
    qs("alertTitle").textContent = "Emergency kill";
    qs("alertMessage").textContent = "All motors disarmed.";
  };
  qs("csvExport").onclick = () => window.location = "/api/export/csv";
  qs("jsonExport").onclick = () => window.location = "/api/export/json";
  qs("pdfExport").onclick = () => window.location = "/api/export/pdf";
  qs("chartPdfExport").onclick = exportChartPdf;
  qs("pngExport").onclick = exportChartImage;
  qs("copyRaw").onclick = () => navigator.clipboard.writeText(qs("rawData").textContent);
  qs("markEvent").onclick = async () => {
    if (role === "viewer") return;
    await postJson("/api/recording/marker", { label: qs("markerLabel").value });
    await refreshAnalysis();
  };
  qs("copyNetworkRaw").onclick = () => navigator.clipboard.writeText(qs("networkRawLine").textContent);
  [...document.querySelectorAll(".time-windows button[data-window]")].forEach(btn => btn.onclick = () => { windowSeconds = btn.dataset.window === "full" ? "full" : Number(btn.dataset.window); updateChart(); });
  if (!rmsKillEnabled) {
    qs("killButton").disabled = true;
    qs("killButton").title = "RMS kill not commissioned";
  }
  if (role === "viewer") {
    qs("editPid").classList.add("hidden");
    qs("killButton").disabled = true;
    qs("killButton").title = rmsKillEnabled ? "Insufficient permissions" : "RMS kill not commissioned";
    qs("markEvent").disabled = true;
  }
  togglePidButtons();
  renderPidGrid();
}

function togglePidButtons() {
  qs("editPid").classList.toggle("hidden", pidEdit || role === "viewer");
  qs("sendPid").classList.toggle("hidden", !pidEdit);
  qs("cancelPid").classList.toggle("hidden", !pidEdit);
}

socket.on("connect", () => {
  qs("connectionBadge").textContent = "Connected";
  qs("connectionBadge").className = "badge green";
  addNetworkEvent("Socket", `connected ${socket.io?.engine?.transport?.name || ""}`.trim());
  refreshNetworkState();
});
socket.on("disconnect", () => {
  qs("connectionBadge").textContent = "Disconnected";
  qs("connectionBadge").className = "badge red";
  addNetworkEvent("Socket", "disconnected");
  refreshNetworkState();
});
socket.on("telemetry", updateTelemetry);
socket.on("ack", data => {
  if (data?.ack) addNetworkEvent("ACK", data.ack);
  updatePidFromTelemetry(data || {});
  if (data?.ack?.startsWith("PID")) qs("pidMessage").textContent = "Controller acknowledged";
});
socket.on("flight_event", data => {
  if (data?.error) {
    addNetworkEvent("Controller", `ERR:${data.error}`);
    if (data.error.includes("PID")) {
      pendingPidValues = null;
      pendingPidSentAt = 0;
      qs("pidMessage").textContent = `Controller rejected: ${data.error}`;
    }
  } else if (data?.event) {
    addNetworkEvent("Controller", `EVT:${data.event}`);
  }
});
socket.on("link_status", data => {
  if (data.serial === "lost") {
    addNetworkEvent("Serial", "telemetry link lost");
    qs("alertBanner").classList.remove("hidden");
    qs("alertBanner").style.background = "#b56b00";
    qs("alertTitle").textContent = "Telemetry link lost";
    qs("alertMessage").textContent = "No data from flight controller.";
  }
});

setInterval(() => {
  const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
  qs("timer").textContent = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const remaining = Math.max(0, 1800 - elapsed);
  qs("sessionCountdown").textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  if (remaining === 300) {
    qs("alertBanner").classList.remove("hidden");
    qs("alertBanner").style.background = "#b56b00";
    qs("alertTitle").textContent = "Session expires soon";
    qs("alertMessage").textContent = "Click any control to extend.";
  }
}, 1000);

document.addEventListener("click", () => { sessionStart = Date.now(); });
setupTabs();
setupControls();
initializeConnectionMode();
hydrateRecentTelemetry();
refreshAnalysis();
if (currentView === "network") refreshNetworkState();
setInterval(refreshLatestStateFallback, 1000);
setInterval(refreshAnalysis, 15000);
if (currentView === "network") setInterval(refreshNetworkState, 2000);
