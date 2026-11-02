// One-off: renders the app icon SVG to the PNG sizes the manifest needs. Run: node scripts/make-icons.mjs
// The mark is components/logo.tsx's (an A whose crossbar is a tick), on the app's indigo (--accent-solid).
import sharp from "sharp";

// pad: the maskable icon, full bleed, with the mark kept inside the 80% safe circle.
const icon = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#4f46e5"/>
  <g transform="translate(256 256) scale(${pad ? 10.5 : 13.5}) translate(-12 -12)" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4.5 20.5L12 3.5l7.5 17"/>
    <path d="M8.2 14.6l2.6 2.6 4.6-5.2"/>
  </g>
</svg>`;

await sharp(Buffer.from(icon(false))).resize(192).png().toFile("public/icon-192.png");
await sharp(Buffer.from(icon(false))).resize(512).png().toFile("public/icon-512.png");
await sharp(Buffer.from(icon(true))).resize(512).png().toFile("public/icon-maskable-512.png");
await sharp(Buffer.from(icon(false))).resize(180).png().toFile("src/app/apple-icon.png");
await sharp(Buffer.from(icon(false))).resize(64).png().toFile("src/app/icon.png");
console.log("icons written");
