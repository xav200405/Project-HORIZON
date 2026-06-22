from pathlib import Path
import ast
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
CAL = ROOT / "firmware" / "calibration_wizard" / "CalibrationWizard" / "CalibrationWizard.ino"
DASH = ROOT / "dashboard" / "app"
JS = DASH / "static" / "js" / "dashboard.js"


def active_flight_sketch():
    preferred = ROOT / "firmware" / "flight_controller" / "controller_firmware_v2.6.1" / "controller_firmware_v2.6.1.ino"
    if preferred.exists():
        return preferred
    flight_root = ROOT / "firmware" / "flight_controller"
    candidates = sorted(
        flight_root.glob("*/**/*.ino"),
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
    ok &= check("flight sketch folder matches file name", FLIGHT.parent.name == FLIGHT.stem)
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
        ("flight source version marker", r"Safety Baseline V6\.6C_QMC5883P_COMPASS"),
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
        ("flight has QMC5883P compass support", r"QMC5883P"),
        ("flight has MPU6050 support", r"MPU6050"),
        ("flight has BMP280 telemetry support", r"setupBarometer|BARO_UPDATE_INTERVAL_MS"),
        ("flight emits barometer telemetry", r"baroPressurePa.*baroRelativeAltitudeM", re.S),
    ]
    for item in flight_checks:
        name, pattern, *flags = item
        ok &= check(name, require(pattern, flight, flags[0] if flags else 0))

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
        ("chart auto-selects populated telemetry tab", r"function bestTelemetryTab"),
        ("chart distinguishes empty tab from no telemetry", r"Telemetry received; no .* samples in this window"),
        ("API fallback allows changed stable-timestamp telemetry", r"lastFallbackSignature"),
        ("downsampling", r"function downsample"),
        ("PID range validation", r"item\.kp >= 0.*item\.kp <= 1.*item\.ki >= 0.*item\.ki <= 0\.5.*item\.kd >= 0.*item\.kd <= 0\.5", re.S),
        ("PID UI sends axis-specific gains", r"data-pid-axis"),
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
        ("RMS kill disabled by default", r"RMS_KILL_ENABLED=os\.environ\.get\(\"TPARC_RMS_KILL_ENABLED\"\)\s*==\s*\"1\""),
        ("RMS kill route guarded", r"if not current_app\.config\[\"RMS_KILL_ENABLED\"\].*RMS_KILL_DISABLED", re.S),
        ("RMS kill disabled template text", r"RMS kill is disabled; use transmitter CH6"),
    ]
    for item in dashboard_project_checks:
        name, pattern, *flags = item
        ok &= check(name, require(pattern, dashboard_text, flags[0] if flags else 0))

    ok &= check("flight handles full PID command", require(r"void handlePidCommand", flight) and require(r"ACK:PID,KPR=", flight))

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
    parsed_baro = namespace["parse_telemetry_line"](
        '{"ms":101,"baroOK":1,"baroStatus":"OK","baroPressurePa":100125.5,'
        '"baroTempC":28.25,"baroAltitudeM":10.2,"baroRelativeAltitudeM":1.4,'
        '"baroRawPressure":415000,"baroBaselineRaw":414900}'
    )
    ok &= check("telemetry parser barometer pressure", parsed_baro["baro_pressure_pa"] == 100125.5)
    ok &= check("telemetry parser barometer hPa", round(parsed_baro["baro_pressure_hpa"], 3) == 1001.255)
    ok &= check("telemetry parser barometer status", parsed_baro["baro_status"] == "OK")
    ok &= check("no stale TP_ARC sketch names", "TP_ARC_FlightController" not in all_project_text and "TP_ARC_CalibrationWizard" not in all_project_text)

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
