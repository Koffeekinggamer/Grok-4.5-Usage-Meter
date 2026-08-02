"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const { stepNeedle } = require("./lib/gauge");
const { faceFrame } = require("./lib/face");

contextBridge.exposeInMainWorld("tokenMeter", {
  onFaceUpdate(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("meter:face", handler);
    return () => ipcRenderer.removeListener("meter:face", handler);
  },
  getFace() {
    return ipcRenderer.invoke("meter:getFace");
  },
  refresh() {
    return ipcRenderer.invoke("usage:refresh");
  },
  dragBy(dx, dy) {
    ipcRenderer.send("window:drag", { dx, dy });
  },
  stepNeedle(state, targetAngle, dtSeconds) {
    return stepNeedle(state, targetAngle, dtSeconds);
  },
  faceFrame(face, angles) {
    return faceFrame(face, angles);
  },
  bml: {
    getState() {
      return ipcRenderer.invoke("bml:getState");
    },
    onState(callback) {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on("bml:state", handler);
      return () => ipcRenderer.removeListener("bml:state", handler);
    },
    setPanelOpen(open) {
      return ipcRenderer.invoke("bml:setPanelOpen", open);
    },
    togglePanel() {
      return ipcRenderer.invoke("bml:togglePanel");
    },
    setFields(fields) {
      return ipcRenderer.invoke("bml:setFields", fields);
    },
    applyProjectToFields(opts) {
      return ipcRenderer.invoke("bml:applyProjectToFields", opts || {});
    },
    createExperiment(fields) {
      return ipcRenderer.invoke("bml:createExperiment", fields);
    },
    selectExperiment(issueRef) {
      return ipcRenderer.invoke("bml:selectExperiment", issueRef);
    },
    refreshBoard() {
      return ipcRenderer.invoke("bml:refreshBoard");
    },
    advanceStage() {
      return ipcRenderer.invoke("bml:advanceStage");
    },
    runSkillStep() {
      return ipcRenderer.invoke("bml:runSkillStep");
    },
    nextSkillStep() {
      return ipcRenderer.invoke("bml:nextSkillStep");
    },
    skipOptionalStep() {
      return ipcRenderer.invoke("bml:skipOptionalStep");
    },
    setTinyBuild() {
      return ipcRenderer.invoke("bml:setTinyBuild");
    },
    setBuildFlags(flags) {
      return ipcRenderer.invoke("bml:setBuildFlags", flags);
    },
    setMeasureFlags(flags) {
      return ipcRenderer.invoke("bml:setMeasureFlags", flags);
    },
    postMeasure(note) {
      return ipcRenderer.invoke("bml:postMeasure", note);
    },
    recordLearn(payload) {
      return ipcRenderer.invoke("bml:recordLearn", payload);
    },
    setStep(index) {
      return ipcRenderer.invoke("bml:setStep", index);
    },
    openUrl(url) {
      return ipcRenderer.invoke("bml:openUrl", url);
    },
  },
});
