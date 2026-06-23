from pathlib import Path
import ast
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
CAL = ROOT / "firmware" / "calibration_wizard" / "CalibrationWizard" / "CalibrationWizard.ino"
DASH = ROOT / "dashboard" / "app"
JS = DASH / "static" / "js" / "dashboard.js"


def active_flight_sketch():
    preferred = ROOT / "firmware" / "flight_controller" / "controller_firmware_v2.6.ino"
    if preferred.exists():
        return preferred
    flight_root = ROOT / "firmware" / "flight_controller"
    candidates = sorted(
        flight_root.glob("**/*.ino"),
        key=lambda path: (path.parent.name != path.stem, str(path)),
    )
    return candidates[0] if candidates else flight_root / "controller_firmware" / "controller_firmware.ino"


FLIGHT = active_flight_sketch()


def read(path):
    return path.read_text(encoding="utf-8")


def check(name, condition, details=""):
    status = "PASS" if condition else "FAIL"
    print(f"{status} {name}{': ' + details if details else ''}")
    return bool(condition)


def require(pattern, text, flags=0):
    return re.search(pattern, text, flags) is not None


def main():
    ok = True

    ok &= check("flight firmware file exists", FLIGHT.exists(), str(FLIGHT))
    ok &= check("calibration wizard file exists", CAL.exists(), str(CAL))
    ok &= check(
        "flight sketch path is recognized",
        FLIGHT.parent.name == FLIGHT.stem or FLIGHT == ROOT / "firmware" / "flight_controller" / "controller_firmware_v2.6.ino",
        str(FLIGHT),
    )
    ok &= check("calibration sketch folder matches file name", CAL.parent.name == CAL.stem)
    if not ok:
        return 1

    flight = read(FLIGHT)
    cal = read(CAL)
    js = read(JS)
    py_files = list((ROOT / "dashboard" / "app").glob("*.py")) + [ROOT / "dashboard" / "run.py"]
    all_project_text = "\n".join(
        read(path)
        for path in [
            FLIGHT,
            CAL,
            ROOT / "README.md",
            ROOT / "docs" / "requirements_matrix.md",
            ROOT / "firmware" / "README.md",
            ROOT / "docs" / "SAFETY_ADVISORY.md",
        ]
    )

    flight_checks = [
        ("flight source is YMFC safety baseline", r"YMFC Flight Controller"),
        ("flight source version marker", r"YMFC Flight Controller - Arduino Uno Safety Baseline"),
        ("flight uses Wire", r"#include\s+<Wire\.h>"),
        ("flight uses EEPROM", r"#include\s+<EEPROM\.h>"),
        ("flight uses math helpers", r"#include\s+<math\.h>"),
        ("flight latest PCB roll pin D7", r"CH1 Roll\s*=\s*D7"),
        ("flight latest PCB pitch pin D8", r"CH2 Pitch\s*=\s*D8"),
        ("flight latest PCB throttle pin D5", r"CH3 Throttle\s*=\s*D5"),
        ("flight latest PCB yaw pin D4", r"CH4 Yaw\s*=\s*D4"),
        ("flight latest PCB mode pin D3", r"CH5 Mode\s*=\s*D3"),
        ("flight latest PCB lockout pin D12", r"CH6 Lockout\s*=\s*D12"),
        ("flight has receiver failsafe", r"failsafe"),
        ("flight has serial telemetry", r"telemetry", re.I),
        ("flight has MPU6050 support", r"MPU6050"),
        ("flight has proportional heading hold", r"HEADING_HOLD_P_GAIN|HEADING_HOLD_MAX_RATE_DPS|headingHoldRateFromError|updateHeadingHoldFromYawStick", re.S),
        ("flight core build removes barometer task", r"setupBarometer|updateBarometer|BARO_UPDATE_INTERVAL_MS|baroPressurePa", re.S),
    ]
    for item in flight_checks:
        name, pattern, *flags = item
        condition = require(pattern, flight, flags[0] if flags else 0)
        if name == "flight has proportional heading hold":
            condition = all(token in flight for token in (
                "HEADING_HOLD_P_GAIN",
                "HEADING_HOLD_MAX_RATE_DPS",
                "headingHoldRateFromError",
                "updateCompass",
                "updateHeadingHoldFromYawStick",
            ))
        if "removes" in name:
            condition = not condition
        ok &= check(name, condition)

    cal_checks = [
        ("calibration source is setup module v6.5", r"Setup Module v6\.5 CPP FIXED"),
        ("calibration stores EEPROM with put", r"EEPROM\.put"),
        ("calibration has packed setup struct", r"packed setup struct|struct", re.I),
        ("calibration has signature/version/checksum", r"signature.*version.*checksum", re.I | re.S),
        ("calibration validates receiver before calibration", r"receiver alive/range validation|receiver.*validation", re.I | re.S),
        ("calibration latest PCB roll pin D7", r"CH1 Roll\s*=\s*D7"),
        ("calibration latest PCB pitch pin D8", r"CH2 Pitch\s*=\s*D8"),
        ("calibration latest PCB throttle pin D5", r"CH3 Throttle\s*=\s*D5"),
        ("calibration latest PCB yaw pin D4", r"CH4 Yaw\s*=\s*D4"),
        ("calibration latest PCB mode pin D3", r"CH5 Mode\s*=\s*D3"),
        ("calibration latest PCB lockout pin D12", r"CH6 Lockout\s*=\s*D12"),
        ("calibration has gyro offset calibration", r"gyro offset calibration|gyro", re.I),
        ("calibration has BMP280 baseline", r"BMP280"),
        ("calibration has compass baseline", r"compass"),
    ]
    for item in cal_checks:
        name, pattern, *flags = item
        ok &= check(name, require(pattern, cal, flags[0] if flags else 0))

    dash_checks = [
        ("WebSocket telemetry", r"socket\.on\(\"telemetry\""),
        ("telemetry chart renderer", r"new\s+(TelemetryChart|Chart)"),
        ("series toggles", r"enabledSeries"),
        ("barometer chart tab", r"Barometer:"),
        ("barometer RMS display", r"function updateBarometer"),
        ("battery uses usable voltage window", r"BATTERY_EMPTY_SCALE_VOLTAGE\s*=\s*3\.70.*batterySocFromVoltage", re.S),
        ("battery low alarm tone", r"BATTERY_LOW_SOC_PERCENT\s*=\s*20.*playBatteryAlarm", re.S),
        ("battery critical alarm tone", r"BATTERY_CRITICAL_SOC_PERCENT\s*=\s*9.*Critically low battery", re.S),
        ("chart auto-selects populated telemetry tab", r"function bestTelemetryTab"),
        ("chart distinguishes empty tab from no telemetry", r"Telemetry received; no .* samples in this window"),
        ("API fallback allows changed stable-timestamp telemetry", r"lastFallbackSignature"),
        ("downsampling", r"function downsample"),
        ("PID UI accepts unrestricted numeric gains", r"Number\.isFinite\(item\.kp\).*Number\.isFinite\(item\.ki\).*Number\.isFinite\(item\.kd\)", re.S),
        ("PID UI sends axis-specific gains", r"data-pid-axis"),
        ("PID UI updates from ACK packets", r"socket\.on\(\"ack\".*updatePidFromTelemetry", re.S),
        ("PID UI holds pending values until ACK", r"pendingPidValues.*PID_ACK_GRACE_MS.*pidValuesMatch", re.S),
        ("kill confirmation dialog", r"confirmKill"),
        ("RMS kill UI disabled state", r"RMS kill not commissioned"),
        ("viewer RBAC controls", r"role === \"viewer\""),
        ("CSV export", r"/api/export/csv"),
        ("PNG export", r"toBase64Image"),
        ("session warning", r"remaining === 300"),
    ]
    for item in dash_checks:
        name, pattern, *flags = item
        ok &= check(name, require(pattern, js, flags[0] if flags else 0))

    dashboard_text = "\n".join(read(path) for path in DASH.rglob("*") if path.is_file() and path.suffix in {".py", ".html", ".js"})
    dashboard_project_checks = [
        ("PID route sends full axis command", r"KPR=.*KIR=.*KDR=.*KPP=.*KIP=.*KDP=.*KPY=.*KIY=.*KDY=", re.S),
        ("PID route preserves fine tuning precision", r"KPR=\{values\['roll'\]\['kp'\]:\.6f\}"),
        ("RMS kill disabled by default", r"RMS_KILL_ENABLED=os\.environ\.get\(\"TPARC_RMS_KILL_ENABLED\"\)\s*==\s*\"1\""),
        ("RMS kill route guarded", r"if not current_app\.config\[\"RMS_KILL_ENABLED\"\].*RMS_KILL_DISABLED", re.S),
        ("RMS kill disabled template text", r"RMS kill is disabled; use transmitter CH6"),
    ]
    for item in dashboard_project_checks:
        name, pattern, *flags = item
        ok &= check(name, require(pattern, dashboard_text, flags[0] if flags else 0))

    ok &= check(
        "flight handles v2.6 incremental PID tuning",
        require(r"void handleSerialTuning", flight)
        and require(r"void adjustGain", flight)
        and require(r"PID_TUNE_STEP\s+0\.01f", flight)
        and require(r"case 'r': adjustGain\(pid_p_gain_roll", flight)
        and require(r"case 'Y': adjustGain\(pid_d_gain_yaw", flight)
        and require(r"void printGains", flight),
    )
    ok &= check(
        "flight PID tuning has no firmware gain-range rejection",
        "pidCommandValuesValid" not in flight
        and "ERR:PID_RANGE" not in flight
    )
    ok &= check(
        "flight restored angle self-level roll/pitch control",
        require(r"MAX_ANGLE_DEG", flight)
        and require(r"MAX_PID_OUTPUT", flight)
        and require(r"MAX_YAW_OUTPUT", flight)
        and require(r"roll_cmd = pilotStickCurve\(rollStick\) \* MAX_ANGLE_DEG", flight)
        and require(r"pitch_cmd = pilotStickCurve\(pitchStick\) \* MAX_ANGLE_DEG", flight)
        and require(r"float rollError = roll_cmd - angle_roll", flight)
        and require(r"float pitchError = pitch_cmd - angle_pitch", flight)
        and require(r"pid_i_mem_roll = constrainFloat\(pid_i_mem_roll, -MAX_LEVEL_I_OUTPUT, MAX_LEVEL_I_OUTPUT\)", flight)
        and require(r"pid_output_roll = constrainFloat\(pid_output_roll, -MAX_PID_OUTPUT, MAX_PID_OUTPUT\)", flight),
    )
    ok &= check(
        "flight transmitter axes use EEPROM calibration",
        require(r"uint16_t calibrateReceiverPulse", flight)
        and require(r"uint16_t calibrateCenteredAxis", flight)
        and require(r"cal\.rxMin\[channelIndex\].*cal\.rxCenter\[channelIndex\].*cal\.rxMax\[channelIndex\]", flight, re.S)
        and require(r"ch\[i\]\s*=\s*calibrateReceiverPulse\(i, raw\[i\]\)", flight)
        and require(r"rollStick\s*=\s*stickAxisFromPulse\(ch\[0\]\)", flight)
        and require(r"pitchStick\s*=\s*stickAxisFromPulse\(ch\[1\]\)", flight)
        and require(r"yawStick\s*=\s*stickAxisFromPulseWithDeadband\(ch\[3\], YAW_STICK_DEADBAND_US\)", flight)
        and require(r"yaw_cmd = \(\(float\)yawStick / 500\.0f\) \* MAX_YAW_RATE_DPS", flight),
    )
    ok &= check(
        "flight heading hold yields to transmitter yaw",
        require(r"if \(yawStick != 0\).*clearHeadingLock\(\)", flight, re.S)
        and require(r"updateHeadingHoldFromYawStick\(yawStick\)", flight),
    )
    ok &= check(
        "flight heading hold uses proportional drift correction",
        require(r"HEADING_HOLD_P_GAIN\s+1\.60f", flight)
        and require(r"HEADING_HOLD_DEADBAND_DEG\s+3\.0f", flight)
        and require(r"HEADING_HOLD_SOFT_ZONE_DEG", flight)
        and require(r"heading_deviation \+= headingStep", flight)
        and require(r"heading_error = -heading_deviation", flight)
        and require(r"yaw_cmd = headingHoldRateFromError\(heading_error\)", flight)
        and "HEADING_STEP_DEG" not in flight,
    )
    ok &= check(
        "flight telemetry emits v2.6 JSON control state",
        require(r"void printTelemetryJson", flight)
        and all(token in flight for token in (
            'Serial.print(F("{\\"ms\\":"));',
            'Serial.print(F(",\\"headLock\\":"));',
            'Serial.print(F(",\\"pidRollP\\":"));',
            'Serial.print(F(",\\"mFL\\":"));',
        )),
    )
    ok &= check(
        "flight v2.6 has no onboard battery monitor",
        "BATTERY_PERCENT_EMPTY_V" not in flight
        and "BATTERY_DEFAULT_LOW_PERCENT" not in flight
        and "\"battery" not in flight,
    )

    for py_file in py_files:
        try:
            ast.parse(read(py_file))
            ok &= check(f"python syntax {py_file.relative_to(ROOT)}", True)
        except SyntaxError as exc:
            ok &= check(f"python syntax {py_file.relative_to(ROOT)}", False, str(exc))

    parser_file = DASH / "telemetry.py"
    namespace = {}
    exec(compile(read(parser_file), str(parser_file), "exec"), namespace)
    parsed = namespace["parse_telemetry_line"](
        "TEL:FW=FC-0.8.1,REV=2026-06-19.1,R=1.20,P=-2.30,Y=15.4,MH=15.0,HM=HOLD,M1=1000,M2=1200,M3=1300,M4=1400,"
        "THR=0.25,RR=-0.05,RP=0.02,RY=0.00,PROLL=0.1,PPITCH=0.2,PYAW=0.3,"
        "BV=14.82,BCELL=3.71,BSOC=68,BALARM=0,BVALID=1,ARM=0,FS=0"
    )
    ok &= check("telemetry parser battery voltage", parsed["battery_voltage"] == 14.82)
    ok &= check("telemetry parser motor int", parsed["m4"] == 1400)
    ok &= check("telemetry parser heading mode", parsed["heading_mode"] == "HOLD")
    ok &= check("telemetry parser firmware version", parsed["firmware_version"] == "FC-0.8.1")
    ok &= check("telemetry parser firmware revision", parsed["firmware_revision"] == "2026-06-19.1")
    parsed_empty_battery = namespace["parse_telemetry_line"]("TEL:BV=3.70,BSOC=74,BVALID=1")
    parsed_mid_battery = namespace["parse_telemetry_line"]("TEL:BV=4.35,BVALID=1")
    parsed_full_battery = namespace["parse_telemetry_line"]("TEL:BV=5.00,BVALID=1")
    ok &= check("telemetry parser battery 3.70V is empty", parsed_empty_battery["battery_soc"] == 0)
    ok &= check("telemetry parser battery midpoint is half", parsed_mid_battery["battery_soc"] == 50)
    ok &= check("telemetry parser battery 5.00V is full", parsed_full_battery["battery_soc"] == 100)
    parsed_low_battery = namespace["parse_telemetry_line"]("TEL:BV=3.96,BVALID=1")
    parsed_critical_battery = namespace["parse_telemetry_line"]("TEL:BV=3.81,BVALID=1")
    ok &= check("telemetry parser battery low alarm at 20 percent", parsed_low_battery["battery_alarm"] == 1)
    ok &= check("telemetry parser battery critical alarm at 9 percent", parsed_critical_battery["battery_alarm"] == 2)
    parsed_baro = namespace["parse_telemetry_line"](
        '{"ms":101,"baroOK":1,"baroStatus":"OK","baroPressurePa":100125.5,'
        '"baroTempC":28.25,"baroAltitudeM":10.2,"baroRelativeAltitudeM":1.4,'
        '"baroRawPressure":415000,"baroBaselineRaw":414900}'
    )
    ok &= check("telemetry parser barometer pressure", parsed_baro["baro_pressure_pa"] == 100125.5)
    ok &= check("telemetry parser barometer hPa", round(parsed_baro["baro_pressure_hpa"], 3) == 1001.255)
    ok &= check("telemetry parser barometer status", parsed_baro["baro_status"] == "OK")
    parsed_pid_ack = namespace["parse_telemetry_line"](
        "ACK:PID,KPR=0.450123,KIR=0.000001,KDR=0.010002,KPP=0.460123,KIP=0.000003,KDP=0.020004,KPY=0.500005,KIY=0.000006,KDY=0.000007"
    )
    ok &= check("telemetry parser PID ACK roll P", parsed_pid_ack["pid_roll_p"] == 0.450123)
    ok &= check("telemetry parser PID ACK pitch D", parsed_pid_ack["pid_pitch_d"] == 0.020004)
    ok &= check("telemetry parser PID ACK yaw D", parsed_pid_ack["pid_yaw_d"] == 0.000007)
    ok &= check("no stale TP_ARC sketch names", "TP_ARC_FlightController" not in all_project_text and "TP_ARC_CalibrationWizard" not in all_project_text)

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
