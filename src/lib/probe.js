import { execFile } from "node:child_process";
import { createConnection } from "node:net";
import ipaddr from "ipaddr.js";
import snmp from "net-snmp";

function validatedIp(value) {
  return ipaddr.parse(value).toString();
}

export async function performICMPProbe(ip) {
  const target = validatedIp(ip);
  const isWindows = process.platform === "win32";
  const argumentsList = isWindows ? ["-n", "1", "-w", "1000", target] : ["-c", "1", "-W", "1", target];
  return new Promise((resolve) => {
    const startTime = Date.now();
    execFile("ping", argumentsList, { timeout: 3000, windowsHide: true }, (error) => {
      resolve({ alive: !error, latencyMs: error ? null : Date.now() - startTime });
    });
  });
}

export async function performTCPProbe(ip, port) {
  const target = validatedIp(ip);
  const targetPort = Number(port);
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error("Invalid TCP port");

  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = createConnection({ port: targetPort, host: target, timeout: 1000 });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish({ alive: true, latencyMs: Date.now() - startTime }));
    socket.once("timeout", () => finish({ alive: false, latencyMs: null }));
    socket.once("error", () => finish({ alive: false, latencyMs: null }));
  });
}

export async function performSNMPProbe(ip, community, version = "v2c") {
  const target = validatedIp(ip);
  if (!community) throw new Error("SNMP credential is not configured");
  if (!["v1", "v2c"].includes(version)) throw new Error("Unsupported SNMP version");

  return new Promise((resolve) => {
    const session = snmp.createSession(target, community, {
      version: version === "v1" ? snmp.Version1 : snmp.Version2c,
      timeout: 2000,
      retries: 1
    });
    const oids = ["1.3.6.1.2.1.1.3.0", "1.3.6.1.4.1.2021.11.9.0", "1.3.6.1.4.1.2021.4.5.0", "1.3.6.1.4.1.2021.4.6.0"];
    const startTime = Date.now();

    session.get(oids, (error, varbinds = []) => {
      session.close();
      if (error) return resolve({ alive: false, latencyMs: null, error: error.message });

      let uptimeSeconds;
      let cpuPercent;
      let memoryPercent;
      for (const varbind of varbinds) {
        if (snmp.isVarbindError(varbind)) continue;
        if (varbind.oid === "1.3.6.1.2.1.1.3.0") uptimeSeconds = Math.floor(Number(varbind.value) / 100);
        if (varbind.oid === "1.3.6.1.4.1.2021.11.9.0" && Number.isFinite(Number(varbind.value))) cpuPercent = Number(varbind.value);
      }
      const memoryTotal = Number(varbinds.find((item) => item.oid === "1.3.6.1.4.1.2021.4.5.0")?.value);
      const memoryAvailable = Number(varbinds.find((item) => item.oid === "1.3.6.1.4.1.2021.4.6.0")?.value);
      if (Number.isFinite(memoryTotal) && Number.isFinite(memoryAvailable) && memoryTotal > 0) {
        memoryPercent = Number((((memoryTotal - memoryAvailable) / memoryTotal) * 100).toFixed(2));
      }
      return resolve({ alive: true, latencyMs: Date.now() - startTime, uptimeSeconds, cpuPercent, memoryPercent });
    });
  });
}
