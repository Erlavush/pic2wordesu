/**
 * Image Processing Script (Windows-safe)
 * Writes processed images to a _processed folder, then
 * the user can copy them over manually if EBUSY persists.
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, 'public', 'assets');
const OUTPUT_DIR = path.join(__dirname, 'public', 'assets_processed');
const TARGET_SIZE = 500;
const JPEG_QUALITY = 75;

async function processRound(roundDir, outputRoundDir) {
    const roundName = path.basename(roundDir);
    
    // Create output directory
    fs.mkdirSync(outputRoundDir, { recursive: true });

    const allFiles = fs.readdirSync(roundDir);
    const imageFiles = allFiles.filter(f => 
        /\.(jpg|jpeg|png|webp|avif|gif|bmp|tiff?)$/i.test(f)
    ).sort();

    if (imageFiles.length === 0) {
        console.log(`  ⚠️  ${roundName}: no images found`);
        return 0;
    }

    let processed = 0;
    for (let i = 0; i < Math.min(imageFiles.length, 4); i++) {
        const inputPath = path.join(roundDir, imageFiles[i]);
        const outputPath = path.join(outputRoundDir, `pic${i + 1}.jpg`);

        try {
            const metadata = await sharp(inputPath).metadata();
            const { width, height } = metadata;
            const cropSize = Math.min(width, height);

            await sharp(inputPath)
                .extract({
                    left: Math.floor((width - cropSize) / 2),
                    top: Math.floor((height - cropSize) / 2),
                    width: cropSize,
                    height: cropSize,
                })
                .resize(TARGET_SIZE, TARGET_SIZE)
                .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
                .toFile(outputPath);

            processed++;
        } catch (err) {
            console.log(`  ❌  ${roundName}/${imageFiles[i]}: ${err.message}`);
        }
    }

    console.log(`  ✅  ${roundName}: ${processed}/${Math.min(imageFiles.length, 4)} images`);
    return processed;
}

async function main() {
    console.log('');
    console.log('🖼️  Image Processing Starting...');
    console.log(`   Target: ${TARGET_SIZE}x${TARGET_SIZE}px square JPEG @ ${JPEG_QUALITY}% quality`);
    console.log(`   Output: assets_processed/`);
    console.log('');

    // Clean output dir
    if (fs.existsSync(OUTPUT_DIR)) {
        fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const rounds = fs.readdirSync(ASSETS_DIR)
        .filter(d => {
            const fullPath = path.join(ASSETS_DIR, d);
            return fs.statSync(fullPath).isDirectory() && d.startsWith('round');
        })
        .sort((a, b) => {
            const numA = parseInt(a.replace('round', ''));
            const numB = parseInt(b.replace('round', ''));
            return numA - numB;
        });

    let totalProcessed = 0;
    for (const round of rounds) {
        const count = await processRound(
            path.join(ASSETS_DIR, round),
            path.join(OUTPUT_DIR, round)
        );
        totalProcessed += count;
    }

    // Calculate total output size
    let totalBytes = 0;
    for (const round of rounds) {
        const roundDir = path.join(OUTPUT_DIR, round);
        if (!fs.existsSync(roundDir)) continue;
        const files = fs.readdirSync(roundDir);
        for (const f of files) {
            totalBytes += fs.statSync(path.join(roundDir, f)).size;
        }
    }

    console.log('');
    console.log(`📦  Done! ${totalProcessed} images → ${(totalBytes / 1024 / 1024).toFixed(1)} MB total`);
    console.log('');

    // Now swap: rename assets -> assets_old, assets_processed -> assets
    console.log('🔄  Swapping folders...');
    const OLD_DIR = path.join(__dirname, 'public', 'assets_old');
    
    try {
        if (fs.existsSync(OLD_DIR)) fs.rmSync(OLD_DIR, { recursive: true, force: true });
        fs.renameSync(ASSETS_DIR, OLD_DIR);
        fs.renameSync(OUTPUT_DIR, ASSETS_DIR);
        console.log('  ✅  assets_old (originals) ← assets (processed) swap complete!');
        
        // Try to delete old
        try {
            fs.rmSync(OLD_DIR, { recursive: true, force: true });
            console.log('  🗑️  Cleaned up assets_old');
        } catch (e) {
            console.log(`  ⚠️  Could not delete assets_old (Windows lock). Delete manually later.`);
        }
    } catch (err) {
        console.log(`  ⚠️  Could not swap: ${err.message}`);
        console.log(`  📁  Processed images are in: public/assets_processed/`);
        console.log(`       You can manually rename this to 'assets' after closing other programs.`);
    }

    console.log('');
    console.log('✨  All done!');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
