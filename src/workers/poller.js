import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { decryptCredential } from "../lib/crypto.js";
import { performICMPProbe, performSNMPProbe, performTCPProbe } from "../lib/probe.js";
import { ingestCollectorBatch } from "../services/collector-service.js";

async function probeDevice(device) {
  if (device.monitoring_method === "tcp" && device.tcp_port) return performTCPProbe(device.ip_address, device.tcp_port);
  if (device.monitoring_method === "snmp" && device.snmp_community_encrypted) {
    return performSNMPProbe(device.ip_address, decryptCredential(device.snmp_community_encrypted), device.snmp_version || "v2c");
  }
  return performICMPProbe(device.ip_address);
}

export function startInternalPoller({ intervalMs = env.pollerIntervalMs, concurrency = env.pollerConcurrency } = {}) {
  let stopped = false;
  let timer;

  const runCycle = async () => {
    if (stopped) return;
    try {
      const devices = (
        await pool.query(
          `SELECT host(ip_address) AS ip_address, monitoring_method, tcp_port,
                snmp_community_encrypted, snmp_version
         FROM devices WHERE enabled = TRUE`
        )
      ).rows;
      const results = [];
      let cursor = 0;
      const worker = async () => {
        while (!stopped) {
          const index = cursor;
          cursor += 1;
          if (index >= devices.length) return;
          const device = devices[index];
          try {
            const probe = await probeDevice(device);
            results.push({
              ipAddress: device.ip_address,
              status: probe.alive ? "online" : "offline",
              latencyMs: probe.latencyMs,
              cpuPercent: probe.cpuPercent,
              memoryPercent: probe.memoryPercent,
              uptimeSeconds: probe.uptimeSeconds
            });
          } catch (error) {
            process.stderr.write(`Probe failed for ${device.ip_address}: ${error.message}\n`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, devices.length) }, () => worker()));
      if (!stopped && results.length) await ingestCollectorBatch({ devices: results, traffic: [] });
    } catch (error) {
      process.stderr.write(`Poller cycle failed: ${error.message}\n`);
    } finally {
      if (!stopped) timer = setTimeout(runCycle, intervalMs);
    }
  };

  process.stdout.write(`Internal poller enabled: interval=${intervalMs}ms concurrency=${concurrency}\n`);
  timer = setTimeout(runCycle, 1000);
  timer.unref();
  return {
    stop() {
      stopped = true;
      globalThis.clearTimeout(timer);
    }
  };
}
