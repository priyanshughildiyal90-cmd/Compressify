
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const archiver = require("archiver");
const { PDFDocument } = require("pdf-lib");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, "uploads");
const outputDir = path.join(__dirname, "compressed");
const publicDir = path.join(__dirname, "public");

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

app.use(express.static(publicDir));

const MAX_FILE_SIZE = 100 * 1024 * 1024;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, randomUUID() + path.extname(file.originalname).toLowerCase());
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1
    }
});

const downloads = new Map();

const imageExtensions = [".jpg", ".jpeg", ".png", ".webp"];
const compressionLevels = {
    balanced: 75,
    high: 55,
    maximum: 35
};

function safeDelete(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        fs.unlink(filePath, () => {});
    }
}

function getExtension(filename) {
    return path.extname(filename).toLowerCase();
}

// IMAGE COMPRESSION
async function compressImage(inputPath, outputPath, level) {
    const quality = compressionLevels[level] || 75;

    await sharp(inputPath)
        .rotate()
        .webp({ quality, effort: 5 })
        .toFile(outputPath);
}

// PDF OPTIMIZATION
async function compressPDF(inputPath, outputPath) {
    const input = fs.readFileSync(inputPath);

    if (input.subarray(0, 5).toString() !== "%PDF-") {
        throw new Error("Invalid PDF file.");
    }

    const pdf = await PDFDocument.load(input);

    const compressed = await pdf.save({
        useObjectStreams: true,
        addDefaultPage: false
    });

    fs.writeFileSync(outputPath, compressed);
}

// ZIP COMPRESSION
function compressZIP(inputPath, outputPath, originalName, level) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);

        const archive = archiver("zip", {
            zlib: {
                level: level === "maximum" ? 9 :
                       level === "high" ? 7 : 5
            }
        });

        output.on("close", resolve);
        output.on("error", reject);
        archive.on("error", reject);

        archive.pipe(output);

        archive.file(inputPath, {
            name: path.basename(originalName)
        });

        archive.finalize().catch(reject);
    });
}

// MAIN COMPRESSION ROUTE
app.post("/api/compress", upload.single("file"), async (req, res) => {
    let inputPath;
    let outputPath;

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: "Please upload a file."
            });
        }

        inputPath = req.file.path;

        const originalName = path.basename(req.file.originalname);
        const extension = getExtension(originalName);
        const requestedType = req.body.type || "auto";
        const level = req.body.level || "balanced";

        let type = requestedType;

        if (type === "auto") {
            if (imageExtensions.includes(extension)) {
                type = "image";
            } else if (extension === ".pdf") {
                type = "pdf";
            } else {
                throw new Error("Unsupported file type. Choose ZIP compression instead.");
            }
        }

        const id = randomUUID();
        let outputName;

        outputPath = path.join(outputDir, id + ".tmp");

        if (type === "image") {
            if (!imageExtensions.includes(extension)) {
                throw new Error("Please upload a JPG, PNG or WebP image.");
            }

            outputName = path.parse(originalName).name + "-compressed.webp";

            await compressImage(inputPath, outputPath, level);

        } else if (type === "pdf") {
            if (extension !== ".pdf") {
                throw new Error("Please upload a PDF file.");
            }

            outputName = path.parse(originalName).name + "-optimized.pdf";

            await compressPDF(inputPath, outputPath);

        } else if (type === "zip") {
            outputName = path.parse(originalName).name + ".zip";

            await compressZIP(inputPath, outputPath, originalName, level);

        } else {
            throw new Error("Invalid compression method.");
        }

        const originalSize = req.file.size;
        const compressedSize = fs.statSync(outputPath).size;

        const reduction = originalSize > 0
            ? ((originalSize - compressedSize) / originalSize) * 100
            : 0;

        const downloadPath = "/api/download/" + id;

        downloads.set(id, {
            path: outputPath,
            name: outputName
        });

        // Automatically delete temporary output after 15 minutes.
        const cleanupTimer = setTimeout(() => {
            const item = downloads.get(id);
            if (item) {
                safeDelete(item.path);
                downloads.delete(id);
            }
        }, 15 * 60 * 1000);

        if (cleanupTimer.unref) cleanupTimer.unref();

        res.json({
            success: true,
            originalSize,
            compressedSize,
            reduction: Math.max(0, reduction),
            compressedName: outputName,
            downloadUrl: downloadPath
        });

    } catch (error) {
        console.error("Compression error:", error);

        res.status(400).json({
            success: false,
            error: error.message || "Compression failed."
        });

    } finally {
        safeDelete(inputPath);
    }
});

// DOWNLOAD ROUTE
app.get("/api/download/:id", (req, res) => {
    const file = downloads.get(req.params.id);

    if (!file || !fs.existsSync(file.path)) {
        return res.status(404).send("File not found or download expired.");
    }

    res.download(file.path, file.name, (error) => {
        if (error) {
            console.error("Download error:", error);
        }

        safeDelete(file.path);
        downloads.delete(req.params.id);
    });
});

// MULTER ERROR HANDLING
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            error: error.code === "LIMIT_FILE_SIZE"
                ? "File size exceeds the 100 MB limit."
                : error.message
        });
    }

    next(error);
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Compressify server running on port ${PORT}`);
});
