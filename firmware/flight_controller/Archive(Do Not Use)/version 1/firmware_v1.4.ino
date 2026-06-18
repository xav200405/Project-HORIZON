/*==============================================================================
  Wind-Stabilized Rope-Suspended Caged Platform - Flight Controller  (v2)
  ------------------------------------------------------------------------------
  Caged quadcopter-X hung by a single rope from a TOP-HUB SWIVEL (yaw is
  mechanically free; tilt has strong passive restoring because the pivot is
  well above the CG). Roll/Pitch = damp the tilt-rock + push against wind.
  Yaw = automatic heading lock with operator override + auto re-capture.

  v2 CHANGES vs v1 (to match the actual photographed build):
    * COMPASS AUTO-DETECT: board is a GY-271/HW-127 module which may be either
      HMC5883L (0x1E) or QMC5883L (0x0D). v2 probes both and uses the right one.
    * RC INPUT = PPM on D2/INT0 by default (board is silk-screened "PPM INT0").
      4x PWM on A0..A3 still available via RC_USE_PPM 0.
    * Comments updated for caged/high-pivot/free-yaw dynamics. Gentle gains.

  HARDWARE (observed)
    MCU      : ATmega328P @16MHz (custom Arduino-Uno board)
    IMU      : MPU6050  (I2C 0x68)              -- on foam isolation (good)
    Compass  : HMC5883L(0x1E) OR QMC5883L(0x0D) -- auto-detected
    Baro     : BMP280   (I2C 0x76)              -- presence check only, unused
    RX       : FlySky FS-iA10B  -> PPM into D2 (INT0)
    ESCs     : Servo lib, M1 D6 / M2 D9 / M3 D10 / M4 D11
               M1 BL CCW | M2 FL CW | M3 FR CCW | M4 BR CW
    I2C      : A4=SDA  A5=SCL

  !!! SAFETY -- PROPS OFF for all first tests. Big caged 3 kg pendulum +
      spinning props is dangerous. Secure the rope. Keep disarm ready.
      All PID gains are STARTING GUESSES -- tune on the airframe.
      MOUNT THE COMPASS AWAY FROM MOTOR/ESC CURRENT (ideally up the mast).
==============================================================================*/

#include <Wire.h>
#include <Servo.h>
#include <avr/wdt.h>
#include <math.h>

/*==============================================================================
  SECTION 1 -- CONFIGURATION / TUNABLES
==============================================================================*/

// ---- RC input selection ----------------------------------------------------
#define RC_USE_PPM   1            // 1 = PPM on D2/INT0 (matches your board)
                                  // 0 = 4x PWM on A0..A3 (pin-change interrupt)
#define PPM_PIN      2            // INT0
#define PPM_SYNC_US  3000         // gap longer than this = frame sync
#define PPM_MAXCH    10           // FS-iA10B
// FlySky default channel order is AETR: CH1 aileron, CH2 elevator, CH3 throttle,
// CH4 rudder. Adjust indices here if your TX mixing differs.
#define IDX_ROLL  0
#define IDX_PITCH 1
#define IDX_THR   2
#define IDX_YAW   3

// ---- Loop timing -----------------------------------------------------------
const uint32_t LOOP_US      = 5000;     // 5 ms => 200 Hz target
const uint8_t  COMPASS_EVERY= 4;        // read compass every 4th cycle (~50 Hz)

// ---- Sensor scaling --------------------------------------------------------
const float GYRO_LSB_PER_DPS = 65.5f;   // MPU6050 FS_SEL=1  (+/-500 dps)
const float ACC_LSB_PER_G    = 16384.0f;// MPU6050 AFS_SEL=0 (+/-2 g)

// ---- Complementary filter --------------------------------------------------
const float COMP_ALPHA = 0.98f;         // gyro weight for roll/pitch
const float YAW_COMP_K = 0.02f;         // compass correction weight for yaw

// ---- ESC pulse widths (us) -------------------------------------------------
const int ESC_MIN   = 1000, ESC_IDLE = 1150, ESC_MAX = 2000;

// ---- RC decode -------------------------------------------------------------
const int  RC_MIN = 1000, RC_MID = 1500, RC_MAX = 2000;
const int  RC_VALID_LO = 900, RC_VALID_HI = 2100;
const int  YAW_DEADBAND_US = 40;
const uint32_t RC_TIMEOUT_US = 500000UL;

// ---- Arming / disarming ----------------------------------------------------
const int  THR_ARM_MAX = 1080, YAW_FULL_HI = 1900, YAW_FULL_LO = 1100;
const uint32_t COMBO_HOLD_MS = 2000;
const uint32_t RECAPTURE_MS  = 500;

// ---- Protection ------------------------------------------------------------
const float TILT_LIMIT_DEG = 45.0f;

// ---- Command authority (gentle: big cage = high inertia, free yaw) ---------
const float MAX_YAW_RATE_DPS = 60.0f;   // cage yaw inertia is high -> modest
const float RC_ANGLE_RANGE   = 12.0f;

// ---- PID GAINS (TUNE!). Tilt is passively stable, so inner loop mostly damps.
struct PidGains { float kp, ki, kd, iMax, outMax; };
PidGains gRoll    = { 2.5f, 0.02f, 1.4f, 120.0f, 250.0f };
PidGains gPitch   = { 2.5f, 0.02f, 1.4f, 120.0f, 250.0f };
PidGains gYawHold = { 2.0f, 0.00f, 0.6f, 100.0f, 250.0f };
PidGains gYawRate = { 1.6f, 0.00f, 0.0f, 100.0f, 250.0f };

// ---- Anti-sway (outer loop) -- DISABLED by default (gain 0) ----------------
const float SWAY_GAIN     = 0.0f;
const float SWAY_HP_TAU   = 1.5f;
const float SWAY_VEL_LEAK = 0.5f;
const float SWAY_TILT_MAX = 8.0f;

/*==============================================================================
  SECTION 2 -- PINS / I2C ADDRESSES
==============================================================================*/
const uint8_t PIN_M1=6, PIN_M2=9, PIN_M3=10, PIN_M4=11;

#define MPU_ADDR 0x68
#define MPU_PWR1 0x6B
#define MPU_SMPLRT 0x19
#define MPU_CONFIG 0x1A
#define MPU_GYROCFG 0x1B
#define MPU_ACCCFG 0x1C
#define MPU_WHOAMI 0x75
#define MPU_ACCEL_XH 0x3B

#define QMC_ADDR 0x0D
#define QMC_DATA 0x00
#define QMC_CTRL1 0x09
#define QMC_SETRESET 0x0B

#define HMC_ADDR 0x1E
#define HMC_CFGA 0x00
#define HMC_CFGB 0x01
#define HMC_MODE 0x02
#define HMC_DATA 0x03      // order X,Z,Y (MSB first)
#define HMC_IDA  0x0A      // 'H' 0x48

#define BMP_ADDR 0x76
#define BMP_ID_REG 0xD0    // 0x58

/*==============================================================================
  SECTION 3 -- GLOBALS
==============================================================================*/
Servo esc1, esc2, esc3, esc4;

float roll=0, pitch=0, yaw=0;
float gxDps=0, gyDps=0, gzDps=0;
float axG=0, ayG=0, azG=0;
int16_t magX=0, magY=0, magZ=0;

float gyroBiasX=0, gyroBiasY=0, gyroBiasZ=0;
float magOffX=0, magOffY=0, magOffZ=0;
float magScaleX=1, magScaleY=1, magScaleZ=1;

enum CompassType { NONE, COMPASS_QMC, COMPASS_HMC };
CompassType compassType = NONE;

enum FlightState { DISARMED, ARMED };  FlightState state = DISARMED;
enum YawMode { HEADING_HOLD, YAW_COMMAND }; YawMode yawMode = HEADING_HOLD;

float headingSetpoint=0;
uint32_t centeredSince=0;
bool sensorsOk=false;

int rcRoll, rcPitch, rcThr, rcYaw;
bool rcFailsafe=true;

struct PidState { float integ, prevErr; };
PidState sRoll={0,0}, sPitch={0,0}, sYaw={0,0};
float swayAccHpX=0, swayAccHpY=0, swayVelX=0, swayVelY=0, swayPrevAx=0, swayPrevAy=0;

/*==============================================================================
  SECTION 4 -- I2C HELPERS
==============================================================================*/
void i2cWrite(uint8_t a, uint8_t r, uint8_t v){
  Wire.beginTransmission(a); Wire.write(r); Wire.write(v); Wire.endTransmission();
}
uint8_t i2cRead8(uint8_t a, uint8_t r){
  Wire.beginTransmission(a); Wire.write(r); Wire.endTransmission(false);
  Wire.requestFrom(a,(uint8_t)1); return Wire.available()?Wire.read():0;
}
bool i2cReadN(uint8_t a, uint8_t r, uint8_t* b, uint8_t n){
  Wire.beginTransmission(a); Wire.write(r);
  if(Wire.endTransmission(false)!=0) return false;
  Wire.requestFrom(a,n); uint8_t i=0; while(Wire.available()&&i<n) b[i++]=Wire.read();
  return i==n;
}
bool i2cPresent(uint8_t a){ Wire.beginTransmission(a); return Wire.endTransmission()==0; }

/*==============================================================================
  SECTION 5 -- MPU6050
==============================================================================*/
bool mpuInit(){
  if(i2cRead8(MPU_ADDR,MPU_WHOAMI)!=0x68) return false;
  i2cWrite(MPU_ADDR,MPU_PWR1,0x01);
  i2cWrite(MPU_ADDR,MPU_SMPLRT,0x00);
  i2cWrite(MPU_ADDR,MPU_CONFIG,0x03);   // DLPF ~44 Hz
  i2cWrite(MPU_ADDR,MPU_GYROCFG,0x08);  // +/-500 dps
  i2cWrite(MPU_ADDR,MPU_ACCCFG,0x00);   // +/-2 g
  delay(20); return true;
}
void mpuRead(){
  uint8_t b[14]; if(!i2cReadN(MPU_ADDR,MPU_ACCEL_XH,b,14)) return;
  int16_t ax=(b[0]<<8)|b[1], ay=(b[2]<<8)|b[3], az=(b[4]<<8)|b[5];
  int16_t gx=(b[8]<<8)|b[9], gy=(b[10]<<8)|b[11], gz=(b[12]<<8)|b[13];
  axG=ax/ACC_LSB_PER_G; ayG=ay/ACC_LSB_PER_G; azG=az/ACC_LSB_PER_G;
  gxDps=(gx-gyroBiasX)/GYRO_LSB_PER_DPS;   // verify axis signs for your mount
  gyDps=(gy-gyroBiasY)/GYRO_LSB_PER_DPS;
  gzDps=(gz-gyroBiasZ)/GYRO_LSB_PER_DPS;
}

/*==============================================================================
  SECTION 6 -- COMPASS: auto-detect HMC5883L (0x1E) vs QMC5883L (0x0D)
==============================================================================*/
CompassType compassDetect(){
  // HMC5883L identification: regs 0x0A/0x0B/0x0C = 'H','4','3'
  if(i2cPresent(HMC_ADDR) && i2cRead8(HMC_ADDR,HMC_IDA)==0x48) return COMPASS_HMC;
  if(i2cPresent(QMC_ADDR)) return COMPASS_QMC;     // QMC has no clean ID byte
  return NONE;
}
bool compassInit(){
  compassType = compassDetect();
  if(compassType==COMPASS_HMC){
    i2cWrite(HMC_ADDR,HMC_CFGA,0x70);  // 8-avg, 15 Hz, normal
    i2cWrite(HMC_ADDR,HMC_CFGB,0x20);  // gain +/-1.3 Ga
    i2cWrite(HMC_ADDR,HMC_MODE,0x00);  // continuous
    delay(10); return true;
  } else if(compassType==COMPASS_QMC){
    i2cWrite(QMC_ADDR,QMC_SETRESET,0x01);
    i2cWrite(QMC_ADDR,QMC_CTRL1,0x1D); // OSR512,8G,200Hz,continuous
    delay(10); return true;
  }
  return false;
}
bool compassRead(){
  uint8_t b[6];
  if(compassType==COMPASS_HMC){
    if(!i2cReadN(HMC_ADDR,HMC_DATA,b,6)) return false;
    magX=(int16_t)((b[0]<<8)|b[1]);    // HMC order: X, Z, Y
    magZ=(int16_t)((b[2]<<8)|b[3]);
    magY=(int16_t)((b[4]<<8)|b[5]);
    return true;
  } else if(compassType==COMPASS_QMC){
    if(!i2cReadN(QMC_ADDR,QMC_DATA,b,6)) return false;
    magX=(int16_t)((b[1]<<8)|b[0]);    // QMC order: X, Y, Z (LSB first)
    magY=(int16_t)((b[3]<<8)|b[2]);
    magZ=(int16_t)((b[5]<<8)|b[4]);
    return true;
  }
  return false;
}

bool bmpPresent(){ return i2cRead8(BMP_ADDR,BMP_ID_REG)==0x58; }

/*==============================================================================
  SECTION 7 -- FUSION
==============================================================================*/
static inline float wrap180(float a){ while(a>180)a-=360; while(a<-180)a+=360; return a; }
static inline float wrap360(float a){ while(a>=360)a-=360; while(a<0)a+=360; return a; }

float compassHeading(){
  float mx=(magX-magOffX)*magScaleX, my=(magY-magOffY)*magScaleY, mz=(magZ-magOffZ)*magScaleZ;
  float phi=roll*DEG_TO_RAD, th=pitch*DEG_TO_RAD;
  float Xh=mx*cos(th)+mz*sin(th);
  float Yh=mx*sin(phi)*sin(th)+my*cos(phi)-mz*sin(phi)*cos(th);
  return wrap360(atan2(-Yh,Xh)*RAD_TO_DEG);   // verify direction + add declination
}
void updateFusion(float dt, bool haveCompass){
  float rollAcc=atan2(ayG,azG)*RAD_TO_DEG;
  float pitchAcc=atan2(-axG,sqrt(ayG*ayG+azG*azG))*RAD_TO_DEG;
  roll =COMP_ALPHA*(roll +gxDps*dt)+(1-COMP_ALPHA)*rollAcc;
  pitch=COMP_ALPHA*(pitch+gyDps*dt)+(1-COMP_ALPHA)*pitchAcc;
  yaw=wrap360(yaw+gzDps*dt);
  if(haveCompass){ float e=wrap180(compassHeading()-yaw); yaw=wrap360(yaw+YAW_COMP_K*e); }
}

/*==============================================================================
  SECTION 8 -- RC INPUT  (PPM on INT0  OR  4x PWM on A0..A3)
==============================================================================*/
volatile uint32_t rcLastFrameUs=0;

#if RC_USE_PPM
volatile uint16_t ppm[PPM_MAXCH];
volatile uint8_t  ppmIdx=0;
volatile uint32_t ppmLastEdge=0;
void ppmISR(){
  uint32_t now=micros();
  uint32_t d=now-ppmLastEdge; ppmLastEdge=now;
  if(d>PPM_SYNC_US){ ppmIdx=0; }
  else if(ppmIdx<PPM_MAXCH){
    if(d>=RC_VALID_LO && d<=RC_VALID_HI){ ppm[ppmIdx]=(uint16_t)d; rcLastFrameUs=now; }
    ppmIdx++;
  }
}
void rcBegin(){
  for(uint8_t i=0;i<PPM_MAXCH;i++) ppm[i]=(i==IDX_THR)?RC_MIN:RC_MID;
  pinMode(PPM_PIN,INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PPM_PIN), ppmISR, RISING);
}
void rcProcess(){
  noInterrupts();
  uint16_t r=ppm[IDX_ROLL], p=ppm[IDX_PITCH], t=ppm[IDX_THR], y=ppm[IDX_YAW];
  uint32_t last=rcLastFrameUs; interrupts();
  rcRoll=r; rcPitch=p; rcThr=t; rcYaw=y;
  rcFailsafe = (micros()-last)>RC_TIMEOUT_US;
}
#else  // ---- 4x PWM on A0..A3 via PCINT1 ----
volatile uint16_t rcRaw[4]={RC_MID,RC_MID,RC_MIN,RC_MID};
volatile uint8_t  rcPrevC=0;
volatile uint32_t rcRise[4]={0,0,0,0};
ISR(PCINT1_vect){
  uint32_t now=micros(); uint8_t cur=PINC&0x0F, ch=cur^rcPrevC; rcPrevC=cur;
  for(uint8_t i=0;i<4;i++) if(ch&(1<<i)){
    if(cur&(1<<i)) rcRise[i]=now;
    else { uint16_t w=now-rcRise[i];
      if(w>=RC_VALID_LO&&w<=RC_VALID_HI){ rcRaw[i]=w; if(i==IDX_THR) rcLastFrameUs=now; } }
  }
}
void rcBegin(){
  pinMode(A0,INPUT);pinMode(A1,INPUT);pinMode(A2,INPUT);pinMode(A3,INPUT);
  rcPrevC=PINC&0x0F; PCICR|=(1<<PCIE1);
  PCMSK1|=(1<<PCINT8)|(1<<PCINT9)|(1<<PCINT10)|(1<<PCINT11);
}
void rcProcess(){
  noInterrupts();
  uint16_t r=rcRaw[IDX_ROLL],p=rcRaw[IDX_PITCH],t=rcRaw[IDX_THR],y=rcRaw[IDX_YAW];
  uint32_t last=rcLastFrameUs; interrupts();
  rcRoll=r;rcPitch=p;rcThr=t;rcYaw=y; rcFailsafe=(micros()-last)>RC_TIMEOUT_US;
}
#endif

float rcNorm(int us,int db){
  int d=us-RC_MID; if(abs(d)<db) return 0;
  float v=(float)d/(float)(RC_MAX-RC_MID); return constrain(v,-1.0f,1.0f);
}

/*==============================================================================
  SECTION 9 -- PID
==============================================================================*/
float pidStep(PidState&s,const PidGains&g,float err,float measRate,float dt){
  float out=g.kp*err;
  s.integ+=err*dt; s.integ=constrain(s.integ,-g.iMax,g.iMax); out+=g.ki*s.integ;
  out+=g.kd*(-measRate);  s.prevErr=err;
  return constrain(out,-g.outMax,g.outMax);
}
void pidReset(PidState&s){ s.integ=0; s.prevErr=0; }

/*==============================================================================
  SECTION 10 -- ANTI-SWAY (optional, SWAY_GAIN=0 disables)
  IMU-only sway velocity estimate. Replace with rope-angle sensing at the
  top-hub swivel for robust damping (2-axis encoder -> direct rope angle).
==============================================================================*/
void antiSway(float dt,float&rOff,float&pOff){
  rOff=0; pOff=0; if(SWAY_GAIN==0) return;
  float ax=axG*9.81f, ay=ayG*9.81f;
  float aHP=SWAY_HP_TAU/(SWAY_HP_TAU+dt);
  swayAccHpX=aHP*(swayAccHpX+ax-swayPrevAx);
  swayAccHpY=aHP*(swayAccHpY+ay-swayPrevAy);
  swayPrevAx=ax; swayPrevAy=ay;
  swayVelX+=swayAccHpX*dt; swayVelX-=SWAY_VEL_LEAK*swayVelX*dt;
  swayVelY+=swayAccHpY*dt; swayVelY-=SWAY_VEL_LEAK*swayVelY*dt;
  pOff=constrain(-SWAY_GAIN*swayVelX,-SWAY_TILT_MAX,SWAY_TILT_MAX);
  rOff=constrain(-SWAY_GAIN*swayVelY,-SWAY_TILT_MAX,SWAY_TILT_MAX);
}

/*==============================================================================
  SECTION 11 -- MOTOR MIXER (X frame). VERIFY SIGNS, PROPS OFF.
  +roll=right-down  +pitch=nose-up  +yaw=CCW(top view)
  M1 BL CCW | M2 FL CW | M3 FR CCW | M4 BR CW
==============================================================================*/
void mixAndWrite(int T,float roll_c,float pitch_c,float yaw_c){
  int m1=T+(int)(+roll_c-pitch_c-yaw_c);
  int m2=T+(int)(+roll_c+pitch_c+yaw_c);
  int m3=T+(int)(-roll_c+pitch_c-yaw_c);
  int m4=T+(int)(-roll_c-pitch_c+yaw_c);
  esc1.writeMicroseconds(constrain(m1,ESC_IDLE,ESC_MAX));
  esc2.writeMicroseconds(constrain(m2,ESC_IDLE,ESC_MAX));
  esc3.writeMicroseconds(constrain(m3,ESC_IDLE,ESC_MAX));
  esc4.writeMicroseconds(constrain(m4,ESC_IDLE,ESC_MAX));
}
void motorsOff(){
  esc1.writeMicroseconds(ESC_MIN); esc2.writeMicroseconds(ESC_MIN);
  esc3.writeMicroseconds(ESC_MIN); esc4.writeMicroseconds(ESC_MIN);
}

/*==============================================================================
  SECTION 12 -- ARM / DISARM / FAILSAFE
==============================================================================*/
uint32_t armStart=0, disarmStart=0;
void resetControllers(){ pidReset(sRoll);pidReset(sPitch);pidReset(sYaw);
  swayVelX=swayVelY=swayAccHpX=swayAccHpY=0; }
void disarm(){ state=DISARMED; resetControllers(); motorsOff(); }
void handleArming(){
  uint32_t t=millis();
  bool thrLow=(rcThr<=THR_ARM_MAX), yawHi=(rcYaw>=YAW_FULL_HI), yawLo=(rcYaw<=YAW_FULL_LO);
  if(state==DISARMED){
    if(sensorsOk&&thrLow&&yawHi){ if(!armStart)armStart=t;
      if(t-armStart>=COMBO_HOLD_MS){ state=ARMED; resetControllers();
        headingSetpoint=yaw; yawMode=HEADING_HOLD; armStart=0; } }
    else armStart=0;
  } else {
    if(thrLow&&yawLo){ if(!disarmStart)disarmStart=t;
      if(t-disarmStart>=COMBO_HOLD_MS){ disarm(); disarmStart=0; } }
    else disarmStart=0;
  }
}
void handleFailsafe(){
  if(rcFailsafe&&state==ARMED) disarm();
  if(state==ARMED&&(fabs(roll)>TILT_LIMIT_DEG||fabs(pitch)>TILT_LIMIT_DEG)) disarm();
}

/*==============================================================================
  SECTION 13 -- YAW HEADING-LOCK (free-yaw swivel => differential torque only)
==============================================================================*/
float yawControl(float dt){
  float stick=rcNorm(rcYaw,YAW_DEADBAND_US); uint32_t t=millis();
  if(fabs(stick)>0){
    yawMode=YAW_COMMAND; centeredSince=0;
    float rateSp=stick*MAX_YAW_RATE_DPS;          // rate control
    return pidStep(sYaw,gYawRate,rateSp-gzDps,0,dt);
  } else {
    if(yawMode==YAW_COMMAND){ if(!centeredSince)centeredSince=t;
      if(t-centeredSince>=RECAPTURE_MS){ headingSetpoint=yaw; yawMode=HEADING_HOLD; pidReset(sYaw); } }
    return pidStep(sYaw,gYawHold,wrap180(headingSetpoint-yaw),gzDps,dt);
  }
}

/*==============================================================================
  SECTION 14 -- CALIBRATION + SELF-TEST
==============================================================================*/
bool calibrateGyro(){
  const int N=1000; long sx=0,sy=0,sz=0;
  for(int i=0;i<N;i++){ uint8_t b[14];
    if(!i2cReadN(MPU_ADDR,MPU_ACCEL_XH,b,14)) return false;
    sx+=(int16_t)((b[8]<<8)|b[9]); sy+=(int16_t)((b[10]<<8)|b[11]); sz+=(int16_t)((b[12]<<8)|b[13]);
    delay(2); }
  gyroBiasX=sx/(float)N; gyroBiasY=sy/(float)N; gyroBiasZ=sz/(float)N;
  return !(fabs(gyroBiasX)>500||fabs(gyroBiasY)>500||fabs(gyroBiasZ)>500);
}
void calibrateCompass(uint32_t ms){
  int16_t xn=32767,xx=-32768,yn=32767,yx=-32768,zn=32767,zx=-32768;
  uint32_t t0=millis();
  while(millis()-t0<ms){ if(compassRead()){
    xn=min(xn,magX);xx=max(xx,magX);yn=min(yn,magY);yx=max(yx,magY);zn=min(zn,magZ);zx=max(zx,magZ);} delay(10);}
  magOffX=(xx+xn)*0.5f; magOffY=(yx+yn)*0.5f; magOffZ=(zx+zn)*0.5f;
  float rx=(xx-xn)*0.5f, ry=(yx-yn)*0.5f, rz=(zx-zn)*0.5f, ra=(rx+ry+rz)/3.0f;
  if(rx>1)magScaleX=ra/rx; if(ry>1)magScaleY=ra/ry; if(rz>1)magScaleZ=ra/rz;
}
bool selfTest(){
  if(i2cRead8(MPU_ADDR,MPU_WHOAMI)!=0x68) return false;
  if(compassType==NONE) return false;
  return true;
}

/*==============================================================================
  SECTION 15 -- SETUP
==============================================================================*/
void setup(){
  Serial.begin(115200);
  Wire.begin(); Wire.setClock(400000);

  esc1.attach(PIN_M1);esc2.attach(PIN_M2);esc3.attach(PIN_M3);esc4.attach(PIN_M4);
  motorsOff(); delay(2000);          // ESC arm window

  rcBegin();

  bool mpu=mpuInit();
  bool cmp=compassInit();
  bool bmp=bmpPresent();
  Serial.print(F("MPU:"));Serial.print(mpu);
  Serial.print(F(" COMPASS:"));
  Serial.print(compassType==COMPASS_HMC?F("HMC"):compassType==COMPASS_QMC?F("QMC"):F("NONE"));
  Serial.print(F(" BMP:"));Serial.println(bmp);

  sensorsOk = mpu && cmp && selfTest();

  if(sensorsOk){
    Serial.println(F("Gyro cal - keep still..."));
    if(!calibrateGyro()){ sensorsOk=false; Serial.println(F("GYRO CAL INVALID")); }
  }
  // Compass cal: run once, hard-code offsets. Uncomment to do interactively:
  // calibrateCompass(20000);

  if(compassRead()) yaw=compassHeading();

  wdt_enable(WDTO_250MS);  // comment out if your bootloader reset-loops
  state=DISARMED;
  Serial.println(sensorsOk?F("READY (disarmed)"):F("SENSOR FAULT - locked"));
}

/*==============================================================================
  SECTION 16 -- LOOP  (~200 Hz fixed-rate)
==============================================================================*/
uint32_t lastLoopUs=0; uint8_t cyc=0;
void loop(){
  uint32_t now=micros();
  if((uint32_t)(now-lastLoopUs)<LOOP_US) return;
  float dt=(now-lastLoopUs)*1e-6f; lastLoopUs=now; wdt_reset();

  mpuRead();
  bool haveCompass=false;
  if(++cyc>=COMPASS_EVERY){ cyc=0; haveCompass=compassRead(); }
  updateFusion(dt,haveCompass);

  rcProcess();
  handleFailsafe();
  handleArming();

  if(state==ARMED && !rcFailsafe){
    float sR,sP; antiSway(dt,sR,sP);
    float rollSp =rcNorm(rcRoll, YAW_DEADBAND_US)*RC_ANGLE_RANGE + sR;
    float pitchSp=rcNorm(rcPitch,YAW_DEADBAND_US)*RC_ANGLE_RANGE + sP;
    float rc_=pidStep(sRoll, gRoll,  rollSp-roll,   gxDps,dt);
    float pc_=pidStep(sPitch,gPitch, pitchSp-pitch, gyDps,dt);
    float yc_=yawControl(dt);
    int T=constrain(rcThr,ESC_IDLE,ESC_MAX);
    mixAndWrite(T,rc_,pc_,yc_);
  } else motorsOff();

  // static uint8_t tc=0; if(++tc>=20){tc=0;
  //   Serial.print(roll);Serial.print(',');Serial.print(pitch);
  //   Serial.print(',');Serial.print(yaw);Serial.print(',');Serial.println(state);}
}
