/*
 * ARC Flight Controller - Setup Module v6.5 CPP FIXED
 *
 * Fixes over v6.0:
 *  - Stores EEPROM data using EEPROM.put(), not one-byte EEPROM.write().
 *  - Uses a single packed setup struct with signature, version, and checksum.
 *  - Removes duplicate EEPROM save/verify.
 *  - Adds receiver alive/range validation before calibration.
 *  - Uses atomic receiver pulse reads from ISR-updated values.
 *  - Keeps latest PCB receiver map:
 *      CH1 Roll     = D7
 *      CH2 Pitch    = D8
 *      CH3 Throttle = D5
 *      CH4 Yaw      = D4
 *      CH5 Mode     = D3
 *      CH6 Lockout  = D12
 *  - Captures semantic switch positions for CH5 and CH6 instead of assuming high/low meaning.
 *  - Defines receiver CHANNELS and PINS explicitly near the top of the sketch.
 *  - Captures axis direction/inversion information.
 *  - Implements real MPU6050 gyro offset calibration.
 *  - Implements BMP280 raw pressure baseline capture.
 *  - Implements QMC5883P stationary compass baseline/offset sampling.
 *  - v6.3 changes endpoint capture order to CH5, CH6, then CH1-CH4.
 *  - v6.3 removes the C key prompt from endpoint/switch range capture and uses timed auto capture.
 *  - v6.4 changes compass calibration to simple flat 360-degree heading calibration.
 *  - v6.5 removes compass movement calibration. Compass and barometer now take 2000 stationary samples,
 *    check average sample-to-sample difference against a 1.00 raw-count limit, and still save averaged baselines/offsets.
 *
 * IMPORTANT COMPASS NOTE:
 *  v6.5 does NOT perform movement compass calibration.
 *  It only checks that the compass is alive and reasonably stable while the drone is kept still.
 *  The saved compass baseline is an offset reference: future code should subtract it from live raw readings
 *  if it wants a zero-centered magnetic disturbance/stability check.
 *  The compass code below uses the QMC5883P register layout at COMPASS_ADDR = 0x2C.
 *  QMC5883P chip ID is register 0x00 and raw X/Y/Z data is registers 0x01..0x06.
 */

#include <Wire.h>
#include <EEPROM.h>
#include <string.h>

// ---------------------------------------------------------
// USER / PROJECT CONSTANTS
// ---------------------------------------------------------
#define SERIAL_BAUD       57600
#define LED_PIN           13

#define MPU6050_ADDR      0x68
#define BMP280_ADDR       0x76
#define COMPASS_ADDR      0x2C     // Project fixed address for HW-127/QMC5883P compass modules.
#define QMC5883P_CHIP_ID  0x80

#define EEPROM_START_ADDR 0
#define EEPROM_VERSION    65

#define RX_VALID_MIN_US   850
#define RX_VALID_MAX_US   2150
#define RX_REQUIRED_SPAN  300

#define AXIS_MOVE_MIN_US  180
#define SWITCH_MOVE_MIN_US 250

#define SENSOR_BASELINE_SAMPLES          2000
#define SENSOR_SAMPLE_DELAY_MS           5
#define SENSOR_AVG_STEP_DIFF_LIMIT_X100  100   // less than 1.00 raw-count average step difference

// ---------------------------------------------------------
// RECEIVER CHANNEL AND PIN DEFINITIONS
// ---------------------------------------------------------
// Latest PCB receiver map:
//   CH1 Roll     = Arduino D7
//   CH2 Pitch    = Arduino D8
//   CH3 Throttle = Arduino D5
//   CH4 Yaw      = Arduino D4
//   CH5 Mode     = Arduino D3
//   CH6 Lockout  = Arduino D12
//
// These CH_* values are array indexes used by rx.current_pulse[].
// These RX_CH*_PIN values are the actual Arduino Uno pins.

#define CH_ROLL       0
#define CH_PITCH      1
#define CH_THROTTLE   2
#define CH_YAW        3
#define CH_MODE       4
#define CH_LOCKOUT    5

#define RX_CH1_ROLL_PIN        7
#define RX_CH2_PITCH_PIN       8
#define RX_CH3_THROTTLE_PIN    5
#define RX_CH4_YAW_PIN         4
#define RX_CH5_MODE_PIN        3
#define RX_CH6_LOCKOUT_PIN     12

// AVR port bit masks for the pin-change interrupt service routines.
// D8  = PB0 = B00000001
// D12 = PB4 = B00010000
// D3  = PD3 = B00001000
// D4  = PD4 = B00010000
// D5  = PD5 = B00100000
// D7  = PD7 = B10000000
#define RX_CH2_PITCH_MASK      B00000001
#define RX_CH6_LOCKOUT_MASK    B00010000
#define RX_CH5_MODE_MASK       B00001000
#define RX_CH4_YAW_MASK        B00010000
#define RX_CH3_THROTTLE_MASK   B00100000
#define RX_CH1_ROLL_MASK       B10000000

// Sensor flags for cfg.sensorFlags.
#define SENSOR_MPU_OK      0x01
#define SENSOR_COMPASS_OK  0x02
#define SENSOR_BARO_OK     0x04

// ---------------------------------------------------------
// RUNTIME RECEIVER STORAGE
// ---------------------------------------------------------
struct ReceiverRuntime {
  volatile unsigned long timer[6];
  volatile uint16_t current_pulse[6];
  uint16_t center[6];
  uint16_t min_val[6];
  uint16_t max_val[6];
};

ReceiverRuntime rx;
byte last_rx_B = 0;
byte last_rx_D = 0;

// ---------------------------------------------------------
// EEPROM STORAGE STRUCTURE
// ---------------------------------------------------------
struct ArcSetupData {
  char signature[3];       // 'A', 'R', 'C'
  uint8_t version;         // EEPROM_VERSION

  uint16_t rxCenter[6];
  uint16_t rxMin[6];
  uint16_t rxMax[6];

  // Direction convention:
  // +1 means the requested positive movement increases PWM from center.
  // -1 means the requested positive movement decreases PWM from center.
  // Positive movements used here:
  //   roll right, pitch/nose up, yaw right, throttle high.
  int8_t rollDir;
  int8_t pitchDir;
  int8_t yawDir;
  int8_t throttleDir;

  // Semantic switch positions. These are not assumed to be min/max.
  uint16_t ch5Up;
  uint16_t ch5Mid;
  uint16_t ch5Down;
  uint16_t ch6On;
  uint16_t ch6Off;

  // MPU6050 gyro zero offsets, raw ADC counts.
  int16_t gyroOffset[3];   // X, Y, Z

  // Stationary compass baseline/offset, raw counts.
  // Future code can subtract magBaseline[] from live raw readings if needed.
  int16_t magBaseline[3];      // Average X, Y, Z from stationary 2000-sample check
  uint16_t magAvgDiffX100[3];  // Average sample-to-sample difference * 100
  uint16_t magMaxStepDiff[3];  // Maximum sample-to-sample difference

  // BMP280 raw pressure baseline/offset. This is raw pressure, not compensated altitude.
  int32_t baroBaselineRaw;
  uint16_t baroAvgDiffX100;
  uint16_t baroMaxStepDiff;

  uint8_t sensorFlags;

  uint16_t checksum;       // Must remain last.
};

ArcSetupData cfg;

// Direction validation samples.
uint16_t sampleThrottleLow = 0;
uint16_t sampleThrottleHigh = 0;
uint16_t sampleRollRight = 0;
uint16_t sampleRollLeft = 0;
uint16_t samplePitchUp = 0;
uint16_t samplePitchDown = 0;
uint16_t sampleYawRight = 0;
uint16_t sampleYawLeft = 0;

// ---------------------------------------------------------
// BASIC HELPERS
// ---------------------------------------------------------
void ledErrorDoubleBlink() {
  digitalWrite(LED_PIN, HIGH); delay(100);
  digitalWrite(LED_PIN, LOW);  delay(100);
  digitalWrite(LED_PIN, HIGH); delay(100);
  digitalWrite(LED_PIN, LOW);  delay(700);
}

void haltWithError(const __FlashStringHelper *msg) {
  Serial.println();
  Serial.println(F("================================================="));
  Serial.println(F("FATAL SETUP ERROR"));
  Serial.println(msg);
  Serial.println(F("EEPROM was NOT updated. Fix the issue and rerun setup."));
  Serial.println(F("================================================="));
  while (true) ledErrorDoubleBlink();
}

void flushSerialInput() {
  while (Serial.available() > 0) Serial.read();
}

void waitForConfirmation() {
  flushSerialInput();
  Serial.println(F(" >> Press 'C' to capture/continue..."));
  while (true) {
    if (Serial.available() > 0) {
      char c = Serial.read();
      if (c == 'c' || c == 'C') break;
    }
    delay(5);
  }
}

uint16_t clampU16(uint32_t v) {
  if (v > 65535UL) return 65535;
  return (uint16_t)v;
}

uint16_t absDiff16(int16_t a, int16_t b) {
  return (a >= b) ? (uint16_t)(a - b) : (uint16_t)(b - a);
}

uint32_t absDiff32(int32_t a, int32_t b) {
  return (a >= b) ? (uint32_t)(a - b) : (uint32_t)(b - a);
}

uint16_t averageDiffX100(uint32_t diffSum, uint16_t intervals) {
  if (intervals == 0) return 0;
  uint32_t whole = diffSum / intervals;
  uint32_t rem = diffSum % intervals;
  uint32_t scaled = (whole * 100UL) + ((rem * 100UL) / intervals);
  return clampU16(scaled);
}

void printX100(uint32_t valueX100) {
  Serial.print(valueX100 / 100UL);
  Serial.print('.');
  byte frac = (byte)(valueX100 % 100UL);
  if (frac < 10) Serial.print('0');
  Serial.print(frac);
}

bool validPulse(uint16_t p) {
  return (p >= RX_VALID_MIN_US && p <= RX_VALID_MAX_US);
}

uint16_t readPulseAtomic(byte ch) {
  uint16_t value;
  noInterrupts();
  value = rx.current_pulse[ch];
  interrupts();
  return value;
}

void copyAllPulsesAtomic(uint16_t out[6]) {
  noInterrupts();
  for (byte i = 0; i < 6; i++) out[i] = rx.current_pulse[i];
  interrupts();
}

void printLiveRx() {
  uint16_t p[6];
  copyAllPulsesAtomic(p);
  Serial.print(F("RX: "));
  for (byte i = 0; i < 6; i++) {
    Serial.print(F("CH")); Serial.print(i + 1);
    Serial.print(F("=")); Serial.print(p[i]);
    if (i < 5) Serial.print(F("  "));
  }
  Serial.println();
}

void waitForReceiverAlive() {
  Serial.println(F("\nChecking receiver PWM input on all 6 channels..."));
  Serial.println(F("Expected valid range: 850us to 2150us."));

  unsigned long lastPrint = 0;
  while (true) {
    bool allValid = true;
    for (byte i = 0; i < 6; i++) {
      if (!validPulse(readPulseAtomic(i))) allValid = false;
    }

    if (allValid) {
      Serial.println(F("Receiver check PASS: all 6 channels alive."));
      printLiveRx();
      return;
    }

    if (millis() - lastPrint > 1000) {
      lastPrint = millis();
      Serial.println(F("Waiting for valid receiver pulses..."));
      printLiveRx();
    }
    delay(20);
  }
}

uint16_t captureSingleChannel(const __FlashStringHelper *prompt, byte ch) {
  Serial.println();
  Serial.println(prompt);
  waitForConfirmation();
  delay(80); // Allow ISR to catch a fresh receiver frame after stick/switch movement.
  uint16_t v = readPulseAtomic(ch);
  Serial.print(F("Captured CH")); Serial.print(ch + 1);
  Serial.print(F(" = ")); Serial.print(v); Serial.println(F(" us"));
  if (!validPulse(v)) haltWithError(F("Captured receiver pulse is outside valid range."));
  return v;
}

int8_t directionFromSamples(uint16_t positiveSample, uint16_t negativeSample, uint16_t centerSample, const __FlashStringHelper *axisName) {
  int posDelta = (int)positiveSample - (int)centerSample;
  int negDelta = (int)negativeSample - (int)centerSample;

  if (abs(posDelta) < AXIS_MOVE_MIN_US || abs(negDelta) < AXIS_MOVE_MIN_US) {
    Serial.print(axisName); Serial.println(F(" movement too small."));
    haltWithError(F("Axis direction check failed. Move the stick fully during setup."));
  }

  if ((posDelta > 0 && negDelta > 0) || (posDelta < 0 && negDelta < 0)) {
    Serial.print(axisName); Serial.println(F(" positive and negative movements are on the same side of center."));
    haltWithError(F("Axis direction check failed. Check receiver channel mapping or stick movement."));
  }

  return (posDelta > 0) ? +1 : -1;
}

int8_t throttleDirectionFromSamples(uint16_t highSample, uint16_t lowSample) {
  int delta = (int)highSample - (int)lowSample;
  if (abs(delta) < RX_REQUIRED_SPAN) {
    haltWithError(F("Throttle high/low span is too small. Check CH3 receiver input."));
  }
  return (delta > 0) ? +1 : -1;
}


// ---------------------------------------------------------
// TIMED AUTO-CAPTURE HELPERS
// ---------------------------------------------------------
void countdownSeconds(byte seconds) {
  for (int i = seconds; i > 0; i--) {
    Serial.print(i);
    Serial.println(F("..."));
    delay(1000);
  }
}

void resetChannelRange(byte ch) {
  rx.min_val[ch] = 3000;
  rx.max_val[ch] = 0;
}

void updateChannelRange(byte ch, uint16_t v) {
  if (!validPulse(v)) return;
  if (v < rx.min_val[ch]) rx.min_val[ch] = v;
  if (v > rx.max_val[ch]) rx.max_val[ch] = v;
}

uint16_t autoAverageSingleChannel(byte ch, unsigned long captureMs) {
  unsigned long start = millis();
  unsigned long lastPrint = 0;
  unsigned long sum = 0;
  uint16_t count = 0;

  // Ignore the first part of each timed phase for the semantic average.
  // This gives you a short moment to move the switch after the prompt appears.
  // The range min/max still updates during this settle period.
  unsigned long settleMs = captureMs / 3UL;
  if (settleMs > 800UL) settleMs = 800UL;

  while (millis() - start < captureMs) {
    unsigned long elapsed = millis() - start;
    uint16_t v = readPulseAtomic(ch);

    if (validPulse(v)) {
      updateChannelRange(ch, v);
      if (elapsed >= settleMs) {
        sum += v;
        count++;
      }
    }

    if (millis() - lastPrint >= 1000UL) {
      lastPrint = millis();
      int remaining = (int)((captureMs - elapsed + 999UL) / 1000UL);
      if (remaining < 0) remaining = 0;
      Serial.print(F("  remaining: "));
      Serial.print(remaining);
      Serial.println(F("s"));
    }
    delay(20);
  }

  if (count < 10) {
    haltWithError(F("Timed receiver capture failed: not enough valid PWM samples."));
  }

  return (uint16_t)(sum / count);
}

void autoCaptureCH5ModeSwitch() {
  Serial.println(F("\n[RX STEP 6A] CH5 MODE SWITCH AUTO CAPTURE"));
  Serial.println(F("No keyboard input needed."));
  Serial.println(F("Follow the timed prompts. Total capture time is 10 seconds."));
  Serial.println(F("Get ready..."));
  countdownSeconds(3);

  resetChannelRange(CH_MODE);

  Serial.println(F("Set CH5 to UP / NORMAL now. Capturing 3 seconds."));
  cfg.ch5Up = autoAverageSingleChannel(CH_MODE, 3000UL);

  Serial.println(F("Set CH5 to MIDDLE / TEST now. Capturing 3 seconds."));
  cfg.ch5Mid = autoAverageSingleChannel(CH_MODE, 3000UL);

  Serial.println(F("Set CH5 to DOWN / BENCH now. Capturing 3 seconds."));
  cfg.ch5Down = autoAverageSingleChannel(CH_MODE, 3000UL);

  Serial.println(F("Quickly toggle CH5 through UP/MID/DOWN once. Capturing final 1 second."));
  autoAverageSingleChannel(CH_MODE, 1000UL);

  if (!validPulse(rx.min_val[CH_MODE]) || !validPulse(rx.max_val[CH_MODE])) {
    haltWithError(F("CH5 auto capture failed: invalid min/max pulse."));
  }

  if (abs((int)cfg.ch5Up - (int)cfg.ch5Mid) < 120 ||
      abs((int)cfg.ch5Mid - (int)cfg.ch5Down) < 120 ||
      abs((int)cfg.ch5Up - (int)cfg.ch5Down) < 240) {
    Serial.print(F("CH5 Up/Mid/Down captured as: "));
    Serial.print(cfg.ch5Up); Serial.print(F(" / "));
    Serial.print(cfg.ch5Mid); Serial.print(F(" / "));
    Serial.println(cfg.ch5Down);
    haltWithError(F("CH5 switch positions are too close together. Rerun setup and follow the timed prompts."));
  }

  Serial.print(F("CH5 semantic Up/Mid/Down = "));
  Serial.print(cfg.ch5Up); Serial.print(F(" / "));
  Serial.print(cfg.ch5Mid); Serial.print(F(" / "));
  Serial.println(cfg.ch5Down);

  Serial.print(F("CH5 range Min/Max = "));
  Serial.print(rx.min_val[CH_MODE]); Serial.print(F(" / "));
  Serial.println(rx.max_val[CH_MODE]);
}

void autoCaptureCH6LockoutSwitch() {
  Serial.println(F("\n[RX STEP 6B] CH6 LOCKOUT SWITCH AUTO CAPTURE"));
  Serial.println(F("No keyboard input needed."));
  Serial.println(F("Follow the timed prompts. Total capture time is 10 seconds."));
  Serial.println(F("Get ready..."));
  countdownSeconds(3);

  resetChannelRange(CH_LOCKOUT);

  Serial.println(F("Set CH6 to ON / KILL now. Capturing 4 seconds."));
  cfg.ch6On = autoAverageSingleChannel(CH_LOCKOUT, 4000UL);

  Serial.println(F("Set CH6 to OFF / SAFE TO ARM now. Capturing 4 seconds."));
  cfg.ch6Off = autoAverageSingleChannel(CH_LOCKOUT, 4000UL);

  Serial.println(F("Toggle CH6 ON/OFF once. Capturing final 2 seconds."));
  autoAverageSingleChannel(CH_LOCKOUT, 2000UL);

  if (!validPulse(rx.min_val[CH_LOCKOUT]) || !validPulse(rx.max_val[CH_LOCKOUT])) {
    haltWithError(F("CH6 auto capture failed: invalid min/max pulse."));
  }

  if (abs((int)cfg.ch6On - (int)cfg.ch6Off) < SWITCH_MOVE_MIN_US) {
    Serial.print(F("CH6 ON/OFF captured as: "));
    Serial.print(cfg.ch6On); Serial.print(F(" / "));
    Serial.println(cfg.ch6Off);
    haltWithError(F("CH6 ON/OFF positions are too close together. Rerun setup and follow the timed prompts."));
  }

  Serial.print(F("CH6 semantic ON/OFF = "));
  Serial.print(cfg.ch6On); Serial.print(F(" / "));
  Serial.println(cfg.ch6Off);

  Serial.print(F("CH6 range Min/Max = "));
  Serial.print(rx.min_val[CH_LOCKOUT]); Serial.print(F(" / "));
  Serial.println(rx.max_val[CH_LOCKOUT]);
}

void autoCaptureStickEndpointsCH1toCH4() {
  Serial.println(F("\n[RX STEP 6C] CH1-CH4 STICK ENDPOINT AUTO CAPTURE"));
  Serial.println(F("No keyboard input needed."));
  Serial.println(F("For 10 seconds, move ROLL, PITCH, THROTTLE, and YAW through their full ranges."));
  Serial.println(F("For Mode 2: roll/yaw side-to-side, pitch forward/back, throttle low/high."));
  Serial.println(F("CH5 and CH6 are ignored in this step."));
  Serial.println(F("Get ready..."));
  countdownSeconds(3);

  for (byte i = 0; i < 4; i++) resetChannelRange(i);

  unsigned long start = millis();
  unsigned long lastPrint = 0;

  while (millis() - start < 10000UL) {
    for (byte i = 0; i < 4; i++) {
      uint16_t v = readPulseAtomic(i);
      updateChannelRange(i, v);
    }

    if (millis() - lastPrint >= 1000UL) {
      lastPrint = millis();
      unsigned long elapsed = millis() - start;
      int remaining = (int)((10000UL - elapsed + 999UL) / 1000UL);
      if (remaining < 0) remaining = 0;
      Serial.print(F("  remaining: "));
      Serial.print(remaining);
      Serial.println(F("s"));
    }
    delay(20);
  }

  for (byte i = 0; i < 4; i++) {
    if (!validPulse(rx.min_val[i]) || !validPulse(rx.max_val[i])) {
      haltWithError(F("CH1-CH4 endpoint capture failed: invalid min/max pulse."));
    }

    if ((int)rx.max_val[i] - (int)rx.min_val[i] < RX_REQUIRED_SPAN) {
      Serial.print(F("CH")); Serial.print(i + 1); Serial.println(F(" span too small."));
      haltWithError(F("CH1-CH4 endpoint capture failed: not enough movement detected."));
    }
  }

  Serial.println(F("CH1-CH4 endpoint capture PASS."));
  for (byte i = 0; i < 4; i++) {
    Serial.print(F("CH")); Serial.print(i + 1);
    Serial.print(F(" Min=")); Serial.print(rx.min_val[i]);
    Serial.print(F(" Center/Safe=")); Serial.print(rx.center[i]);
    Serial.print(F(" Max=")); Serial.println(rx.max_val[i]);
  }
}

// ---------------------------------------------------------
// I2C HELPERS
// ---------------------------------------------------------
bool i2cDevicePresent(uint8_t addr) {
  Wire.beginTransmission(addr);
  return (Wire.endTransmission() == 0);
}

bool writeReg(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  return (Wire.endTransmission() == 0);
}

bool readRegs(uint8_t addr, uint8_t reg, uint8_t count, uint8_t *buf) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;

  byte got = Wire.requestFrom((int)addr, (int)count);
  if (got != count) return false;

  for (byte i = 0; i < count; i++) buf[i] = Wire.read();
  return true;
}

int16_t makeI16(uint8_t hi, uint8_t lo) {
  return (int16_t)(((uint16_t)hi << 8) | lo);
}

void scanI2CBus() {
  Serial.println(F("\nI2C scan:"));
  byte found = 0;
  for (byte addr = 1; addr < 127; addr++) {
    if (i2cDevicePresent(addr)) {
      Serial.print(F("  Found 0x"));
      if (addr < 16) Serial.print('0');
      Serial.println(addr, HEX);
      found++;
    }
  }
  if (found == 0) Serial.println(F("  No I2C devices found."));

  Serial.println(F("Expected project addresses:"));
  Serial.print(F("  MPU6050  : 0x")); Serial.println(MPU6050_ADDR, HEX);
  Serial.print(F("  BMP280   : 0x")); Serial.println(BMP280_ADDR, HEX);
  Serial.print(F("  Compass  : 0x")); Serial.println(COMPASS_ADDR, HEX);
}

// ---------------------------------------------------------
// MPU6050 GYRO CALIBRATION
// ---------------------------------------------------------
bool initMPU6050() {
  if (!i2cDevicePresent(MPU6050_ADDR)) return false;

  // Wake from sleep.
  if (!writeReg(MPU6050_ADDR, 0x6B, 0x00)) return false;
  delay(100);

  // Digital low pass filter setting.
  if (!writeReg(MPU6050_ADDR, 0x1A, 0x03)) return false;

  // Gyro full scale +/-250 dps.
  if (!writeReg(MPU6050_ADDR, 0x1B, 0x00)) return false;

  return true;
}

bool readMPUGyroRaw(int16_t &gx, int16_t &gy, int16_t &gz) {
  uint8_t b[6];
  if (!readRegs(MPU6050_ADDR, 0x43, 6, b)) return false;
  gx = makeI16(b[0], b[1]);
  gy = makeI16(b[2], b[3]);
  gz = makeI16(b[4], b[5]);
  return true;
}

bool calibrateGyro() {
  Serial.println(F("\n[GYRO] MPU6050 calibration"));
  Serial.println(F("Keep the drone perfectly still on a stable surface."));
  waitForConfirmation();

  if (!initMPU6050()) {
    Serial.println(F("MPU6050 init failed."));
    return false;
  }

  const int samples = 2000;
  long sumX = 0, sumY = 0, sumZ = 0;
  int16_t gx, gy, gz;

  Serial.println(F("Sampling gyro offsets..."));
  for (int i = 0; i < samples; i++) {
    if (!readMPUGyroRaw(gx, gy, gz)) {
      Serial.println(F("MPU6050 gyro read failed."));
      return false;
    }
    sumX += gx;
    sumY += gy;
    sumZ += gz;

    if ((i % 250) == 0) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      Serial.print('.');
    }
    delay(3);
  }
  Serial.println();

  cfg.gyroOffset[0] = (int16_t)(sumX / samples);
  cfg.gyroOffset[1] = (int16_t)(sumY / samples);
  cfg.gyroOffset[2] = (int16_t)(sumZ / samples);

  Serial.print(F("Gyro offset X=")); Serial.print(cfg.gyroOffset[0]);
  Serial.print(F(" Y=")); Serial.print(cfg.gyroOffset[1]);
  Serial.print(F(" Z=")); Serial.println(cfg.gyroOffset[2]);
  return true;
}

// ---------------------------------------------------------
// COMPASS STATIONARY BASELINE / OFFSET CHECK
// ---------------------------------------------------------
bool initCompass() {
  if (!i2cDevicePresent(COMPASS_ADDR)) return false;

  uint8_t chipId = 0;
  if (!readRegs(COMPASS_ADDR, 0x00, 1, &chipId)) return false;

  Serial.print(F("QMC5883P compass chip ID: 0x"));
  if (chipId < 16) Serial.print('0');
  Serial.println(chipId, HEX);

  if (chipId != QMC5883P_CHIP_ID) {
    Serial.println(F("Unexpected compass chip ID. Expected QMC5883P ID 0x80 at register 0x00."));
    return false;
  }

  // QMC5883P setup. Data registers are 0x01..0x06; 0x00 is chip ID.
  if (!writeReg(COMPASS_ADDR, 0x0D, 0x40)) return false;
  if (!writeReg(COMPASS_ADDR, 0x29, 0x06)) return false;
  if (!writeReg(COMPASS_ADDR, 0x0A, 0xCF)) return false;
  if (!writeReg(COMPASS_ADDR, 0x0B, 0x00)) return false;
  delay(100);
  return true;
}

bool readCompassRaw(int16_t &mx, int16_t &my, int16_t &mz) {
  uint8_t b[6];
  if (!readRegs(COMPASS_ADDR, 0x01, 6, b)) return false;

  // QMC5883P output order is X, Y, Z and each axis is little-endian.
  mx = makeI16(b[1], b[0]);
  my = makeI16(b[3], b[2]);
  mz = makeI16(b[5], b[4]);
  return true;
}

bool compassRawLooksUsable(int16_t mx, int16_t my, int16_t mz) {
  if (mx == 0 && my == 0 && mz == 0) return false;
  if (mx == 32767 || my == 32767 || mz == 32767) return false;
  if (mx == -32768 || my == -32768 || mz == -32768) return false;
  return true;
}

bool captureCompassBaseline() {
  Serial.println(F("\n[COMPASS] STATIONARY BASELINE / OFFSET CHECK"));
  Serial.println(F("Compass movement calibration is removed in v6.5."));
  Serial.println(F("Keep the drone completely still and away from magnets/large metal objects."));
  Serial.println(F("The setup will take 2000 samples and save the average as the compass baseline/offset."));
  Serial.println(F("Allowed average sample-to-sample difference: less than 1.00 raw count."));
  waitForConfirmation();

  if (!initCompass()) {
    Serial.println(F("Compass init failed. Address/register map may be wrong."));
    return false;
  }

  int16_t mx, my, mz;
  int16_t last[3] = {0, 0, 0};
  int16_t minV[3] = {32767, 32767, 32767};
  int16_t maxV[3] = {-32768, -32768, -32768};
  uint32_t stepSum[3] = {0, 0, 0};
  uint16_t maxStep[3] = {0, 0, 0};
  long sum[3] = {0, 0, 0};
  int sampleCount = 0;
  bool haveLast = false;

  Serial.println(F("Sampling compass baseline..."));
  for (int i = 0; i < SENSOR_BASELINE_SAMPLES; i++) {
    if (!readCompassRaw(mx, my, mz)) {
      Serial.println(F("Compass read failed."));
      return false;
    }

    if (!compassRawLooksUsable(mx, my, mz)) {
      Serial.print(F("Compass returned unusable raw data X/Y/Z = "));
      Serial.print(mx); Serial.print(F(" / "));
      Serial.print(my); Serial.print(F(" / "));
      Serial.println(mz);
      Serial.println(F("Check the QMC5883P module, wiring, and address before saving calibration."));
      return false;
    }

    int16_t v[3] = {mx, my, mz};

    for (byte axis = 0; axis < 3; axis++) {
      sum[axis] += v[axis];
      if (v[axis] < minV[axis]) minV[axis] = v[axis];
      if (v[axis] > maxV[axis]) maxV[axis] = v[axis];

      if (haveLast) {
        uint16_t d = absDiff16(v[axis], last[axis]);
        stepSum[axis] += d;
        if (d > maxStep[axis]) maxStep[axis] = d;
      }
      last[axis] = v[axis];
    }

    haveLast = true;
    sampleCount++;

    if ((i % 250) == 0) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      Serial.print('.');
    }
    delay(SENSOR_SAMPLE_DELAY_MS);
  }
  Serial.println();

  if (sampleCount < SENSOR_BASELINE_SAMPLES) {
    Serial.println(F("Compass produced too few valid samples."));
    return false;
  }

  for (byte axis = 0; axis < 3; axis++) {
    cfg.magBaseline[axis] = (int16_t)(sum[axis] / sampleCount);
    cfg.magAvgDiffX100[axis] = averageDiffX100(stepSum[axis], (uint16_t)(sampleCount - 1));
    cfg.magMaxStepDiff[axis] = maxStep[axis];
  }

  Serial.print(F("Compass baseline/offset X/Y/Z = "));
  Serial.print(cfg.magBaseline[0]); Serial.print(F(" / "));
  Serial.print(cfg.magBaseline[1]); Serial.print(F(" / "));
  Serial.println(cfg.magBaseline[2]);

  Serial.print(F("Compass min X/Y/Z = "));
  Serial.print(minV[0]); Serial.print(F(" / "));
  Serial.print(minV[1]); Serial.print(F(" / "));
  Serial.println(minV[2]);

  Serial.print(F("Compass max X/Y/Z = "));
  Serial.print(maxV[0]); Serial.print(F(" / "));
  Serial.print(maxV[1]); Serial.print(F(" / "));
  Serial.println(maxV[2]);

  Serial.print(F("Compass avg step diff X/Y/Z = "));
  printX100(cfg.magAvgDiffX100[0]); Serial.print(F(" / "));
  printX100(cfg.magAvgDiffX100[1]); Serial.print(F(" / "));
  printX100(cfg.magAvgDiffX100[2]);
  Serial.println(F(" raw counts"));

  Serial.print(F("Compass max step diff X/Y/Z = "));
  Serial.print(cfg.magMaxStepDiff[0]); Serial.print(F(" / "));
  Serial.print(cfg.magMaxStepDiff[1]); Serial.print(F(" / "));
  Serial.println(cfg.magMaxStepDiff[2]);

  bool stable = true;
  for (byte axis = 0; axis < 3; axis++) {
    if (cfg.magAvgDiffX100[axis] >= SENSOR_AVG_STEP_DIFF_LIMIT_X100) stable = false;
  }

  if (stable) {
    Serial.println(F("Compass stationary check PASS."));
  } else {
    Serial.println(F("WARNING: Compass samples differed by 1.00 raw count or more on average."));
    Serial.println(F("The averaged compass baseline/offset was still saved to EEPROM as requested."));
  }

  return true;
}

// ---------------------------------------------------------
// BMP280 RAW PRESSURE BASELINE
// ---------------------------------------------------------
bool initBMP280() {
  if (!i2cDevicePresent(BMP280_ADDR)) return false;

  uint8_t chipId = 0;
  if (!readRegs(BMP280_ADDR, 0xD0, 1, &chipId)) return false;

  Serial.print(F("BMP/BME chip ID: 0x"));
  Serial.println(chipId, HEX);

  // 0x58 = BMP280, 0x60 = BME280. Continue only for these known IDs.
  if (chipId != 0x58 && chipId != 0x60) {
    Serial.println(F("Unexpected barometer chip ID."));
    return false;
  }

  // Config: standby/filter. Ctrl_meas: temp and pressure oversampling, normal mode.
  if (!writeReg(BMP280_ADDR, 0xF5, 0xA0)) return false;
  if (!writeReg(BMP280_ADDR, 0xF4, 0x27)) return false;
  delay(150);
  return true;
}

bool readBMP280RawPressure(int32_t &rawPressure) {
  uint8_t b[3];
  if (!readRegs(BMP280_ADDR, 0xF7, 3, b)) return false;

  rawPressure = (((int32_t)b[0]) << 12) | (((int32_t)b[1]) << 4) | (((int32_t)b[2]) >> 4);
  return true;
}

bool captureBarometerBaseline() {
  Serial.println(F("\n[BAROMETER] BMP280 STATIONARY BASELINE / OFFSET CHECK"));
  Serial.println(F("Keep the drone completely still. Avoid touching or blowing on the sensor."));
  Serial.println(F("The setup will take 2000 samples and save the average raw pressure baseline/offset."));
  Serial.println(F("Allowed average sample-to-sample difference: less than 1.00 raw count."));
  waitForConfirmation();

  if (!initBMP280()) {
    Serial.println(F("BMP280/BME280 init failed."));
    return false;
  }

  int32_t rawP = 0;
  int32_t lastP = 0;
  int32_t minP = 2147483647L;
  int32_t maxP = -2147483647L;
  uint32_t stepSum = 0;
  uint32_t maxStep = 0;
  long long sum = 0;
  int sampleCount = 0;
  bool haveLast = false;

  Serial.println(F("Sampling barometer baseline..."));
  for (int i = 0; i < SENSOR_BASELINE_SAMPLES; i++) {
    if (!readBMP280RawPressure(rawP)) {
      Serial.println(F("BMP280 pressure read failed."));
      return false;
    }

    sum += rawP;
    if (rawP < minP) minP = rawP;
    if (rawP > maxP) maxP = rawP;

    if (haveLast) {
      uint32_t d = absDiff32(rawP, lastP);
      stepSum += d;
      if (d > maxStep) maxStep = d;
    }
    lastP = rawP;
    haveLast = true;
    sampleCount++;

    if ((i % 250) == 0) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      Serial.print('.');
    }
    delay(SENSOR_SAMPLE_DELAY_MS);
  }
  Serial.println();

  if (sampleCount < SENSOR_BASELINE_SAMPLES) {
    Serial.println(F("Barometer produced too few valid samples."));
    return false;
  }

  cfg.baroBaselineRaw = (int32_t)(sum / sampleCount);
  cfg.baroAvgDiffX100 = averageDiffX100(stepSum, (uint16_t)(sampleCount - 1));
  cfg.baroMaxStepDiff = clampU16(maxStep);

  Serial.print(F("Barometer baseline/offset raw = "));
  Serial.println(cfg.baroBaselineRaw);

  Serial.print(F("Barometer min/max raw = "));
  Serial.print(minP); Serial.print(F(" / "));
  Serial.println(maxP);

  Serial.print(F("Barometer avg step diff = "));
  printX100(cfg.baroAvgDiffX100);
  Serial.println(F(" raw counts"));

  Serial.print(F("Barometer max step diff = "));
  Serial.println(cfg.baroMaxStepDiff);

  if (cfg.baroAvgDiffX100 < SENSOR_AVG_STEP_DIFF_LIMIT_X100) {
    Serial.println(F("Barometer stationary check PASS."));
  } else {
    Serial.println(F("WARNING: Barometer samples differed by 1.00 raw count or more on average."));
    Serial.println(F("The averaged barometer baseline/offset was still saved to EEPROM as requested."));
  }

  return true;
}

// ---------------------------------------------------------
// RECEIVER CALIBRATION WORKFLOW
// ---------------------------------------------------------
void captureReceiverCalibration() {
  waitForReceiverAlive();

  Serial.println(F("\n[RX STEP 1] Neutral/safe starting positions"));
  Serial.println(F("Set roll, pitch, and yaw sticks to CENTER."));
  Serial.println(F("Set throttle to LOW."));
  Serial.println(F("Set CH5 to MIDDLE."));
  Serial.println(F("Set CH6 lockout to OFF."));
  waitForConfirmation();

  for (byte i = 0; i < 6; i++) {
    rx.center[i] = readPulseAtomic(i);
    if (!validPulse(rx.center[i])) haltWithError(F("Invalid receiver center/safe value captured."));
  }
  sampleThrottleLow = rx.center[CH_THROTTLE];

  Serial.println(F("Captured neutral/safe receiver values:"));
  printLiveRx();

  // Direction checks.
  sampleThrottleHigh = captureSingleChannel(F("[RX STEP 2] Move THROTTLE to FULL HIGH."), CH_THROTTLE);
  sampleThrottleLow  = captureSingleChannel(F("Move THROTTLE back to LOW."), CH_THROTTLE);

  sampleRollRight = captureSingleChannel(F("[RX STEP 3] Move ROLL stick FULL RIGHT."), CH_ROLL);
  sampleRollLeft  = captureSingleChannel(F("Move ROLL stick FULL LEFT."), CH_ROLL);
  captureSingleChannel(F("Return ROLL stick to CENTER."), CH_ROLL);

  samplePitchUp   = captureSingleChannel(F("[RX STEP 4] Move PITCH stick NOSE UP / STICK BACK."), CH_PITCH);
  samplePitchDown = captureSingleChannel(F("Move PITCH stick NOSE DOWN / STICK FORWARD."), CH_PITCH);
  captureSingleChannel(F("Return PITCH stick to CENTER."), CH_PITCH);

  sampleYawRight = captureSingleChannel(F("[RX STEP 5] Move YAW stick FULL RIGHT."), CH_YAW);
  sampleYawLeft  = captureSingleChannel(F("Move YAW stick FULL LEFT."), CH_YAW);
  captureSingleChannel(F("Return YAW stick to CENTER."), CH_YAW);

  cfg.throttleDir = throttleDirectionFromSamples(sampleThrottleHigh, sampleThrottleLow);
  cfg.rollDir = directionFromSamples(sampleRollRight, sampleRollLeft, rx.center[CH_ROLL], F("Roll"));
  cfg.pitchDir = directionFromSamples(samplePitchUp, samplePitchDown, rx.center[CH_PITCH], F("Pitch"));
  cfg.yawDir = directionFromSamples(sampleYawRight, sampleYawLeft, rx.center[CH_YAW], F("Yaw"));

  Serial.println(F("\nDirection capture PASS."));
  Serial.print(F("Throttle high direction: ")); Serial.println(cfg.throttleDir > 0 ? F("PWM increases") : F("PWM decreases"));
  Serial.print(F("Roll right direction   : ")); Serial.println(cfg.rollDir > 0 ? F("PWM increases") : F("PWM decreases"));
  Serial.print(F("Pitch up direction    : ")); Serial.println(cfg.pitchDir > 0 ? F("PWM increases") : F("PWM decreases"));
  Serial.print(F("Yaw right direction   : ")); Serial.println(cfg.yawDir > 0 ? F("PWM increases") : F("PWM decreases"));

  // Timed endpoint/switch capture.
  // Order requested:
  //   1) CH5 mode switch
  //   2) CH6 lockout switch
  //   3) CH1-CH4 sticks
  // These steps do not require pressing C. They run on timed countdowns.
  autoCaptureCH5ModeSwitch();
  autoCaptureCH6LockoutSwitch();
  autoCaptureStickEndpointsCH1toCH4();

  Serial.println(F("\nReceiver endpoint/switch capture PASS."));
  for (byte i = 0; i < 6; i++) {
    Serial.print(F("CH")); Serial.print(i + 1);
    Serial.print(F(" Min=")); Serial.print(rx.min_val[i]);
    Serial.print(F(" Center/Safe=")); Serial.print(rx.center[i]);
    Serial.print(F(" Max=")); Serial.println(rx.max_val[i]);
  }

  for (byte i = 0; i < 6; i++) {
    cfg.rxCenter[i] = rx.center[i];
    cfg.rxMin[i] = rx.min_val[i];
    cfg.rxMax[i] = rx.max_val[i];
  }
}

// ---------------------------------------------------------
// EEPROM CHECKSUM / SAVE / VERIFY
// ---------------------------------------------------------
uint16_t calculateChecksum(const ArcSetupData &data) {
  const uint8_t *p = (const uint8_t *)&data;
  size_t len = sizeof(ArcSetupData) - sizeof(data.checksum);
  uint16_t sum = 0xA5A5;

  for (size_t i = 0; i < len; i++) {
    sum = (uint16_t)((sum << 5) | (sum >> 11));
    sum ^= p[i];
  }
  return sum;
}

void prepareConfigHeader() {
  cfg.signature[0] = 'A';
  cfg.signature[1] = 'R';
  cfg.signature[2] = 'C';
  cfg.version = EEPROM_VERSION;
}

bool configSignatureOk(const ArcSetupData &data) {
  return data.signature[0] == 'A' && data.signature[1] == 'R' && data.signature[2] == 'C';
}

void saveToEEPROM() {
  prepareConfigHeader();
  cfg.checksum = calculateChecksum(cfg);

  Serial.println(F("\nWriting setup data to EEPROM..."));
  EEPROM.put(EEPROM_START_ADDR, cfg);
  delay(20);
}

void verifyAndDisplayEEPROM() {
  ArcSetupData readBack;
  EEPROM.get(EEPROM_START_ADDR, readBack);

  Serial.println(F("\n--- EEPROM VERIFICATION REPORT ---"));

  bool sigOk = configSignatureOk(readBack);
  bool versionOk = (readBack.version == EEPROM_VERSION);
  bool checksumOk = (readBack.checksum == calculateChecksum(readBack));
  bool byteMatch = (memcmp(&cfg, &readBack, sizeof(ArcSetupData)) == 0);

  Serial.print(F("Signature : ")); Serial.println(sigOk ? F("PASS") : F("FAIL"));
  Serial.print(F("Version   : ")); Serial.println(versionOk ? F("PASS") : F("FAIL"));
  Serial.print(F("Checksum  : ")); Serial.println(checksumOk ? F("PASS") : F("FAIL"));
  Serial.print(F("Byte match: ")); Serial.println(byteMatch ? F("PASS") : F("FAIL"));

  Serial.println(F("\nReceiver calibration:"));
  for (byte i = 0; i < 6; i++) {
    Serial.print(F("CH")); Serial.print(i + 1);
    Serial.print(F(" C=")); Serial.print(readBack.rxCenter[i]);
    Serial.print(F(" Mn=")); Serial.print(readBack.rxMin[i]);
    Serial.print(F(" Mx=")); Serial.println(readBack.rxMax[i]);
  }

  Serial.println(F("\nDirection/inversion:"));
  Serial.print(F("Throttle: ")); Serial.println(readBack.throttleDir > 0 ? F("High = higher PWM") : F("High = lower PWM"));
  Serial.print(F("Roll    : ")); Serial.println(readBack.rollDir > 0 ? F("Right = higher PWM") : F("Right = lower PWM"));
  Serial.print(F("Pitch   : ")); Serial.println(readBack.pitchDir > 0 ? F("Nose up = higher PWM") : F("Nose up = lower PWM"));
  Serial.print(F("Yaw     : ")); Serial.println(readBack.yawDir > 0 ? F("Right = higher PWM") : F("Right = lower PWM"));

  Serial.println(F("\nSwitch semantic positions:"));
  Serial.print(F("CH5 Up/Mid/Down = "));
  Serial.print(readBack.ch5Up); Serial.print(F(" / "));
  Serial.print(readBack.ch5Mid); Serial.print(F(" / "));
  Serial.println(readBack.ch5Down);

  Serial.print(F("CH6 ON/OFF = "));
  Serial.print(readBack.ch6On); Serial.print(F(" / "));
  Serial.println(readBack.ch6Off);

  Serial.println(F("\nSensor baseline / offset data:"));
  Serial.print(F("Gyro offsets X/Y/Z = "));
  Serial.print(readBack.gyroOffset[0]); Serial.print(F(" / "));
  Serial.print(readBack.gyroOffset[1]); Serial.print(F(" / "));
  Serial.println(readBack.gyroOffset[2]);

  Serial.print(F("Mag baseline/offset X/Y/Z = "));
  Serial.print(readBack.magBaseline[0]); Serial.print(F(" / "));
  Serial.print(readBack.magBaseline[1]); Serial.print(F(" / "));
  Serial.println(readBack.magBaseline[2]);

  Serial.print(F("Mag avg step diff X/Y/Z = "));
  printX100(readBack.magAvgDiffX100[0]); Serial.print(F(" / "));
  printX100(readBack.magAvgDiffX100[1]); Serial.print(F(" / "));
  printX100(readBack.magAvgDiffX100[2]);
  Serial.println(F(" raw counts"));

  Serial.print(F("Mag max step diff X/Y/Z = "));
  Serial.print(readBack.magMaxStepDiff[0]); Serial.print(F(" / "));
  Serial.print(readBack.magMaxStepDiff[1]); Serial.print(F(" / "));
  Serial.println(readBack.magMaxStepDiff[2]);

  Serial.print(F("Baro baseline/offset raw = "));
  Serial.println(readBack.baroBaselineRaw);

  Serial.print(F("Baro avg step diff = "));
  printX100(readBack.baroAvgDiffX100);
  Serial.println(F(" raw counts"));

  Serial.print(F("Baro max step diff = "));
  Serial.println(readBack.baroMaxStepDiff);

  Serial.print(F("Sensor flags = 0x"));
  Serial.println(readBack.sensorFlags, HEX);

  if (sigOk && versionOk && checksumOk && byteMatch) {
    Serial.println(F("\n>> EEPROM VERIFY PASS: SETUP DATA SAVED CORRECTLY"));
  } else {
    haltWithError(F("EEPROM verify failed after write."));
  }
}

// ---------------------------------------------------------
// MAIN SETUP WORKFLOW
// ---------------------------------------------------------
void runSetupWorkflow() {
  memset(&cfg, 0, sizeof(cfg));
  prepareConfigHeader();

  Serial.println(F("\n--- ARC SETUP V6.5 CPP FIXED ---"));
  Serial.println(F("Manual workflow + EEPROM verify + auto endpoint capture + stationary sensor baselines"));

  scanI2CBus();

  if (!i2cDevicePresent(MPU6050_ADDR)) {
    haltWithError(F("MPU6050 not found at expected address."));
  }
  if (!i2cDevicePresent(BMP280_ADDR)) {
    haltWithError(F("BMP280/BME280 not found at expected address."));
  }
  if (!i2cDevicePresent(COMPASS_ADDR)) {
    haltWithError(F("Compass not found at expected address."));
  }

  captureReceiverCalibration();

  cfg.sensorFlags = 0;

  if (calibrateGyro()) cfg.sensorFlags |= SENSOR_MPU_OK;
  else haltWithError(F("Gyro calibration failed."));

  if (captureCompassBaseline()) cfg.sensorFlags |= SENSOR_COMPASS_OK;
  else haltWithError(F("Compass baseline check failed."));

  if (captureBarometerBaseline()) cfg.sensorFlags |= SENSOR_BARO_OK;
  else haltWithError(F("Barometer baseline check failed."));

  saveToEEPROM();
  verifyAndDisplayEEPROM();

  Serial.println(F("\nSETUP COMPLETE."));
  Serial.println(F("Power-cycle the flight controller before using the main flight code."));
}

// ---------------------------------------------------------
// ARDUINO SETUP / LOOP
// ---------------------------------------------------------
void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Explicit receiver input pins for the latest PCB map.
  pinMode(RX_CH1_ROLL_PIN, INPUT);
  pinMode(RX_CH2_PITCH_PIN, INPUT);
  pinMode(RX_CH3_THROTTLE_PIN, INPUT);
  pinMode(RX_CH4_YAW_PIN, INPUT);
  pinMode(RX_CH5_MODE_PIN, INPUT);
  pinMode(RX_CH6_LOCKOUT_PIN, INPUT);

  Serial.begin(SERIAL_BAUD);
  Wire.begin();
  TWBR = 12; // 400 kHz I2C on 16 MHz AVR.

  configureReceiverInterrupts();
  delay(500);

  runSetupWorkflow();
}

void loop() {
  // Setup complete indicator: slow blink.
  digitalWrite(LED_PIN, HIGH); delay(500);
  digitalWrite(LED_PIN, LOW);  delay(500);
}

// ---------------------------------------------------------
// DUAL-PORT PIN CHANGE INTERRUPTS
// Latest PCB receiver map:
//   CH1 Roll     D7  = PD7 = PCINT23 -> rx[0]
//   CH2 Pitch    D8  = PB0 = PCINT0  -> rx[1]
//   CH3 Throttle D5  = PD5 = PCINT21 -> rx[2]
//   CH4 Yaw      D4  = PD4 = PCINT20 -> rx[3]
//   CH5 Mode     D3  = PD3 = PCINT19 -> rx[4]
//   CH6 Lockout  D12 = PB4 = PCINT4  -> rx[5]
// ---------------------------------------------------------
void configureReceiverInterrupts() {
  PCICR |= (1 << PCIE0) | (1 << PCIE2);

  // Port B: D8/PB0/PCINT0, D12/PB4/PCINT4.
  PCMSK0 |= (1 << PCINT0) | (1 << PCINT4);

  // Port D: D3/PD3/PCINT19, D4/PD4/PCINT20, D5/PD5/PCINT21, D7/PD7/PCINT23.
  PCMSK2 |= (1 << PCINT19) | (1 << PCINT20) | (1 << PCINT21) | (1 << PCINT23);
}

ISR(PCINT0_vect) {
  unsigned long t = micros();
  byte s = PINB;

  // CH2 Pitch = D8 = PB0.
  if (s & RX_CH2_PITCH_MASK) {
    if (!(last_rx_B & RX_CH2_PITCH_MASK)) {
      rx.timer[CH_PITCH] = t;
      last_rx_B |= RX_CH2_PITCH_MASK;
    }
  } else if (last_rx_B & RX_CH2_PITCH_MASK) {
    unsigned long width = t - rx.timer[CH_PITCH];
    if (width < 3000) rx.current_pulse[CH_PITCH] = (uint16_t)width;
    last_rx_B &= ~RX_CH2_PITCH_MASK;
  }

  // CH6 Lockout = D12 = PB4.
  if (s & RX_CH6_LOCKOUT_MASK) {
    if (!(last_rx_B & RX_CH6_LOCKOUT_MASK)) {
      rx.timer[CH_LOCKOUT] = t;
      last_rx_B |= RX_CH6_LOCKOUT_MASK;
    }
  } else if (last_rx_B & RX_CH6_LOCKOUT_MASK) {
    unsigned long width = t - rx.timer[CH_LOCKOUT];
    if (width < 3000) rx.current_pulse[CH_LOCKOUT] = (uint16_t)width;
    last_rx_B &= ~RX_CH6_LOCKOUT_MASK;
  }
}

ISR(PCINT2_vect) {
  unsigned long t = micros();
  byte s = PIND;

  // CH5 Mode = D3 = PD3.
  if (s & RX_CH5_MODE_MASK) {
    if (!(last_rx_D & RX_CH5_MODE_MASK)) {
      rx.timer[CH_MODE] = t;
      last_rx_D |= RX_CH5_MODE_MASK;
    }
  } else if (last_rx_D & RX_CH5_MODE_MASK) {
    unsigned long width = t - rx.timer[CH_MODE];
    if (width < 3000) rx.current_pulse[CH_MODE] = (uint16_t)width;
    last_rx_D &= ~RX_CH5_MODE_MASK;
  }

  // CH4 Yaw = D4 = PD4.
  if (s & RX_CH4_YAW_MASK) {
    if (!(last_rx_D & RX_CH4_YAW_MASK)) {
      rx.timer[CH_YAW] = t;
      last_rx_D |= RX_CH4_YAW_MASK;
    }
  } else if (last_rx_D & RX_CH4_YAW_MASK) {
    unsigned long width = t - rx.timer[CH_YAW];
    if (width < 3000) rx.current_pulse[CH_YAW] = (uint16_t)width;
    last_rx_D &= ~RX_CH4_YAW_MASK;
  }

  // CH3 Throttle = D5 = PD5.
  if (s & RX_CH3_THROTTLE_MASK) {
    if (!(last_rx_D & RX_CH3_THROTTLE_MASK)) {
      rx.timer[CH_THROTTLE] = t;
      last_rx_D |= RX_CH3_THROTTLE_MASK;
    }
  } else if (last_rx_D & RX_CH3_THROTTLE_MASK) {
    unsigned long width = t - rx.timer[CH_THROTTLE];
    if (width < 3000) rx.current_pulse[CH_THROTTLE] = (uint16_t)width;
    last_rx_D &= ~RX_CH3_THROTTLE_MASK;
  }

  // CH1 Roll = D7 = PD7.
  if (s & RX_CH1_ROLL_MASK) {
    if (!(last_rx_D & RX_CH1_ROLL_MASK)) {
      rx.timer[CH_ROLL] = t;
      last_rx_D |= RX_CH1_ROLL_MASK;
    }
  } else if (last_rx_D & RX_CH1_ROLL_MASK) {
    unsigned long width = t - rx.timer[CH_ROLL];
    if (width < 3000) rx.current_pulse[CH_ROLL] = (uint16_t)width;
    last_rx_D &= ~RX_CH1_ROLL_MASK;
  }
}
