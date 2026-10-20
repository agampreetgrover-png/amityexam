// One-off: renders the app icon SVG to the PNG sizes the manifest needs. Run: node scripts/make-icons.mjs
import sharp from "sharp";

const icon = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#3b5bdb"/>
  <g transform="translate(256 262) scale(${pad ? 0.72 : 0.9})" fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-170 -60 L0 -140 L170 -60 L0 20 Z"/>
    <path d="M-100 -25 V60 C-100 100 100 100 100 60 V-25"/>
    <path d="M170 -60 V50"/>
  </g>
</svg>`;

await sharp(Buffer.from(icon(false))).resize(192).png().toFile("public/icon-192.png");
await sharp(Buffer.from(icon(false))).resize(512).png().toFile("public/icon-512.png");
await sharp(Buffer.from(icon(true))).resize(512).png().toFile("public/icon-maskable-512.png");
await sharp(Buffer.from(icon(false))).resize(180).png().toFile("src/app/apple-icon.png");
await sharp(Buffer.from(icon(false))).resize(64).png().toFile("src/app/icon.png");
console.log("icons written");
