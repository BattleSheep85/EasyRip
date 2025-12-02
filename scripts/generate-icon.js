// Generate EasyRip application icon
// Creates a simple placeholder icon with "ER" text on a dark blue disc background
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(__dirname, '..', 'build');

// Ensure build directory exists
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// SVG template for the icon - disc with "ER" text
function createIconSVG(size) {
  const fontSize = Math.floor(size * 0.35);
  const strokeWidth = Math.max(1, Math.floor(size * 0.02));

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="discGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1e3a5f;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#0d1f33;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#1d4ed8;stop-opacity:1" />
        </linearGradient>
      </defs>

      <!-- Outer disc -->
      <circle cx="${size/2}" cy="${size/2}" r="${size*0.45}" fill="url(#discGradient)" stroke="url(#ringGradient)" stroke-width="${strokeWidth}"/>

      <!-- Inner ring (disc center) -->
      <circle cx="${size/2}" cy="${size/2}" r="${size*0.12}" fill="#0d1f33" stroke="url(#ringGradient)" stroke-width="${strokeWidth}"/>

      <!-- Highlight arc -->
      <path d="M ${size*0.25} ${size*0.35} A ${size*0.35} ${size*0.35} 0 0 1 ${size*0.65} ${size*0.2}"
            fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="${strokeWidth*2}" stroke-linecap="round"/>

      <!-- "ER" text -->
      <text x="${size/2}" y="${size*0.58}"
            font-family="Arial, sans-serif"
            font-size="${fontSize}px"
            font-weight="bold"
            fill="#60a5fa"
            text-anchor="middle">ER</text>
    </svg>
  `;
}

async function generateIcon() {
  console.log('Generating EasyRip icon...');

  const sizes = [16, 32, 48, 64, 128, 256];
  const pngPaths = [];

  // Generate PNG files at each size
  for (const size of sizes) {
    const svg = createIconSVG(size);
    const pngPath = path.join(buildDir, `icon-${size}.png`);

    await sharp(Buffer.from(svg))
      .png()
      .toFile(pngPath);

    pngPaths.push(pngPath);
    console.log(`  Created ${size}x${size} PNG`);
  }

  // Also create a 256x256 PNG for electron-builder (it needs icon.png too)
  const svg256 = createIconSVG(256);
  await sharp(Buffer.from(svg256))
    .png()
    .toFile(path.join(buildDir, 'icon.png'));
  console.log('  Created icon.png (256x256)');

  // Convert to ICO using the PNG files
  try {
    const icoBuffer = await pngToIco(pngPaths);
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
    console.log('  Created icon.ico (multi-resolution)');
  } catch (err) {
    console.error('Error creating ICO:', err);
    // Fallback: just use the 256 PNG
    console.log('  Falling back to single-resolution ICO');
    const fallbackIco = await pngToIco([path.join(buildDir, 'icon-256.png')]);
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), fallbackIco);
  }

  // Clean up individual PNG files (keep only icon.png)
  for (const pngPath of pngPaths) {
    fs.unlinkSync(pngPath);
  }

  console.log('Icon generation complete!');
}

generateIcon().catch(console.error);
