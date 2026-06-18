const role = document.body.dataset.role;
const csrf = document.body.dataset.csrf;
const rmsKillEnabled = Boolean(window.RMS_KILL_ENABLED);
const socket = io();
const history = [];
let activeTab = "Attitude";
let windowSeconds = 60;
let live = true;
let sessionStart = Date.now();
let pidEdit = false;
let pidValues = { kp: 0.150, ki: 0.010, kd: 0.010 };
let lastAnalysis = null;
let missionEvents = [];
let selectedEventId = "live";
let mapScale = 1;
let telemetryPacketCount = 0;
let packetTimes = [];
let networkEvents = [];
let lastTelemetryArrival = 0;

const tabs = {
  Attitude: [["roll", "Roll"], ["pitch", "Pitch"], ["yaw", "Heading"], ["heading_error", "Head err"]],
  Gyro: [["gyro_roll_rate", "Roll rate"], ["gyro_pitch_rate", "Pitch rate"], ["gyro_yaw_rate", "Yaw rate"]],
  Commands: [["roll_cmd", "Roll cmd"], ["pitch_cmd", "Pitch cmd"], ["yaw_cmd", "Yaw cmd"]],
  Motors: [["m1", "M1"], ["m2", "M2"], ["m3", "M3"], ["m4", "M4"]],
  "PID output": [["pid_roll", "Roll"], ["pid_pitch", "Pitch"], ["pid_yaw", "Yaw"]],
  "PID gains": [["pid_roll_p", "Roll P"], ["pid_pitch_p", "Pitch P"], ["pid_yaw_p", "Yaw P"]],
  Compass: [["mag_x", "Mag X"], ["mag_y", "Mag Y"], ["mag_z", "Mag Z"], ["compass_flatline_count", "Flatline"]],
  Battery: [["battery_voltage", "Pack voltage"]],
  "RC input": [["throttle", "Throttle"], ["rc_roll", "Roll"], ["rc_pitch", "Pitch"], ["rc_yaw", "Yaw"]],
  "RC raw": [["ch1", "CH1"], ["ch2", "CH2"], ["ch3", "CH3"], ["ch4", "CH4"], ["ch5", "CH5"], ["ch6", "CH6"]],
  System: [["rx_ok", "RX"], ["imu_ok", "IMU"], ["compass_ok", "Compass"], ["loop_overrun", "Overrun"]],
};
const enabledSeries = new Set();
Object.values(tabs).flat().forEach(([key]) => enabledSeries.add(key));

const chart = new Chart(document.getElementById("telemetryChart"), {
  type: "line",
  data: { datasets: [] },
  options: {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    parsing: false,
    scales: {
      x: { type: "linear", ticks: { callback: v => `${Math.round((Date.now()/1000)-v)}s` } },
      y: { beginAtZero: false },
    },
    plugins: { legend: { display: false }, tooltip: { mode: "nearest", intersect: false } },
  },
});

function qs(id) { return document.getElementById(id); }
function fixed(value, digits) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(digits) : (0).toFixed(digits);
}
function fmt(value, digits = 2) {
  if (typeof value === "number") return fixed(value, digits);
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}
function latestSampleRate() {
  if (history.length < 2) return 0;
  const first = history[Math.max(0, history.length - 20)];
  const last = history[history.length - 1];
  const dt = last.timestamp - first.timestamp;
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
    button.onclick = () => { activeTab = name; renderTabs(); updateChart(); };
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

function updateChart() {
  const now = Date.now() / 1000;
  const minTime = windowSeconds === "full" ? 0 : now - windowSeconds;
  const points = history.filter(p => p.timestamp >= minTime);
  chart.data.datasets = tabs[activeTab]
    .filter(([key]) => enabledSeries.has(key))
    .map(([key, label], index) => ({
      label,
      data: downsample(points.map(p => ({ x: p.timestamp, y: p[key] ?? null }))),
      borderColor: ["#1f6feb", "#138a4b", "#bd1e1e", "#b56b00"][index % 4],
      pointRadius: 0,
      borderWidth: 2,
    }));
  chart.options.scales.x.min = windowSeconds === "full" ? undefined : minTime;
  chart.options.scales.x.max = live ? now : undefined;
  chart.options.scales.y.min = activeTab === "Motors" || activeTab === "RC raw" ? 1000 : activeTab === "Battery" ? 12 : activeTab === "RC input" ? -1 : undefined;
  chart.options.scales.y.max = activeTab === "Motors" || activeTab === "RC raw" ? 2000 : activeTab === "Battery" ? 17 : activeTab === "RC input" ? 1 : undefined;
  chart.update("none");
}

function downsample(points) {
  if (points.length <= 900) return points;
  const stride = Math.ceil(points.length / 900);
  return points.filter((_, i) => i % stride === 0);
}

function updateBattery(data) {
  const valid = data.battery_valid === 1;
  qs("batteryVoltage").textContent = valid ? `${fixed(data.battery_voltage, 2)}V` : "No data";
  qs("cellVoltage").textContent = valid ? `${fixed(data.battery_cell_voltage, 2)}V/cell` : "-- V/cell";
  qs("batterySoc").textContent = `${data.battery_soc ?? 0}%`;
  const fill = qs("socFill");
  fill.style.width = `${Math.max(0, Math.min(100, data.battery_soc ?? 0))}%`;
  fill.style.background = data.battery_soc < 20 ? "#bd1e1e" : data.battery_soc <= 50 ? "#b56b00" : "#138a4b";
  const card = qs("batteryCard");
  card.style.borderColor = data.battery_alarm >= 3 ? "#bd1e1e" : data.battery_alarm >= 1 ? "#b56b00" : "#d8dee9";
  if (data.battery_alarm > 0) showBatteryAlert(data);
}

function showBatteryAlert(data) {
  const names = ["OK", "LOW", "CRITICAL", "EMERGENCY"];
  const banner = qs("alertBanner");
  banner.classList.remove("hidden");
  banner.style.background = data.battery_alarm >= 2 ? "#bd1e1e" : "#b56b00";
  qs("alertTitle").textContent = `Battery ${names[data.battery_alarm]}`;
  qs("alertMessage").textContent = `${fixed(data.battery_voltage, 2)}V pack, ${fixed(data.battery_cell_voltage, 2)}V/cell. Land and inspect power system.`;
  qs("dismissAlert").style.display = data.battery_alarm === 1 ? "inline-block" : "none";
  if (data.battery_alarm >= 2) beep();
}

function beep() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  osc.frequency.value = 880;
  osc.connect(ctx.destination);
  osc.start();
  setTimeout(() => { osc.stop(); ctx.close(); }, 120);
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
  telemetryPacketCount += 1;
  const nowPacket = Date.now() / 1000;
  lastTelemetryArrival = nowPacket;
  packetTimes.push(nowPacket);
  packetTimes = packetTimes.filter(t => nowPacket - t <= 2.0);
  history.push(data);
  while (history.length > 18000) history.shift();
  if (data.marker && !missionEvents.some(event => event.timestamp === data.timestamp && event.label === data.marker)) {
    missionEvents.push({ id: `event-${Date.now()}`, label: data.marker, type: "MARK", timestamp: data.timestamp, snapshot: data });
    missionEvents = missionEvents.slice(-40);
  }
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
  qs("magXValue").textContent = fmt(data.mag_x, 0);
  qs("magYValue").textContent = fmt(data.mag_y, 0);
  qs("magZValue").textContent = fmt(data.mag_z, 0);
  updateSystemState(data);
  updatePidFromTelemetry(data);
  updateFieldCatalog(data);
  updateLiveTelemetryTable(data);
  updateNetworkFromTelemetry(data);
  updateMissionConsole(data);
  qs("rawData").textContent = (data.raw_lines || [data.raw || ""]).join("\n");
  updateBattery(data);
  updateMotors(data);
  updateSticks(data);
  requestAnimationFrame(updateChart);
}

function updateNetworkFromTelemetry(data) {
  qs("networkPacketRate").textContent = `${fixed(livePacketRate(), 1)} Hz`;
  qs("networkPacketAge").textContent = secondsText((Date.now() / 1000) - (data.timestamp || Date.now() / 1000));
  qs("networkLatencyValue").textContent = secondsText((Date.now() / 1000) - (data.timestamp || Date.now() / 1000));
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
    const value = key === "timestamp" ? new Date((data[key] || Date.now() / 1000) * 1000).toLocaleTimeString() : fmt(data[key], 4);
    return `<div class="live-field"><b>${escapeHtml(key)}</b><span>${escapeHtml(value)}</span></div>`;
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
  const connected = socket.connected;
  qs("socketStatusBadge").textContent = connected ? "Connected" : "Disconnected";
  qs("socketStatusBadge").className = `badge ${connected ? "green" : "red"}`;
  qs("socketTransportValue").textContent = socket.io?.engine?.transport?.name || "-";
  qs("browserOnlineValue").textContent = navigator.onLine ? "online" : "offline";
  qs("socketIdValue").textContent = socket.id || "-";
  if (lastTelemetryArrival) {
    qs("networkPacketAge").textContent = secondsText((Date.now() / 1000) - lastTelemetryArrival);
  }
}

function addMissionEvent(label, type, snapshot) {
  const event = {
    id: `event-${Date.now()}-${missionEvents.length}`,
    label,
    type,
    timestamp: Date.now() / 1000,
    snapshot: { ...(snapshot || history[history.length - 1] || {}) },
  };
  missionEvents.push(event);
  missionEvents = missionEvents.slice(-40);
  selectedEventId = event.id;
  renderEventList();
  renderMissionMap(history[history.length - 1] || {});
  return event;
}

function updateMissionConsole(data) {
  const mode = data.armed ? "Airborne" : data.state || "Standby";
  qs("opsModeBadge").textContent = mode;
  qs("opsModeBadge").className = `badge ${data.armed ? "green" : data.lockout ? "red" : "amber"}`;
  qs("missionEventCount").textContent = missionEvents.length;
  qs("missionSamples").textContent = fmt(lastAnalysis?.count ?? history.length, 0);
  qs("missionDuration").textContent = `${fixed(lastAnalysis?.duration_s ?? 0, 0)}s`;
  qs("missionPeakTilt").textContent = `${fixed(Math.max(Math.abs(lastAnalysis?.numeric?.roll?.min ?? 0), Math.abs(lastAnalysis?.numeric?.roll?.max ?? 0), Math.abs(lastAnalysis?.numeric?.pitch?.min ?? 0), Math.abs(lastAnalysis?.numeric?.pitch?.max ?? 0)), 1)} deg`;
  qs("mapHeading").textContent = `${fixed(data.yaw, 1)} deg`;
  qs("mapMotorSpread").textContent = `${motorSpread(data)} us`;
  qs("mapLink").textContent = data.raw ? "Live" : "Sim";
  updateInspector(data);
  renderEventList();
  renderMissionMap(data);
}

function updateInspector(data) {
  const selected = missionEvents.find(event => event.id === selectedEventId);
  const sample = selected?.snapshot || data;
  qs("selectedEventBadge").textContent = selected ? selected.type : "Live";
  qs("inspectorState").textContent = fmt(sample.state);
  qs("inspectorMode").textContent = fmt(sample.mode);
  qs("inspectorRollCmd").textContent = `${fixed(sample.roll_cmd, 1)} deg`;
  qs("inspectorPitchCmd").textContent = `${fixed(sample.pitch_cmd, 1)} deg`;
  qs("inspectorYawCmd").textContent = `${fixed(sample.yaw_cmd, 1)} deg/s`;
  qs("inspectorGimbal").textContent = `${fixed(sample.heading_error ?? sample.pitch ?? 0, 1)} deg`;
  qs("inspectorCompass").textContent = fmt(sample.compass_status);
  qs("inspectorEeprom").textContent = fmt(sample.eeprom);
}

function renderEventList() {
  const list = qs("eventList");
  if (!list) return;
  const recent = missionEvents.slice(-8).reverse();
  list.innerHTML = recent.map((event, index) => {
    const active = event.id === selectedEventId ? " active" : "";
    const label = event.label.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
    return `<button class="event-item${active}" data-event-id="${event.id}"><b>${event.type}</b><span>${label}</span><small>#${missionEvents.length - index}</small></button>`;
  }).join("");
  [...list.querySelectorAll("[data-event-id]")].forEach(button => {
    button.onclick = () => {
      selectedEventId = button.dataset.eventId;
      updateMissionConsole(history[history.length - 1] || {});
    };
  });
}

function routePoints(canvas) {
  const samples = history.slice(-900);
  let x = 0;
  let y = 0;
  const points = [{ x, y, sample: samples[0] || {} }];
  samples.forEach((sample, index) => {
    if (index === 0) return;
    const heading = ((Number(sample.yaw ?? 0) - 90) * Math.PI) / 180;
    const throttle = Number(sample.throttle ?? 0);
    const step = sample.armed ? 1.4 + throttle * 2.2 : 0.35 + throttle * 0.7;
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
    points.push({ x, y, sample });
  });
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs, -40);
  const maxX = Math.max(...xs, 40);
  const minY = Math.min(...ys, -25);
  const maxY = Math.max(...ys, 25);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min(canvas.width / width, canvas.height / height) * 0.68 * mapScale;
  const cx = canvas.width / 2 - ((minX + maxX) / 2) * scale;
  const cy = canvas.height / 2 - ((minY + maxY) / 2) * scale;
  return points.map(point => ({ ...point, px: cx + point.x * scale, py: cy + point.y * scale }));
}

function renderMissionMap(data) {
  const canvas = qs("missionMap");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(600, Math.floor(rect.width * dpr));
  const height = Math.max(320, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, "#223044");
  grad.addColorStop(.42, "#243827");
  grad.addColorStop(1, "#16202b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 48 * dpr) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 80 * dpr, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 42 * dpr) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + 30 * dpr);
    ctx.stroke();
  }

  const points = routePoints(canvas);
  if (points.length > 1) {
    ctx.strokeStyle = "#27d6a3";
    ctx.lineWidth = 4 * dpr;
    ctx.beginPath();
    points.forEach((point, index) => index ? ctx.lineTo(point.px, point.py) : ctx.moveTo(point.px, point.py));
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.setLineDash([5 * dpr, 7 * dpr]);
    ctx.lineWidth = 1 * dpr;
    points.filter((_, index) => index % 90 === 0).forEach(point => {
      ctx.beginPath();
      ctx.moveTo(point.px, point.py);
      ctx.lineTo(point.px, height - 18 * dpr);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  const current = points[points.length - 1] || { px: width / 2, py: height / 2 };
  const yaw = Number(data.yaw ?? 0);
  const angle = ((yaw - 90) * Math.PI) / 180;
  ctx.fillStyle = "rgba(236, 187, 54, .26)";
  ctx.beginPath();
  ctx.moveTo(current.px, current.py);
  ctx.arc(current.px, current.py, 170 * dpr, angle - 0.28, angle + 0.28);
  ctx.closePath();
  ctx.fill();

  missionEvents.slice(-12).forEach((event, index) => {
    const pct = missionEvents.length <= 1 ? 1 : index / Math.max(1, missionEvents.slice(-12).length - 1);
    const point = points[Math.floor(pct * Math.max(0, points.length - 1))] || current;
    ctx.fillStyle = event.type === "ANOM" ? "#bd1e1e" : event.type === "PHOTO" ? "#4da3ff" : "#f4c542";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(point.px, point.py, 7 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `${12 * dpr}px Segoe UI`;
    ctx.fillText(String(index + 1), point.px + 10 * dpr, point.py - 8 * dpr);
  });

  ctx.save();
  ctx.translate(current.px, current.py);
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = "#6cc7ff";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(0, -15 * dpr);
  ctx.lineTo(11 * dpr, 13 * dpr);
  ctx.lineTo(0, 7 * dpr);
  ctx.lineTo(-11 * dpr, 13 * dpr);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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
  qs("eepromValue").textContent = fmt(data.eeprom);
  qs("ledValue").textContent = fmt(data.led);
  qs("lockoutValue").textContent = fmt(data.lockout, 0);
}

function updatePidFromTelemetry(data) {
  if (data.pid_roll_p !== undefined && !pidEdit) {
    pidValues = {
      kp: Number.isFinite(Number(data.pid_roll_p)) ? Number(data.pid_roll_p) : pidValues.kp,
      ki: Number.isFinite(Number(data.pid_roll_i)) ? Number(data.pid_roll_i) : pidValues.ki,
      kd: Number.isFinite(Number(data.pid_roll_d)) ? Number(data.pid_roll_d) : pidValues.kd,
    };
    renderPidGrid();
  }
}

function updateFieldCatalog(data) {
  const priority = [
    "state", "mode", "armed", "lockout", "roll", "pitch", "yaw", "heading_error",
    "gyro_roll_rate", "gyro_pitch_rate", "gyro_yaw_rate", "m1", "m2", "m3", "m4",
    "ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "compass_status", "loop_overrun",
  ];
  const fields = [...new Set([...priority, ...(data.fields || []), ...Object.keys(data)])]
    .filter(key => !["raw", "raw_lines", "timestamp", "fields"].includes(key));
  qs("fieldCatalog").innerHTML = fields.map(key => {
    const value = data[key];
    return `<span class="field-chip"><b>${key}</b><span>${fmt(value, 3)}</span></span>`;
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
  const rows = [["Roll", "kp", "ki", "kd"], ["Pitch", "kp", "ki", "kd"], ["Yaw", "kp", "ki", "kd"]];
  qs("pidGrid").innerHTML = `<b></b><b>Kp</b><b>Ki</b><b>Kd</b>` + rows.map(([axis]) => {
    return `<b>${axis}</b>` + ["kp", "ki", "kd"].map(k => pidEdit ? `<input data-pid="${k}" type="number" step="0.001" value="${pidValues[k].toFixed(3)}">` : `<span>${pidValues[k].toFixed(3)}</span>`).join("");
  }).join("");
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
    const inputs = [...document.querySelectorAll("[data-pid]")];
    const values = Object.fromEntries(inputs.slice(0, 3).map(input => [input.dataset.pid, Number(input.value)]));
    if (!(values.kp >= 0 && values.kp <= 1 && values.ki >= 0 && values.ki <= 0.5 && values.kd >= 0 && values.kd <= 0.5)) {
      qs("pidMessage").textContent = "PID values outside safe range.";
      return;
    }
    await postJson("/api/pid", values);
    pidValues = values;
    pidEdit = false;
    qs("pidMessage").textContent = "Saved";
    togglePidButtons();
    renderPidGrid();
  };
  qs("resetPid").onclick = () => { if (confirm("Reset all PID gains to factory defaults? This will send new values to the UAV.")) postJson("/api/pid", { kp: 0.150, ki: 0.010, kd: 0.010 }); };
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
  qs("pngExport").onclick = () => {
    const a = document.createElement("a");
    a.href = chart.toBase64Image();
    a.download = `tparc_chart_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.png`;
    a.click();
  };
  qs("copyRaw").onclick = () => navigator.clipboard.writeText(qs("rawData").textContent);
  qs("markEvent").onclick = async () => {
    if (role === "viewer") return;
    await postJson("/api/recording/marker", { label: qs("markerLabel").value });
    addMissionEvent(qs("markerLabel").value, "MARK");
    await refreshAnalysis();
  };
  qs("missionMarkPhoto").onclick = async () => {
    if (role === "viewer") return;
    const event = addMissionEvent("Photo point", "PHOTO");
    await postJson("/api/recording/marker", { label: `${event.type}:${event.label}` });
    await refreshAnalysis();
  };
  qs("missionMarkInspect").onclick = async () => {
    if (role === "viewer") return;
    const event = addMissionEvent("Inspection point", "INSP");
    await postJson("/api/recording/marker", { label: `${event.type}:${event.label}` });
    await refreshAnalysis();
  };
  qs("missionMarkAnomaly").onclick = async () => {
    if (role === "viewer") return;
    const event = addMissionEvent("Anomaly point", "ANOM");
    await postJson("/api/recording/marker", { label: `${event.type}:${event.label}` });
    await refreshAnalysis();
  };
  qs("mapZoomIn").onclick = () => { mapScale = clamp(mapScale + 0.2, 0.6, 2.4); renderMissionMap(history[history.length - 1] || {}); };
  qs("mapZoomOut").onclick = () => { mapScale = clamp(mapScale - 0.2, 0.6, 2.4); renderMissionMap(history[history.length - 1] || {}); };
  qs("mapReset").onclick = () => { mapScale = 1; selectedEventId = "live"; renderMissionMap(history[history.length - 1] || {}); renderEventList(); };
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
    qs("missionMarkPhoto").disabled = true;
    qs("missionMarkInspect").disabled = true;
    qs("missionMarkAnomaly").disabled = true;
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
refreshAnalysis();
refreshNetworkState();
setInterval(refreshAnalysis, 5000);
setInterval(refreshNetworkState, 1000);
