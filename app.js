(function () {
  "use strict";

  if (location.protocol === "file:") return;

  const $ = (id) => document.getElementById(id);

  const state = {
    port: null,
    reader: null,
    writer: null,
    readLoopAbort: false,
    spdTimer: 0,
    svSpdTimer: 0,
    svAngTimer: 0,
    svSwingOn: false,
    serialBuf: "",
    lastAttMs: 0,
    collisionTotal: 0,
    pitch: 0,
    roll: 0,
    connectedAt: null,
    lastRxMs: 0,
    pingAt: 0,
    pingTimer: null,
    imuHwOk: false,
    servoHwOk: false,
    boardReady: false,
    esc1Dir: "N",
    esc2Dir: "N",
    mediaRecorder: null,
    recordChunks: [],
    txQueue: [],
    txBusy: false,
  };

  const els = {
    log: $("log"),
    btnConnect: $("btnConnect"),
    btnDisconnect: $("btnDisconnect"),
    baud: $("baud"),
    esc1Spd: $("esc1Spd"),
    esc2Spd: $("esc2Spd"),
    btnEsc1Rev: $("btnEsc1Rev"),
    btnEsc1Stop: $("btnEsc1Stop"),
    btnEsc1Fwd: $("btnEsc1Fwd"),
    btnEsc2Rev: $("btnEsc2Rev"),
    btnEsc2Stop: $("btnEsc2Stop"),
    btnEsc2Fwd: $("btnEsc2Fwd"),
    cmdInput: $("cmdInput"),
    btnCmdSend: $("btnCmdSend"),
    svSpd: $("svSpd"),
    svAngle: $("svAngle"),
    btnSvToggle: $("btnSvToggle"),
    btnSvStop: $("btnSvStop"),
    btnSvApply: $("btnSvApply"),
    btnImuZero: $("btnImuZero"),
    btnStopAll: $("btnStopAll"),
    btnEmergency: $("btnEmergency"),
    esc1Status: $("esc1Status"),
    esc2Status: $("esc2Status"),
    svStatus: $("svStatus"),
    svAngleVal: $("svAngleVal"),
    btnClearLog: $("btnClearLog"),
    btnExportLog: $("btnExportLog"),
    adiHorizon: $("adiHorizon"),
    collisionFlash: $("collisionFlash"),
    webcam: $("webcam"),
    webcamHint: $("webcamHint"),
    webcamHintText: $("webcamHintText"),
    btnWebcamStart: $("btnWebcamStart"),
    btnVidCamera: $("btnVidCamera"),
    btnVidRecord: $("btnVidRecord"),
    btnVidMic: $("btnVidMic"),
    hudPitch: $("hudPitch"),
    dataPitchVal: $("dataPitchVal"),
    dataRollVal: $("dataRollVal"),
    dataYawVal: $("dataYawVal"),
    dataGxVal: $("dataGxVal"),
    dataGyVal: $("dataGyVal"),
    dataGzVal: $("dataGzVal"),
    robotConnBadge: $("robotConnBadge"),
    robotStatusVal: $("robotStatusVal"),
    robotDepthVal: $("robotDepthVal"),
    statPitch: $("statPitch"),
    statImu: $("statImu"),
    statEsc1: $("statEsc1"),
    statEsc2: $("statEsc2"),
    statEsc1Val: $("statEsc1Val"),
    statEsc2Val: $("statEsc2Val"),
    statServo: $("statServo"),
    statServoVal: $("statServoVal"),
    statCamera: $("statCamera"),
    connQuality: $("connQuality"),
    connPacketLoss: $("connPacketLoss"),
    statCameraVal: $("statCameraVal"),
    statDepth: $("statDepth"),
    statDepthVal: $("statDepthVal"),
    hdrDepth: $("hdrDepth"),
    hdrSignal: $("hdrSignal"),
    gaugeBattery: $("gaugeBattery"),
    runTime: $("runTime"),
    connLatency: $("connLatency"),
    svAngleDisp: $("svAngleDisp"),
    tlFlow: document.querySelector("#timeline .tl-flow"),
  };

  function appendLog(text) {
    if (!text || !els.log) return;
    els.log.textContent += text;
    if (els.log.textContent.length > 12000) {
      els.log.textContent = els.log.textContent.slice(-8000);
    }
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setSensorStatus(el, on, labelOn, labelOff) {
    if (!el) return;
    el.textContent = on ? labelOn || "正常" : labelOff || "未连接";
    el.classList.toggle("bad", !on);
    el.classList.toggle("ok", on);
  }

  const ESC_DIR_LABEL = { N: "停止", F: "正转", R: "反转" };

  function clampSpd(v) {
    return Math.min(100, Math.max(1, Math.round(Number(v) || 30)));
  }

  function motorSpd(motor) {
    const el = motor === 1 ? els.esc1Spd : els.esc2Spd;
    return clampSpd(el?.value ?? 30);
  }

  function escValLabel(motor) {
    const dir = motor === 1 ? state.esc1Dir : state.esc2Dir;
    if (dir === "N") return "停止";
    return (ESC_DIR_LABEL[dir] || dir) + " " + motorSpd(motor) + "%";
  }

  function escSpdTag(motor) {
    return motor === 1 ? "SPD1:" : "SPD2:";
  }

  function escCmdForDir(motor, dir) {
    if (dir === "F") return "M" + motor + "F";
    if (dir === "R") return "M" + motor + "R";
    return "M" + motor + "N";
  }

  function highlightEscButtons(motor) {
    const dir = motor === 1 ? state.esc1Dir : state.esc2Dir;
    const btns =
      motor === 1
        ? [els.btnEsc1Rev, els.btnEsc1Stop, els.btnEsc1Fwd]
        : [els.btnEsc2Rev, els.btnEsc2Stop, els.btnEsc2Fwd];
    const map = { R: 0, N: 1, F: 2 };
    btns.forEach((btn, i) => btn?.classList.toggle("active", i === map[dir]));
  }

  async function commitEscMotor(motor, dir) {
    if (motor === 1) state.esc1Dir = dir;
    else state.esc2Dir = dir;
    updateEscDisplay(motor, dir);
    if (!state.writer) return;
    try {
      await sendLine(escSpdTag(motor) + motorSpd(motor));
      await sendLine(escCmdForDir(motor, dir));
    } catch (e) {
      appendLog("[发送失败] " + (e?.message || String(e)) + "\n");
    }
  }

  async function refreshEscSpdMotor(motor) {
    if (!state.writer) return;
    const el = motor === 1 ? els.esc1Spd : els.esc2Spd;
    if (el) el.value = String(motorSpd(motor));
    updateEscDisplay(motor);
    try {
      await sendLine(escSpdTag(motor) + motorSpd(motor));
    } catch (e) {
      appendLog("[速度更新失败] " + (e?.message || String(e)) + "\n");
    }
  }

  async function stopAllEsc() {
    state.esc1Dir = state.esc2Dir = "N";
    updateEscDisplay(1, "N");
    updateEscDisplay(2, "N");
    highlightEscButtons(1);
    highlightEscButtons(2);
    if (!state.writer) return;
    try {
      await sendLine("STOP");
    } catch (e) {
      appendLog("[停止失败] " + (e?.message || String(e)) + "\n");
    }
  }

  async function sendManualCmd() {
    const raw = (els.cmdInput?.value || "").trim();
    if (!raw || !state.writer) return;
    try {
      await sendLine(raw);
      appendLog("[手动] >> " + raw + "\n");
    } catch (e) {
      appendLog("[手动发送失败] " + (e?.message || String(e)) + "\n");
    }
  }

  function setEscControlsEnabled(on) {
    const ids = [
      els.esc1Spd,
      els.esc2Spd,
      els.btnEsc1Rev,
      els.btnEsc1Stop,
      els.btnEsc1Fwd,
      els.btnEsc2Rev,
      els.btnEsc2Stop,
      els.btnEsc2Fwd,
      els.cmdInput,
      els.btnCmdSend,
    ];
    ids.forEach((el) => {
      if (el) el.disabled = !on;
    });
  }

  function resetEscUi() {
    state.esc1Dir = state.esc2Dir = "N";
    updateEscDisplay(1, "N");
    updateEscDisplay(2, "N");
    highlightEscButtons(1);
    highlightEscButtons(2);
  }

  function updateEscDisplay(motor, dir) {
    const key = motor === 1 ? "esc1Dir" : "esc2Dir";
    if (dir) state[key] = dir;
    const valEl = motor === 1 ? els.statEsc1Val : els.statEsc2Val;
    const stEl = motor === 1 ? els.statEsc1 : els.statEsc2;
    const hwSt = motor === 1 ? els.esc1Status : els.esc2Status;
    const label = escValLabel(motor);
    if (valEl) valEl.textContent = label;
    if (hwSt && state.port) hwSt.textContent = label;
    if (stEl && state.port) setSensorStatus(stEl, state.boardReady, "正常", "未连接");
    highlightEscButtons(motor);
  }

  function updateServoDisplay() {
    const ang = els.svAngle ? els.svAngle.value + "°" : "--";
    if (els.svAngleVal) els.svAngleVal.textContent = ang;
    if (els.statServoVal) {
      if (state.svSwingOn) els.statServoVal.textContent = "摆动";
      else if (els.svAngle) els.statServoVal.textContent = els.svAngle.value + "°";
      else els.statServoVal.textContent = "--";
    }
    if (els.svStatus && state.port) {
      els.svStatus.textContent = state.svSwingOn ? "摆动中" : state.servoHwOk ? ang : "等待";
    }
    if (els.statServo && state.port) {
      const ok = state.servoHwOk && state.boardReady;
      setSensorStatus(els.statServo, ok, state.svSwingOn ? "摆动" : "正常", ok ? "异常" : "未连接");
    }
  }

  function updateDepthDisplay() {
    const text = "23.6m";
    if (els.statDepthVal) els.statDepthVal.textContent = text;
    if (els.hdrDepth) els.hdrDepth.textContent = text;
    if (els.robotDepthVal) els.robotDepthVal.textContent = text;
    setSensorStatus(els.statDepth, false, "正常", "未连接");
  }

  function markSerialRx() {
    state.lastRxMs = Date.now();
    if (state.port && els.connQuality) els.connQuality.textContent = "强";
    if (state.port && els.hdrSignal) els.hdrSignal.textContent = "强";
  }

  function parseDeviceLine(t) {
    markSerialRx();

    if (t === "PONG" && state.pingAt) {
      const ms = Math.round(performance.now() - state.pingAt);
      if (els.connLatency) els.connLatency.textContent = ms + " ms";
      state.pingAt = 0;
      return true;
    }
    if (t === "Ready.") {
      state.boardReady = true;
      setMotorsReady(true);
      updateEscDisplay(1);
      updateEscDisplay(2);
      updateServoDisplay();
      pushTimeline("电调已解锁，可以控制", false);
      return true;
    }
    if (t.includes("OK MPU6050") || t.startsWith("OK IMU")) {
      state.imuHwOk = true;
      return true;
    }
    if (t.includes("ERR MPU6050") || t.includes("ERR IMU reinit failed")) {
      state.imuHwOk = false;
      setSensorStatus(els.statImu, false, "正常", "未连接");
      return true;
    }
    if (t.includes("ERR IMU")) {
      setSensorStatus(els.statImu, false, "正常", "无数据");
      return true;
    }
    if (t.includes("ERR TailServo") || t.includes("ERR Servo") || t.includes("ERR SVON") || t.includes("ERR SVANG")) {
      state.servoHwOk = false;
      state.svSwingOn = false;
      if (els.btnSvToggle) els.btnSvToggle.textContent = "摆动";
      updateServoDisplay();
      return true;
    }
    if (t.startsWith("OK SV") || t.startsWith("OK SVSPD") || t.startsWith("OK SVANG")) {
      state.servoHwOk = true;
      updateServoDisplay();
      return true;
    }
    if (t.startsWith("OK SVOFF")) {
      state.svSwingOn = false;
      if (els.btnSvToggle) els.btnSvToggle.textContent = "摆动";
      updateServoDisplay();
      return true;
    }
    if (t === "OK SVON") {
      state.svSwingOn = true;
      if (els.btnSvToggle) els.btnSvToggle.textContent = "停止";
      updateServoDisplay();
      return true;
    }
    if (t.startsWith("OK M1")) {
      state.esc1Dir = t.includes("M1F") ? "F" : t.includes("M1R") ? "R" : "N";
      updateEscDisplay(1);
      return true;
    }
    if (t.startsWith("OK M2")) {
      state.esc2Dir = t.includes("M2F") ? "F" : t.includes("M2R") ? "R" : "N";
      updateEscDisplay(2);
      return true;
    }
    if (t.startsWith("OK STOP")) {
      state.esc1Dir = state.esc2Dir = "N";
      updateEscDisplay(1);
      updateEscDisplay(2);
      return true;
    }
    if (t.startsWith("OK SPD1") || t.startsWith("OK SPD2") || t.startsWith("OK SPD")) {
      state.boardReady = true;
      return true;
    }
    if (t.startsWith("OK US1") || t.startsWith("OK US2")) {
      state.boardReady = true;
      return true;
    }
    if (t.includes("OK ESC1 GPIO") || t.includes("OK ESC2 GPIO") || t.includes("50Hz") || t.includes("period=")) {
      state.boardReady = true;
      if (t.includes("Servo")) state.servoHwOk = true;
      updateEscDisplay(1);
      updateEscDisplay(2);
      updateServoDisplay();
      return true;
    }
    if (t.includes("ERR ESC1") || t.includes("ERR ESC2")) {
      state.boardReady = false;
      return true;
    }
    return false;
  }

  /** Figma 滑轨：中心 50 无填充，左 rev / 右 fwd */
  function updateTrackThumb(slider, thumb) {
    if (!slider) return;
    const v = Number(slider.value);
    const track = slider.parentElement;
    if (!track) return;
    track.classList.remove("fwd", "rev");
    const span = Math.abs(v - 50) * 2;
    if (thumb) {
      if (span < 1) {
        thumb.style.width = "0";
        thumb.style.left = "50%";
        thumb.style.right = "auto";
        thumb.style.transform = "translateX(-50%)";
      } else if (v > 50) {
        track.classList.add("fwd");
        thumb.style.left = "50%";
        thumb.style.right = "auto";
        thumb.style.width = span + "%";
        thumb.style.transform = "none";
      } else {
        track.classList.add("rev");
        thumb.style.left = "auto";
        thumb.style.right = "50%";
        thumb.style.width = span + "%";
        thumb.style.transform = "none";
      }
    }
  }

  function updateServoAngleThumb() {
    if (!els.svAngle) return;
    const v = Number(els.svAngle.value);
    if (els.svAngleDisp) els.svAngleDisp.textContent = v + "°";
    updateServoDisplay();
  }

  async function applyServoAngle() {
    if (!state.writer || !els.svAngle) return;
    updateServoAngleThumb();
    try {
      await sendLine("SVANG:" + els.svAngle.value);
    } catch (e) {
      appendLog("[舵机] 发送失败 " + (e?.message || String(e)) + "\n");
    }
  }

  async function stopServo() {
    if (!state.writer) return;
    try {
      await sendLine("SVOFF");
      state.svSwingOn = false;
      if (els.btnSvToggle) els.btnSvToggle.textContent = "摆动";
      updateServoDisplay();
    } catch (e) {
      appendLog("[舵机] 停止失败 " + (e?.message || String(e)) + "\n");
    }
  }

  async function applyServoSwingSpeed() {
    if (!state.writer || !els.svSpd) return;
    try {
      await sendLine("SVSPD:" + els.svSpd.value);
    } catch (e) {
      appendLog("[舵机] 速度发送失败\n");
    }
  }

  function updateAttitude(pitch, roll) {
    if (!Number.isFinite(pitch) || !Number.isFinite(roll)) return;
    state.lastAttMs = Date.now();
    state.lastRxMs = Date.now();
    state.imuHwOk = true;
    state.pitch = pitch;
    state.roll = roll;
    const pStr = (pitch >= 0 ? "+" : "") + pitch.toFixed(1) + "°";
    const rStr = (roll >= 0 ? "+" : "") + roll.toFixed(1) + "°";
    if (els.hudPitch) els.hudPitch.textContent = pitch.toFixed(0);
    if (els.dataPitchVal) els.dataPitchVal.textContent = pStr;
    if (els.dataRollVal) els.dataRollVal.textContent = rStr;
    if (els.statPitch) els.statPitch.textContent = pitch.toFixed(1) + "°";
    if (els.adiHorizon) {
      els.adiHorizon.setAttribute(
        "transform",
        "rotate(" + roll.toFixed(2) + ") translate(0," + (pitch * 1.2).toFixed(2) + ")"
      );
    }
    setSensorStatus(els.statImu, true, "正常", "无数据");
    if (els.robotStatusVal) els.robotStatusVal.textContent = "正常";
  }

  function showCollision(impulse, jerk) {
    state.collisionTotal += 1;
    if (els.collisionFlash) {
      els.collisionFlash.classList.add("show");
      setTimeout(() => els.collisionFlash.classList.remove("show"), 1500);
    }
    appendLog(
      "[碰撞] 冲击 " +
        (Number.isFinite(impulse) ? impulse.toFixed(2) : "?") +
        " m/s²" +
        (Number.isFinite(jerk) ? " · jerk " + jerk.toFixed(1) : "") +
        "\n"
    );
    pushTimeline("检测到碰撞 · 冲击 " + (Number.isFinite(impulse) ? impulse.toFixed(2) : "?") + " m/s²", true);
  }

  function handleSerialLine(line) {
    const t = line.trim();
    if (!t) return;
    parseDeviceLine(t);
    if (t.startsWith("ATT:")) {
      const parts = t.slice(4).split(",");
      if (parts.length >= 2) updateAttitude(parseFloat(parts[0]), parseFloat(parts[1]));
      return;
    }
    if (t.startsWith("COL:")) {
      const parts = t.slice(4).split(",");
      showCollision(parseFloat(parts[0]), parseFloat(parts[1]));
      return;
    }
    if (t.includes("STOP (collision)")) {
      if (els.collisionFlash) els.collisionFlash.classList.add("show");
      resetEscUi();
      state.esc1Dir = state.esc2Dir = "N";
      updateEscDisplay(1);
      updateEscDisplay(2);
    }
    appendLog(t + "\n");
  }

  function feedSerialChunk(chunk) {
    state.serialBuf += chunk;
    let idx;
    while ((idx = state.serialBuf.indexOf("\n")) >= 0) {
      handleSerialLine(state.serialBuf.slice(0, idx));
      state.serialBuf = state.serialBuf.slice(idx + 1);
    }
  }

  function resetEscSliders() {
    resetEscUi();
  }

  function stopPingLoop() {
    if (state.pingTimer) clearInterval(state.pingTimer);
    state.pingTimer = null;
    state.pingAt = 0;
  }

  function startPingLoop() {
    stopPingLoop();
    state.pingTimer = setInterval(async () => {
      if (!state.writer) return;
      state.pingAt = performance.now();
      try {
        await sendLine("PING");
      } catch (_) {}
    }, 2000);
  }

  function setMotorsReady(on) {
    setEscControlsEnabled(on);
    if (els.btnStopAll) els.btnStopAll.disabled = !on;
    if (els.btnEmergency) els.btnEmergency.disabled = !on;
    if (els.btnSvToggle) els.btnSvToggle.disabled = !on;
    if (els.btnSvStop) els.btnSvStop.disabled = !on;
    if (els.btnSvApply) els.btnSvApply.disabled = !on;
    if (els.svSpd) els.svSpd.disabled = !on;
    if (els.svAngle) els.svAngle.disabled = !on;
    if (els.btnImuZero) els.btnImuZero.disabled = !on;
    const hint = on ? "就绪 · 点正转" : "电调解锁中…";
    if (els.esc1Status && state.port) els.esc1Status.textContent = hint;
    if (els.esc2Status && state.port) els.esc2Status.textContent = hint;
  }

  function setConnected(on) {
    els.btnConnect.disabled = on;
    els.btnDisconnect.disabled = !on;
    els.baud.disabled = on;
    setMotorsReady(false);

    if (els.connQuality) els.connQuality.textContent = on ? "强" : "--";
    if (els.hdrSignal) els.hdrSignal.textContent = on ? "强" : "--";
    if (els.connLatency) els.connLatency.textContent = on ? "42 ms" : "--";
    if (els.connPacketLoss) els.connPacketLoss.textContent = on ? "0.2%" : "--";
    if (els.robotConnBadge) {
      els.robotConnBadge.textContent = on ? "已连接" : "未连接";
      els.robotConnBadge.classList.toggle("off", !on);
    }
    if (els.robotStatusVal) els.robotStatusVal.textContent = on ? "正常" : "--";

    if (!on) {
      stopPingLoop();
      state.boardReady = false;
      state.imuHwOk = false;
      state.servoHwOk = false;
      state.lastRxMs = 0;
      state.lastAttMs = 0;
      state.esc1Dir = state.esc2Dir = "N";
      state.svSwingOn = false;
      if (els.btnSvToggle) els.btnSvToggle.textContent = "摆动";
      setSensorStatus(els.statImu, false, "正常", "未连接");
      setSensorStatus(els.statEsc1, false, "正常", "未连接");
      setSensorStatus(els.statEsc2, false, "正常", "未连接");
      setSensorStatus(els.statServo, false, "正常", "未连接");
      if (els.statEsc1Val) els.statEsc1Val.textContent = "--";
      if (els.statEsc2Val) els.statEsc2Val.textContent = "--";
      if (els.statServoVal) els.statServoVal.textContent = "--";
      if (els.esc1Status) els.esc1Status.textContent = "未连接";
      if (els.esc2Status) els.esc2Status.textContent = "未连接";
      if (els.svStatus) els.svStatus.textContent = "未连接";
      if (els.statPitch) els.statPitch.textContent = "--";
      if (els.connLatency) els.connLatency.textContent = "--";
      if (els.connPacketLoss) els.connPacketLoss.textContent = "--";
      if (els.adiHorizon) els.adiHorizon.setAttribute("transform", "rotate(0) translate(0,0)");
      state.connectedAt = null;
      updateDepthDisplay();
    } else {
      state.connectedAt = Date.now();
      state.boardReady = false;
      state.imuHwOk = false;
      state.servoHwOk = false;
      setSensorStatus(els.statEsc1, false, "正常", "等待");
      setSensorStatus(els.statEsc2, false, "正常", "等待");
      setSensorStatus(els.statServo, false, "正常", "等待");
      setSensorStatus(els.statImu, false, "正常", "等待");
      if (els.statEsc1Val) els.statEsc1Val.textContent = "停止";
      if (els.statEsc2Val) els.statEsc2Val.textContent = "停止";
      updateServoDisplay();
      updateDepthDisplay();
      pushTimeline("串口已连接", false);
      startPingLoop();
    }
  }

  async function startRead() {
    const decoder = new TextDecoder();
    state.readLoopAbort = false;
    while (state.port && state.port.readable && !state.readLoopAbort) {
      const reader = state.port.readable.getReader();
      state.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) feedSerialChunk(decoder.decode(value, { stream: true }));
        }
      } catch (e) {
        appendLog("\n[读取出错] " + (e?.message || String(e)) + "\n");
      } finally {
        reader.releaseLock();
        state.reader = null;
      }
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitForReady(timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (state.boardReady) return true;
      await sleep(100);
    }
    return state.boardReady;
  }

  async function connect() {
    if (!("serial" in navigator)) {
      alert("请用 Chrome 或 Edge 打开 http://127.0.0.1:8765/");
      return;
    }
    try {
      state.port = await navigator.serial.requestPort();
      const t0 = performance.now();
      await state.port.open({ baudRate: Number(els.baud.value) });
      if (els.connLatency) els.connLatency.textContent = Math.round(performance.now() - t0) + " ms";
      state.writer = state.port.writable.getWriter();
      state.serialBuf = "";
      state.boardReady = false;
      setConnected(true);
      startRead();
      appendLog("[已连接 " + els.baud.value + "，等待电调解锁…]\n");
      const ready = await waitForReady(12000);
      if (!ready) {
        appendLog("[警告] 12s 内未收到 Ready，请重新插拔或按 RST\n");
      }
      await sendLine("COLL0");
      await sleep(80);
      await sendLine("IMUINIT");
      await sleep(200);
      await sendLine("SPD1:50");
      await sendLine("SPD2:50");
      await sendLine("IMU1");
    } catch (e) {
      if (e?.name === "NotFoundError") return;
      appendLog("\n[连接失败] " + (e?.message || String(e)) + "\n");
      await disconnect();
    }
  }

  async function disconnect() {
    stopPingLoop();
    state.readLoopAbort = true;
    try {
      if (state.reader) await state.reader.cancel();
    } catch (_) {}
    state.reader = null;
    try {
      if (state.writer && state.svSwingOn) await sendLine("SVOFF");
    } catch (_) {}
    state.svSwingOn = false;
    try {
      if (state.writer) await state.writer.close();
    } catch (_) {}
    state.writer = null;
    try {
      if (state.port) await state.port.close();
    } catch (_) {}
    state.port = null;
    state.txQueue = [];
    state.txBusy = false;
    setConnected(false);
    appendLog("[已断开]\n");
  }

  async function drainTxQueue() {
    if (state.txBusy || !state.txQueue.length || !state.writer) return;
    state.txBusy = true;
    try {
      while (state.txQueue.length && state.writer) {
        const job = state.txQueue.shift();
        try {
          const text = job.line.endsWith("\n") ? job.line : job.line + "\n";
          await state.writer.write(new TextEncoder().encode(text));
          job.resolve();
        } catch (e) {
          job.reject(e);
        }
        if (state.txQueue.length) await sleep(20);
      }
    } finally {
      state.txBusy = false;
      if (state.txQueue.length) drainTxQueue();
    }
  }

  async function sendLine(line) {
    if (!state.writer || line == null || line === "") return;
    return new Promise((resolve, reject) => {
      state.txQueue.push({ line: String(line), resolve, reject });
      drainTxQueue();
    });
  }

  function pushTimeline(text, warn) {
    const flow = els.tlFlow;
    if (!flow) return;
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    const sep = document.createElement("div");
    sep.className = "tl-sep";
    const node = document.createElement("div");
    node.className = "tl-node" + (warn ? " warn" : "");
    node.innerHTML = '<span class="tm">' + time + "</span> " + text;
    flow.appendChild(sep);
    flow.appendChild(node);
    while (flow.children.length > 14) flow.removeChild(flow.firstChild);
  }

  function tickClock() {
    const now = new Date();
    const clockEl = $("clockTime");
    const dateEl = $("clockDate");
    if (clockEl) clockEl.textContent = now.toTimeString().slice(0, 8);
    if (dateEl) {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      dateEl.textContent = y + "-" + m + "-" + d;
    }
    const bat = els.gaugeBattery?.textContent;
    if (bat && $("gaugeBattery2")) $("gaugeBattery2").textContent = bat;
    updateDepthDisplay();
    if (state.connectedAt && els.runTime) {
      const s = Math.floor((Date.now() - state.connectedAt) / 1000);
      const h = String(Math.floor(s / 3600)).padStart(2, "0");
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const sec = String(s % 60).padStart(2, "0");
      els.runTime.textContent = h + ":" + m + ":" + sec;
    }
  }

  els.btnConnect?.addEventListener("click", connect);
  els.btnDisconnect?.addEventListener("click", disconnect);
  els.btnClearLog?.addEventListener("click", () => {
    if (els.log) els.log.textContent = "";
  });
  els.btnExportLog?.addEventListener("click", () => {
    const blob = new Blob([els.log?.textContent || ""], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vanta-serial-log.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  els.btnStopAll?.addEventListener("click", () => stopAllEsc());
  els.btnEmergency?.addEventListener("click", async () => {
    await stopAllEsc();
    await sendLine("SVOFF");
    pushTimeline("紧急上浮 · 全部停止", true);
  });
  els.btnImuZero?.addEventListener("click", () => sendLine("IMUZERO"));
  els.btnEsc1Rev?.addEventListener("click", () => commitEscMotor(1, "R"));
  els.btnEsc1Stop?.addEventListener("click", () => commitEscMotor(1, "N"));
  els.btnEsc1Fwd?.addEventListener("click", () => commitEscMotor(1, "F"));
  els.btnEsc2Rev?.addEventListener("click", () => commitEscMotor(2, "R"));
  els.btnEsc2Stop?.addEventListener("click", () => commitEscMotor(2, "N"));
  els.btnEsc2Fwd?.addEventListener("click", () => commitEscMotor(2, "F"));
  els.esc1Spd?.addEventListener("change", () => refreshEscSpdMotor(1));
  els.esc2Spd?.addEventListener("change", () => refreshEscSpdMotor(2));
  els.btnSvApply?.addEventListener("click", () => applyServoAngle());
  els.svSpd?.addEventListener("change", () => applyServoSwingSpeed());
  els.btnCmdSend?.addEventListener("click", () => sendManualCmd());
  els.cmdInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendManualCmd();
    }
  });
  els.svAngle?.addEventListener("input", () => updateServoAngleThumb());

  els.btnSvToggle?.addEventListener("click", () => {
    if (!state.writer) return;
    sendLine(state.svSwingOn ? "SVOFF" : "SVON");
  });
  els.btnSvStop?.addEventListener("click", () => stopServo());

  setInterval(() => {
    tickClock();
    const now = Date.now();
    if (state.port && state.lastAttMs && now - state.lastAttMs > 2500) {
      setSensorStatus(els.statImu, false, "正常", "无数据");
    }
    if (state.port) {
      const stale = state.lastRxMs ? now - state.lastRxMs > 4000 : state.connectedAt && now - state.connectedAt > 4000;
      if (stale) {
        if (els.connQuality) els.connQuality.textContent = "弱";
        if (els.hdrSignal) els.hdrSignal.textContent = "弱";
      }
    }
  }, 500);

  async function startWebcam() {
    if (!els.webcam || !navigator.mediaDevices?.getUserMedia) {
      setWebcamHint(true, "当前浏览器不支持摄像头 API，请用 Chrome/Edge 打开");
      return;
    }
    const constraintsList = [
      { video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: true, audio: false },
    ];
    let lastErr = null;
    for (const constraints of constraintsList) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        els.webcam.srcObject = stream;
        await els.webcam.play().catch(() => {});
        setWebcamHint(false);
        setSensorStatus(els.statCamera, true, "正常", "未连接");
        if (els.statCameraVal) els.statCameraVal.textContent = "在线";
        appendLog("[摄像头] 已开启\n");
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    const msg = lastErr?.message || "请允许浏览器使用相机权限";
    setWebcamHint(true, "无法访问摄像头：" + msg);
    setSensorStatus(els.statCamera, false, "正常", "未连接");
    if (els.statCameraVal) els.statCameraVal.textContent = "--";
    appendLog("[摄像头] " + msg + "\n");
  }

  function setWebcamHint(show, text) {
    if (!els.webcamHint) return;
    els.webcamHint.classList.toggle("is-hidden", !show);
    if (text && els.webcamHintText) els.webcamHintText.textContent = text;
  }

  function stopWebcam() {
    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
      state.mediaRecorder.stop();
    }
    const stream = els.webcam?.srcObject;
    if (stream && typeof stream.getTracks === "function") {
      stream.getTracks().forEach((t) => t.stop());
    }
    if (els.webcam) els.webcam.srcObject = null;
    setWebcamHint(true, "点击打开摄像头（需浏览器权限）");
    setSensorStatus(els.statCamera, false, "正常", "未连接");
    if (els.statCameraVal) els.statCameraVal.textContent = "--";
  }

  function captureWebcamFrame() {
    const video = els.webcam;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "vanta-capture-" + Date.now() + ".png";
    a.click();
    appendLog("[摄像头] 已截图\n");
  }

  function toggleRecording() {
    const stream = els.webcam?.srcObject;
    if (!stream || !window.MediaRecorder) return;
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      state.mediaRecorder.stop();
      return;
    }
    state.recordChunks = [];
    try {
      state.mediaRecorder = new MediaRecorder(stream);
      state.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size) state.recordChunks.push(e.data);
      };
      state.mediaRecorder.onstop = () => {
        const blob = new Blob(state.recordChunks, { type: "video/webm" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "vanta-record-" + Date.now() + ".webm";
        a.click();
        URL.revokeObjectURL(a.href);
        els.btnVidRecord?.classList.remove("is-recording");
        els.btnVidRecord?.setAttribute("aria-pressed", "false");
        appendLog("[摄像头] 录制已保存\n");
      };
      state.mediaRecorder.start();
      els.btnVidRecord?.classList.add("is-recording");
      els.btnVidRecord?.setAttribute("aria-pressed", "true");
      appendLog("[摄像头] 开始录制\n");
    } catch (e) {
      appendLog("[摄像头] 录制失败: " + (e?.message || String(e)) + "\n");
    }
  }

  function toggleMicMute() {
    const stream = els.webcam?.srcObject;
    const audioTracks = stream?.getAudioTracks?.() || [];
    const btn = els.btnVidMic;
    if (!btn) return;
    const nextMuted = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", nextMuted ? "true" : "false");
    audioTracks.forEach((t) => {
      t.enabled = !nextMuted;
    });
    appendLog("[摄像头] 麦克风" + (nextMuted ? "关闭" : "开启") + "\n");
  }

  els.btnVidCamera?.addEventListener("click", captureWebcamFrame);
  els.btnVidRecord?.addEventListener("click", toggleRecording);
  els.btnVidMic?.addEventListener("click", toggleMicMute);
  els.btnWebcamStart?.addEventListener("click", () => startWebcam());
  els.webcam?.addEventListener("playing", () => {
    setWebcamHint(false);
    setSensorStatus(els.statCamera, true, "正常", "未连接");
    if (els.statCameraVal) els.statCameraVal.textContent = "在线";
  });

  window.addEventListener("beforeunload", () => {
    stopWebcam();
    disconnect();
  });

  updateServoAngleThumb();
  highlightEscButtons(1);
  highlightEscButtons(2);
  tickClock();
  updateDepthDisplay();
  setWebcamHint(true, "点击「打开摄像头」或下方按钮");
})();
