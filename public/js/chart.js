const $ = (selector) => document.querySelector(selector);
let scope = "all";
let range = "live";
let traffic = { all: [], internet: [], wan: [], lan: [] };

export function setTrafficData(nextTraffic) {
  traffic = nextTraffic || traffic;
  updateSummary();
  drawTrafficChart();
}

export function setTrafficScope(nextScope) {
  scope = nextScope;
  updateSummary();
  drawTrafficChart();
}

export function setTrafficRange(nextRange) {
  range = nextRange;
  drawTrafficChart();
}

function values() {
  const rows = traffic[scope] || [];
  return {
    download: rows.map((row) => Number(row.download_mbps)),
    upload: rows.map((row) => Number(row.upload_mbps)),
    labels: rows.map((row) => new Date(row.sampled_at))
  };
}

function updateSummary() {
  const data = values();
  const currentDownload = data.download.at(-1) || 0;
  const currentUpload = data.upload.at(-1) || 0;
  const peak = Math.max(0, ...data.download);
  const descriptions = {
    all: "Aggregated throughput seluruh koneksi",
    internet: "Traffic keluar dan masuk koneksi internet",
    wan: "Traffic site-to-site, branch, dan VPN WAN",
    lan: "Traffic internal antar VLAN dan access layer"
  };
  $("#trafficDescription").textContent = descriptions[scope];
  $("#trafficPeakValue").textContent = `${peak.toFixed(1)} Mbps`;
  $("#downloadValue").innerHTML = `${currentDownload.toFixed(1)} <small>Mbps</small>`;
  $("#uploadValue").innerHTML = `${currentUpload.toFixed(1)} <small>Mbps</small>`;
  $("#downloadMini").textContent = `${currentDownload.toFixed(0)} Mbps`;
  $("#uploadMini").textContent = `${currentUpload.toFixed(0)} Mbps`;
  $("#utilValue").textContent = Math.min(100, currentDownload / 10).toFixed(1);
}

function labelFor(date, index, length) {
  if (range === "7d" || range === "30d") return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
  if (range === "24h") return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  if (index % Math.max(1, Math.floor(length / 6)) !== 0 && index !== length - 1) return "";
  return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export function drawTrafficChart() {
  const canvas = $("#trafficChart");
  if (!canvas || canvas.offsetParent === null) return;
  const data = values();
  if (data.download.length < 2) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const context = canvas.getContext("2d");
  context.scale(dpr, dpr);
  const padding = { top: 10, right: 42, bottom: 25, left: 8 };
  const width = rect.width;
  const height = rect.height;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(100, Math.ceil(Math.max(...data.download) / 250) * 250);

  context.font = "7px system-ui";
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + (plotHeight / 4) * index;
    context.beginPath();
    context.strokeStyle = "rgba(143,166,197,.09)";
    context.setLineDash([3, 5]);
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillStyle = "#46576d";
    context.fillText(String(Math.round(max - (index * max) / 4)), width - padding.right + 8, y + 3);
  }

  data.labels.forEach((date, index) => {
    const x = padding.left + (plotWidth / (data.labels.length - 1)) * index;
    context.fillStyle = "#46576d";
    context.textAlign = index === 0 ? "left" : index === data.labels.length - 1 ? "right" : "center";
    context.fillText(labelFor(date, index, data.labels.length), x, height - 5);
  });

  const drawSeries = (series, color, fillTop) => {
    const points = series.map((value, index) => ({
      x: padding.left + (plotWidth / (series.length - 1)) * index,
      y: padding.top + plotHeight - (value / max) * plotHeight
    }));
    const drawLine = () => {
      context.beginPath();
      points.forEach((point, index) => {
        if (!index) context.moveTo(point.x, point.y);
        else {
          const previous = points[index - 1];
          const middle = (previous.x + point.x) / 2;
          context.bezierCurveTo(middle, previous.y, middle, point.y, point.x, point.y);
        }
      });
    };
    drawLine();
    const gradient = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    gradient.addColorStop(0, fillTop);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.lineTo(points.at(-1).x, height - padding.bottom);
    context.lineTo(points[0].x, height - padding.bottom);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();
    drawLine();
    context.strokeStyle = color;
    context.lineWidth = 1.8;
    context.setLineDash([]);
    context.shadowColor = color;
    context.shadowBlur = 7;
    context.stroke();
    context.shadowBlur = 0;
  };

  drawSeries(data.download, "#25d9f8", "rgba(37,217,248,.19)");
  drawSeries(data.upload, "#756cf7", "rgba(117,108,247,.13)");
  canvas.dataset.plotLeft = String(padding.left);
  canvas.dataset.plotWidth = String(plotWidth);
}

export function tooltipData(clientX, canvasRect) {
  const data = values();
  const x = clientX - canvasRect.left;
  const left = Number($("#trafficChart").dataset.plotLeft || 0);
  const plotWidth = Number($("#trafficChart").dataset.plotWidth || 1);
  const index = Math.max(0, Math.min(data.download.length - 1, Math.round(((x - left) / plotWidth) * (data.download.length - 1))));
  return { x, download: data.download[index] || 0, upload: data.upload[index] || 0 };
}
