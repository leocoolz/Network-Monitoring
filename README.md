# Netra NOC

Prototipe dashboard Network Operations Center untuk memonitor router, firewall, switch, radio WiFi, access point, komputer, printer, server, NVR, CCTV, serta traffic LAN, WAN, dan internet.

## Menjalankan

Buka `index.html` langsung di browser, atau jalankan static server:

```powershell
python -m http.server 8080
```

Lalu buka `http://localhost:8080`.

## Login prototipe

- Username: `admin`
- Password: `netra2026`

Login memakai `localStorage` atau `sessionStorage` dan hanya ditujukan untuk demonstrasi frontend. Deployment produksi harus menggantinya dengan autentikasi server-side, password hashing, secure HttpOnly cookie, CSRF protection, rate limiting, MFA/SSO, serta audit log.

## Cakupan dashboard

- Ringkasan network health, device availability, critical alert, dan utilisasi internet
- Login responsif, validasi form, session, menu profil, dan logout
- Grafik download/upload realtime berbasis Canvas
- Pemisahan traffic All, Internet, WAN, dan LAN
- Link availability untuk ISP primary, backup, dan VPN
- Peta topologi interaktif
- Distribusi seluruh kategori perangkat
- Active alerts dan acknowledge workflow
- Device inventory dengan pencarian dan filter
- Detail perangkat, metrik CPU/memory, ICMP, dan SNMP
- Form tambah perangkat dan export laporan CSV
- Layout responsif untuk desktop, tablet, dan mobile

Data saat ini berupa simulasi frontend dan siap dihubungkan ke API monitoring seperti Zabbix, LibreNMS, PRTG, Prometheus, atau collector SNMP kustom.

Rancangan collector, protocol, keamanan, baseline alert, retensi, dan high availability tersedia di `ARCHITECTURE.md`.

# Network-Monitoring
