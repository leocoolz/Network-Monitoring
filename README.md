# Netra NOC

Netra NOC adalah aplikasi Network Operations Center self-hosted untuk inventory, availability, alert, discovery, traffic, topology, report, audit log, dan monitoring dasar perangkat jaringan.

## Mode Standalone

Mode standalone berjalan seluruhnya pada satu komputer:

- Web UI dan API Node.js
- PostgreSQL lokal
- Internal poller ICMP, TCP, dan SNMP v1/v2c
- Session dan audit log lokal
- Tidak memerlukan cloud atau layanan SaaS

Docker Desktop tetap diperlukan sebagai runtime. Aplikasi ini bukan satu file `.exe` dan tidak menggunakan database eksternal.

### Persyaratan

- Windows 10/11 atau Windows Server dengan Docker Desktop
- Minimal 2 CPU, RAM 4 GB, dan ruang kosong 10 GB
- Komputer mempunyai jalur jaringan menuju management VLAN perangkat

### Instalasi Satu Perintah

Buka PowerShell pada folder proyek:

```powershell
.\scripts\install-standalone.ps1
```

Installer akan:

1. Membuat password database, collector key, dan encryption key secara acak.
2. Menyimpan konfigurasi pada `.env.standalone` dengan ACL terbatas.
3. Build image aplikasi dan menjalankan PostgreSQL lokal.
4. Menjalankan seluruh migrasi database.
5. Membuat akun admin pertama tanpa mengisi perangkat demo.

Alamat default: `http://127.0.0.1:3000`. Username dan password awal dicetak satu kali saat instalasi pertama.

Untuk menentukan port atau password awal sendiri:

```powershell
.\scripts\install-standalone.ps1 -Port 8080 -AdminPassword 'PasswordUnik!2026'
```

Karakter password yang diterima installer: huruf, angka, dan `!@%_+=.-`.

## Operasi

Status aplikasi:

```powershell
docker compose --env-file .env.standalone ps
```

Log aplikasi:

```powershell
docker compose --env-file .env.standalone logs -f app
```

Update setelah source code berubah:

```powershell
.\scripts\install-standalone.ps1
```

Hentikan tanpa menghapus data:

```powershell
.\scripts\uninstall-standalone.ps1
```

Hapus aplikasi beserta database:

```powershell
.\scripts\uninstall-standalone.ps1 -DeleteData
```

## Backup Data

Buat folder backup dan jalankan `pg_dump` dari container database. Gunakan PowerShell 7 agar redirection binary tidak berubah:

```powershell
New-Item -ItemType Directory -Force backups
docker compose --env-file .env.standalone exec -T database pg_dump -U netra -d netra -Fc > backups/netra-$(Get-Date -Format yyyyMMdd-HHmm).dump
```

File `.env.standalone` juga harus dibackup secara terenkripsi karena memuat key untuk membuka credential SNMP. Jangan commit file tersebut ke GitHub.

## Keamanan

- Password di-hash dengan Argon2id.
- Session disimpan server-side; browser hanya menerima cookie HttpOnly SameSite.
- Mutasi API dilindungi CSRF, same-origin policy, RBAC, dan rate limiting.
- Credential SNMP dienkripsi AES-256-GCM sebelum disimpan.
- Discovery dan target perangkat dibatasi `ALLOWED_DEVICE_CIDRS`.
- Discovery mempunyai batas host agar CIDR besar tidak menghabiskan memori.
- Container berjalan non-root, read-only, tanpa privilege tambahan selain `NET_RAW` untuk ICMP.
- Login, perubahan user, device, dan alert dicatat pada audit log.

Untuk akses dari komputer lain, tempatkan reverse proxy HTTPS di depan port localhost dan ubah `APP_ORIGIN` serta `COOKIE_SECURE=true`. Jangan membuka aplikasi langsung ke internet.

## Development

```powershell
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Variabel wajib tersedia pada environment. Gunakan `.env.example` sebagai referensi dan jangan menyimpan `.env` di repository.

Pemeriksaan kualitas:

```powershell
npm run check
npm test
npm run security:audit
npm run build
```

## Kemampuan Poller

| Metode              | Status         | Catatan                                                        |
| ------------------- | -------------- | -------------------------------------------------------------- |
| ICMP                | Tersedia       | Membutuhkan kemampuan `NET_RAW` dalam container                |
| TCP                 | Tersedia       | Memeriksa port yang dikonfigurasi                              |
| SNMP v1/v2c         | Tersedia       | Community dienkripsi; gunakan management VLAN dan ACL          |
| SNMPv3              | Belum tersedia | Jangan memilih v3 sampai credential authPriv diimplementasikan |
| ONVIF/API vendor    | Inventory only | Memerlukan adapter vendor/collector tambahan                   |
| NetFlow/sFlow/IPFIX | Belum tersedia | Memerlukan flow collector terpisah                             |

## Struktur

- `src/routes`: kontrak HTTP dan validasi request
- `src/services`: aturan bisnis dan transaksi database
- `src/middleware`: autentikasi, CSRF, RBAC, rate limit, dan error handling
- `src/workers`: poller internal
- `migrations`: skema PostgreSQL versioned
- `public`: source UI
- `dist`: hasil build UI produksi
- `scripts`: installer dan lifecycle standalone
- `tests`: integration test dengan PostgreSQL nyata

Dokumen desain lebih lanjut tersedia di `ARCHITECTURE.md`, `FEATURES.md`, dan `DISCOVERY.md`.
