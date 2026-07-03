import { verifySriIntegrity, verifyShasum } from './integrity.js';

const payload = Buffer.from('nabuos-artifact-self-check', 'utf8');
const integrity = 'sha256-Y+y0m0Gm2MwbAOX3PVJtyrfgFMnJGiONLEs/UxRRks8=';

const ok = verifySriIntegrity(payload, integrity);
if (!ok.ok) {
  console.error('FAIL: known-good SRI should verify');
  process.exit(1);
}

const tampered = verifySriIntegrity(Buffer.from('tampered'), integrity);
if (tampered.ok) {
  console.error('FAIL: tampered payload must not verify');
  process.exit(1);
}

const shasumPayload = Buffer.from('legacy-shasum-check', 'utf8');
const shasum = '08adb76809b8fda5337897a7ba8c0d34ce272d32';
const shasumOk = verifyShasum(shasumPayload, shasum);
if (!shasumOk.ok || !shasumOk.weak) {
  console.error('FAIL: legacy shasum path');
  process.exit(1);
}

console.log('ok npm-artifact self-check');
