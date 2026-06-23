import json
import time

BATTERY_EMPTY_SCALE_VOLTAGE = 3.70
BATTERY_FULL_SCALE_VOLTAGE = 5.00
BATTERY_SIGNAL_PRESENT_MIN_VOLTAGE = 0.05
BATTERY_LOW_SOC_PERCENT = 20
BATTERY_CRITICAL_SOC_PERCENT = 9
BATTERY_EMERGENCY_SOC_PERCENT = 0

NUMERIC_FIELDS = {
    "R": "roll",
    "P": "pitch",
    "Y": "yaw",
    "MH": "heading_setpoint",
    "M1": "m1",
    "M2": "m2",
    "M3": "m3",
    "M4": "m4",
    "THR": "throttle",
    "RR": "rc_roll",
    "RP": "rc_pitch",
    "RY": "rc_yaw",
    "PROLL": "pid_roll",
    "PPITCH": "pid_pitch",
    "PYAW": "pid_yaw",
    "BV": "battery_voltage",
    "BCELL": "battery_cell_voltage",
    "BSOC": "battery_soc",
    "BALARM": "battery_alarm",
    "BVALID": "battery_valid",
    "ARM": "armed",
    "FS": "failsafe",
    "ALT": "altitude",
    "BARO": "baro_altitude_m",
    "BALT": "baro_relative_altitude_m",
    "BP": "baro_pressure_pa",
    "BHP": "baro_pressure_hpa",
    "BT": "baro_temperature_c",
}

TEXT_FIELDS = {
    "HM": "heading_mode",
    "FW": "firmware_version",
    "REV": "firmware_revision",
}

PID_ACK_FIELDS = {
    "KPR": "pid_roll_p",
    "KIR": "pid_roll_i",
    "KDR": "pid_roll_d",
    "KPP": "pid_pitch_p",
    "KIP": "pid_pitch_i",
    "KDP": "pid_pitch_d",
    "KPY": "pid_yaw_p",
    "KIY": "pid_yaw_i",
    "KDY": "pid_yaw_d",
}

JSON_ALIASES = {
    "ms": "controller_ms",
    "heading": "yaw",
    "headTarget": "heading_setpoint",
    "headErr": "heading_error",
    "headLock": "heading_lock",
    "gyroR": "gyro_roll_rate",
    "gyroP": "gyro_pitch_rate",
    "gyroY": "gyro_yaw_rate",
    "rollCmd": "roll_cmd",
    "pitchCmd": "pitch_cmd",
    "yawCmd": "yaw_cmd",
    "rollSrc": "roll_control_source",
    "pitchSrc": "pitch_control_source",
    "yawSrc": "yaw_control_source",
    "rollOut": "pid_roll",
    "pitchOut": "pid_pitch",
    "yawOut": "pid_yaw",
    "pidRollP": "pid_roll_p",
    "pidRollI": "pid_roll_i",
    "pidRollD": "pid_roll_d",
    "pidPitchP": "pid_pitch_p",
    "pidPitchI": "pid_pitch_i",
    "pidPitchD": "pid_pitch_d",
    "pidYawP": "pid_yaw_p",
    "pidYawI": "pid_yaw_i",
    "pidYawD": "pid_yaw_d",
    "rxOK": "rx_ok",
    "imuOK": "imu_ok",
    "sensorsOK": "sensors_ok",
    "gyroCal": "gyro_calibrated",
    "compassOK": "compass_ok",
    "compassStatus": "compass_status",
    "compassDriver": "compass_driver",
    "compassChipId": "compass_chip_id",
    "compassBadReason": "compass_bad_reason",
    "compassFlatlineCount": "compass_flatline_count",
    "baroOK": "baro_ok",
    "baroStatus": "baro_status",
    "baroChipId": "baro_chip_id",
    "baroPressurePa": "baro_pressure_pa",
    "baroPressureHpa": "baro_pressure_hpa",
    "baroPressureHPa": "baro_pressure_hpa",
    "baroTempC": "baro_temperature_c",
    "baroAltitudeM": "baro_altitude_m",
    "baroRelativeAltitudeM": "baro_relative_altitude_m",
    "baroRawPressure": "baro_raw_pressure",
    "baroRawTemperature": "baro_raw_temperature",
    "baroBaselineRaw": "baro_baseline_raw",
    "baroBaselinePressurePa": "baro_baseline_pressure_pa",
    "pressurePa": "baro_pressure_pa",
    "temperatureC": "baro_temperature_c",
    "altitudeM": "baro_altitude_m",
    "relativeAltitudeM": "baro_relative_altitude_m",
    "magX": "mag_x",
    "magY": "mag_y",
    "magZ": "mag_z",
    "modeCap": "mode_cap",
    "loopOverrun": "loop_overrun",
    "mFL": "motor_front_left",
    "mFR": "motor_front_right",
    "mBL": "motor_back_left",
    "mBR": "motor_back_right",
    "batteryMonitorEnabled": "battery_monitor_enabled",
    "batteryEnabled": "battery_monitor_enabled",
    "batteryVoltage": "battery_voltage",
    "batteryV": "battery_voltage",
    "batteryMonitorVoltage": "battery_monitor_voltage",
    "batteryMonitorV": "battery_monitor_voltage",
    "monitorVoltage": "battery_monitor_voltage",
    "monitorV": "battery_monitor_voltage",
    "battVoltage": "battery_voltage",
    "battV": "battery_voltage",
    "packVoltage": "battery_voltage",
    "packV": "battery_voltage",
    "vbat": "battery_voltage",
    "VBAT": "battery_voltage",
    "batteryCellVoltage": "battery_cell_voltage",
    "batteryCellV": "battery_cell_voltage",
    "cellVoltage": "battery_cell_voltage",
    "cellV": "battery_cell_voltage",
    "batterySOC": "battery_soc",
    "batterySoc": "battery_soc",
    "batteryPercent": "battery_soc",
    "battery_percentage": "battery_soc",
    "battery_percent": "battery_soc",
    "battSoc": "battery_soc",
    "soc": "battery_soc",
    "batteryAlarm": "battery_alarm",
    "battAlarm": "battery_alarm",
    "batteryValid": "battery_valid",
    "batteryOK": "battery_valid",
    "battValid": "battery_valid",
    "batteryAdc": "battery_adc",
    "batteryADC": "battery_adc",
    "batteryEmptyScaleVoltage": "battery_empty_scale_voltage",
    "batteryEmptyScaleV": "battery_empty_scale_voltage",
    "batteryFullScaleVoltage": "battery_full_scale_voltage",
    "batteryFullScaleV": "battery_full_scale_voltage",
    "adc0": "battery_adc",
    "adc0Raw": "battery_adc",
}

JSON_TEXT_FIELDS = {
    "state",
    "mode",
    "led",
    "eeprom",
    "compass_status",
    "compass_driver",
    "baro_status",
    "roll_control_source",
    "pitch_control_source",
    "yaw_control_source",
}

JSON_INT_FIELDS = {
    "armed",
    "lockout",
    "cap",
    "mode_cap",
    "ch1",
    "ch2",
    "ch3",
    "ch4",
    "ch5",
    "ch6",
    "rx_ok",
    "imu_ok",
    "sensors_ok",
    "gyro_calibrated",
    "compass_ok",
    "compass_chip_id",
    "compass_bad_reason",
    "compass_flatline_count",
    "baro_ok",
    "baro_chip_id",
    "baro_raw_pressure",
    "baro_raw_temperature",
    "baro_baseline_raw",
    "battery_monitor_enabled",
    "battery_adc",
    "battery_soc",
    "battery_alarm",
    "battery_valid",
    "failsafe",
    "heading_lock",
    "m1",
    "m2",
    "m3",
    "m4",
    "d6",
    "d9",
    "d10",
    "d11",
    "loop_overrun",
    "controller_ms",
    "motor_front_left",
    "motor_front_right",
    "motor_back_left",
    "motor_back_right",
}


def _number_or_text(value):
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float, str)):
        return value
    return str(value)


def _as_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_axis(value):
    return max(-1.0, min(1.0, (_as_float(value, 1500) - 1500.0) / 500.0))


def _normalize_throttle(value):
    return max(0.0, min(1.0, (_as_float(value, 1000) - 1000.0) / 1000.0))


def _battery_soc_from_voltage(voltage, empty_scale=None, full_scale=None):
    empty = _as_float(empty_scale, BATTERY_EMPTY_SCALE_VOLTAGE)
    full = _as_float(full_scale, BATTERY_FULL_SCALE_VOLTAGE)
    usable_range = full - empty
    if usable_range <= 0.0:
        return 0
    return int(max(0.0, min(100.0, ((voltage - empty) / usable_range) * 100.0)) + 0.5)


def _battery_alarm_from_soc(soc):
    if soc <= BATTERY_EMERGENCY_SOC_PERCENT:
        return 3
    if soc <= BATTERY_CRITICAL_SOC_PERCENT:
        return 2
    if soc <= BATTERY_LOW_SOC_PERCENT:
        return 1
    return 0


def _normalize_battery_payload(payload):
    if "battery_monitor_voltage" in payload and "battery_voltage" not in payload:
        payload["battery_voltage"] = payload["battery_monitor_voltage"]
    if "battery_monitor_voltage" not in payload and "battery_voltage" in payload:
        payload["battery_monitor_voltage"] = payload["battery_voltage"]

    voltage = _as_float(payload.get("battery_voltage"), 0.0)
    has_voltage = voltage >= BATTERY_SIGNAL_PRESENT_MIN_VOLTAGE

    if "battery_empty_scale_voltage" not in payload:
        payload["battery_empty_scale_voltage"] = BATTERY_EMPTY_SCALE_VOLTAGE
    if "battery_full_scale_voltage" not in payload:
        payload["battery_full_scale_voltage"] = BATTERY_FULL_SCALE_VOLTAGE

    if "battery_monitor_enabled" not in payload:
        payload["battery_monitor_enabled"] = 1 if has_voltage else 0
    if "battery_valid" not in payload:
        payload["battery_valid"] = 1 if has_voltage else 0
    packet_includes_alarm = "battery_alarm" in payload
    if not packet_includes_alarm:
        payload["battery_alarm"] = 0
    if has_voltage:
        payload["battery_soc"] = _battery_soc_from_voltage(
            voltage,
            payload.get("battery_empty_scale_voltage"),
            payload.get("battery_full_scale_voltage"),
        )
        payload["battery_alarm"] = max(
            int(_as_float(payload.get("battery_alarm"), 0)),
            _battery_alarm_from_soc(payload["battery_soc"]),
        )
    elif "battery_soc" not in payload:
        payload["battery_soc"] = 0


def _normalize_baro_payload(payload):
    if "baro_pressure_hpa" not in payload and "baro_pressure_pa" in payload:
        payload["baro_pressure_hpa"] = _as_float(payload.get("baro_pressure_pa")) / 100.0
    if "baro_ok" not in payload and "baro_pressure_pa" in payload:
        payload["baro_ok"] = 1 if _as_float(payload.get("baro_pressure_pa")) > 0.0 else 0
    if "baro_status" not in payload:
        payload["baro_status"] = "OK" if payload.get("baro_ok") else "NOT_STARTED"


def _parse_json_packet(raw, event):
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None

    payload = dict(event)
    payload["packet_type"] = "json"
    payload["fields"] = sorted(str(key) for key in data.keys())

    for key, value in data.items():
        field = JSON_ALIASES.get(key, key)
        normalized = _number_or_text(value)
        if field in JSON_INT_FIELDS:
            try:
                normalized = int(float(normalized))
            except (TypeError, ValueError):
                normalized = 0
        elif field not in JSON_TEXT_FIELDS:
            try:
                normalized = float(normalized)
            except (TypeError, ValueError):
                pass
        payload[field] = normalized

    if "heading" in data and "yaw" not in data:
        payload["heading"] = _as_float(data.get("heading"))
    elif "yaw" in payload:
        payload["heading"] = _as_float(payload.get("yaw"))

    if "ch1" in payload:
        payload["rc_roll"] = _normalize_axis(payload["ch1"])
    if "ch2" in payload:
        payload["rc_pitch"] = _normalize_axis(payload["ch2"])
    if "ch3" in payload:
        payload["throttle"] = _normalize_throttle(payload["ch3"])
    if "ch4" in payload:
        payload["rc_yaw"] = _normalize_axis(payload["ch4"])
    if "heading_lock" in payload:
        payload["heading_mode"] = "HOLD" if payload["heading_lock"] else "COMMAND"
    _normalize_battery_payload(payload)
    _normalize_baro_payload(payload)
    return payload


def parse_telemetry_line(line):
    raw = line.strip()
    if not raw:
        return None
    event = {"timestamp": time.time(), "raw": raw}
    if raw.startswith("{") and raw.endswith("}"):
        parsed = _parse_json_packet(raw, event)
        if parsed is not None:
            return parsed
    if raw.startswith("TEL:"):
        payload = dict(event)
        payload["packet_type"] = "tel"
        for chunk in raw[4:].split(","):
            if "=" not in chunk:
                continue
            key, value = chunk.split("=", 1)
            key = key.strip()
            value = value.strip()
            if key in NUMERIC_FIELDS:
                field = NUMERIC_FIELDS[key]
                try:
                    number = float(value)
                    if field in {"m1", "m2", "m3", "m4", "battery_alarm", "battery_valid", "armed", "failsafe", "battery_soc"}:
                        payload[field] = int(number)
                    else:
                        payload[field] = number
                except ValueError:
                    payload[field] = None
            elif key in TEXT_FIELDS:
                payload[TEXT_FIELDS[key]] = value
        _normalize_battery_payload(payload)
        _normalize_baro_payload(payload)
        return payload
    if raw.startswith("EVT:"):
        event["event"] = raw[4:]
        return event
    if raw.startswith("ACK:"):
        ack = raw[4:]
        event["ack"] = ack
        if ack.startswith("PID,"):
            event["packet_type"] = "ack"
            for chunk in ack[4:].split(","):
                if "=" not in chunk:
                    continue
                key, value = chunk.split("=", 1)
                field = PID_ACK_FIELDS.get(key.strip())
                if not field:
                    continue
                try:
                    event[field] = float(value)
                except ValueError:
                    event[field] = None
        return event
    if raw.startswith("ERR:"):
        event["error"] = raw[4:]
        return event
    return event


def default_state():
    return {
        "timestamp": time.time(),
        "roll": 0.0,
        "pitch": 0.0,
        "yaw": 0.0,
        "heading_setpoint": 0.0,
        "heading_mode": "HOLD",
        "heading_error": 0.0,
        "heading_lock": 0,
        "firmware_version": "",
        "firmware_revision": "",
        "packet_type": "",
        "controller_ms": 0,
        "state": "NO_DATA",
        "mode": "-",
        "lockout": 0,
        "cap": 1000,
        "mode_cap": 1000,
        "ch1": 1500,
        "ch2": 1500,
        "ch3": 1000,
        "ch4": 1500,
        "ch5": 1000,
        "ch6": 1000,
        "rx_ok": 0,
        "imu_ok": 0,
        "sensors_ok": 0,
        "gyro_calibrated": 0,
        "compass_ok": 0,
        "compass_status": "NOT_STARTED",
        "compass_driver": "NONE",
        "compass_chip_id": 0,
        "compass_bad_reason": 0,
        "compass_flatline_count": 0,
        "baro_ok": 0,
        "baro_status": "NOT_STARTED",
        "baro_chip_id": 0,
        "baro_pressure_pa": 0.0,
        "baro_pressure_hpa": 0.0,
        "baro_temperature_c": 0.0,
        "baro_altitude_m": 0.0,
        "baro_relative_altitude_m": 0.0,
        "baro_raw_pressure": 0,
        "baro_raw_temperature": 0,
        "baro_baseline_raw": 0,
        "baro_baseline_pressure_pa": 0.0,
        "gyro_roll_rate": 0.0,
        "gyro_pitch_rate": 0.0,
        "gyro_yaw_rate": 0.0,
        "roll_cmd": 0.0,
        "pitch_cmd": 0.0,
        "yaw_cmd": 0.0,
        "roll_control_source": "",
        "pitch_control_source": "",
        "yaw_control_source": "",
        "pid_roll_p": 0.0,
        "pid_roll_i": 0.0,
        "pid_roll_d": 0.0,
        "pid_pitch_p": 0.0,
        "pid_pitch_i": 0.0,
        "pid_pitch_d": 0.0,
        "pid_yaw_p": 0.0,
        "pid_yaw_i": 0.0,
        "pid_yaw_d": 0.0,
        "mag_x": 0,
        "mag_y": 0,
        "mag_z": 0,
        "m1": 1000,
        "m2": 1000,
        "m3": 1000,
        "m4": 1000,
        "d6": 1000,
        "d9": 1000,
        "d10": 1000,
        "d11": 1000,
        "motor_front_left": 1000,
        "motor_front_right": 1000,
        "motor_back_left": 1000,
        "motor_back_right": 1000,
        "throttle": 0.0,
        "rc_roll": 0.0,
        "rc_pitch": 0.0,
        "rc_yaw": 0.0,
        "pid_roll": 0.0,
        "pid_pitch": 0.0,
        "pid_yaw": 0.0,
        "battery_voltage": 0.0,
        "battery_monitor_voltage": 0.0,
        "battery_cell_voltage": 0.0,
        "battery_empty_scale_voltage": BATTERY_EMPTY_SCALE_VOLTAGE,
        "battery_full_scale_voltage": BATTERY_FULL_SCALE_VOLTAGE,
        "battery_monitor_enabled": 0,
        "battery_adc": 0,
        "battery_soc": 0,
        "battery_alarm": 0,
        "battery_valid": 0,
        "armed": 0,
        "failsafe": 0,
        "altitude": 0.0,
        "rate_hz": 400,
        "attitude_hz": 200,
        "outer_hz": 50,
        "led": "NOT_READY",
        "eeprom": "",
        "loop_overrun": 0,
        "fields": [],
        "raw": "",
    }
