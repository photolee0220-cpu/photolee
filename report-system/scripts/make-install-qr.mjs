// 직원 설치 안내 QR 코드 (사이트 주소가 바뀌면 다시 실행: node scripts/make-install-qr.mjs)
import QRCode from 'qrcode';
import { writeFileSync } from 'node:fs';
const url = process.argv[2] ?? 'https://photolee0220-cpu.github.io/photolee/install/';
writeFileSync(new URL('../public/install/qr.svg', import.meta.url), await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#17202c', light: '#ffffff' } }));
console.log('qr for', url);
