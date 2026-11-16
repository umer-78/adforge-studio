import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The sample product for the landing showcase loop: a studio render of an insulated steel bottle
 * (three.js, transparent background), so the page needs no stock photo. 1200 × 1200 PNG.
 */
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/public/landing/sample-bottle.png');
export const SAMPLE_BOTTLE_SIZE = 1200;
export const sampleBottleDataUrl = () => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
