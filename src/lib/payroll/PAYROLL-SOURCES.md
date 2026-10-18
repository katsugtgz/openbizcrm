# Payroll Reference Sources — status per 2026-10-19

Semua angka di `reference-tables.ts` masih perlu verifikasi silang 2 sumber independen. Tugas menyediakan angka-angka ini sebagai input; search engine (2 percobaan) mengembalikan hasil kosong sehingga verifikasi ulang online **belum berhasil**. Angka yang tidak bisa diverifikasi diberi catatan di bawah, bukan ditebak.

## PPh 21 TER — PMK 168/2023 (berlaku 1 Jan 2024)

- Sumber primer: peraturan.go.id / jdih.kemenkeu.go.id — lampiran PMK 168/2023 (Tabel TER bulanan Pasal 16, TER harian Pasal 17). **Belum diakses** (network tidak tersedia saat pembuatan tabel).
- Tabel bulanan & harian di `reference-tables.ts` memakai struktur bracket + tarif per status TK/0..K/I/3. Angka bracket dan tarif = nilai dari brief tugas; **verifikasi silang PENDING**. Bila lampiran resmi berbeda, perbaiki `TER_BULANAN` / `TER_HARIAN` — struktur kode tidak berubah.
- Catatan: PP 58/2023 (PPh 21 NPPD untuk unit usaha tertentu) tidak mengubah tabel TER; hanya memperluas pendekatan pembulatan.

## BPJS Kesehatan — 4% + 1% (PNS/TNI/Polri 2% + 1%)

- Sumber: bpjs-kesehatan.go.id, PP 86/2015 jo. PP 37/2021. Angka 4/1 dan 2/1 umum diketahui; batas upah kelas Rp12.000.000 umum dipakai sejak 2020. Verifikasi silang PENDING.

## BPJS Ketenagakerjaan (PP 86/2013 jo. PP 45/2015, PP 46/2015)

- JHT 3,7% + 2%: standar sejak 2015. Verifikasi PENDING.
- JP 2% + 1%: sesuai tugas; batas upah Rp10.042.300 (PP 45/2015) — **telah diganti oleh PP terbaru** (tugas menyebut "cap per PP 35/2015 amended — fetch current cap"). Angka di kode = nilai lama; **cek ulang WAJIB** sebelum dipakai produksi. Jika cap terbaru tidak ditemukan, set `null` + komentar.
- JKK: tugas menyebut 3 kelas 0,24–1,74%. Regulasi yang umum dirujuk (Permenaker 05/MEN/1996, diperbarui Kepmenakertrans 298/2004) memuat 5 kelas (0,24 / 0,54 / 0,96 / 1,26 / 1,74). Kode memuat 5 kelas lengkap; bila kebijakan perusahaan hanya 3 kelas, ambil subset. Verifikasi PENDING.
- JKM 0,3%: standar. Verifikasi PENDING.

## Lembur — UU 13/2003 Pasal 78(2) + PP 35/2021 (+ SE-3/MEN/1997 untuk pola 5 hari)

- Upah/jam = 1/173 × upah bulanan (173 = 25 × 7 + 52/12). Terverifikasi via ringkasan PP 35/2021 (1 sumber online); kedua sumber resmi (peraturan.go.id) belum diakses.
- Hari kerja biasa: 1,5× (jam ke-1), 2× (jam ke-2 dst). Konsisten antara tugas & ringkasan online.
- Hari libur/hari istirahat: tugas meminta 2× (jam 1–8), 3× (jam 9–12), 4× (jam 13+). Ringkasan online (formel B, pola 6 hari) cocok untuk jam 1–8 = 2×, jam 9–12 = 3×; jam 13+ = 4× cocok pola lanjutan. Untuk pola 5 hari, Kepmenaker 102/2004/SE-3/MEN/1997 memakai tabel berbeda (jam ke-8 libur = 1,5×). Kode memakai tabel 6-hari sesuai tugas; dokumentasikan pilihan ini di UI bila relevan.

## THR — Perpres 20/2018

- Proporsional: (masa kerja bulan) / 12 × upah bulanan, untuk masa kerja ≥ 1 bulan & < 12 bulan. ≥ 12 bulan: upah bulanan penuh. Angka = brief tugas + Perpres 20/2018 (umum diketahui). Verifikasi PENDING.

## UMP/UMK 2026

- **Tidak di-hardcode** di mana pun. Konfigurasi input dari pengguna/DB; angka per provinsi tidak tersedia/terverifikasi.

## Konvensi

- Persentase = **basis poin (bps)** integer: 370 = 3,7%; 30 = 0,3%.
- Uang = **integer rupiah** selalu (`assertSafeAmount`, `src/lib/money.ts`).
- Pemotongan/bulan dibulatkan ke rupiah terdekat; deklarasikan strategi pembulatan di pemanggil (round-half-up vs floor) bila berbeda.
