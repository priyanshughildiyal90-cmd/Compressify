const API_URL = "/api/compress";
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB frontend guard

const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const browseButton = document.getElementById("browseButton");
const selectedFilePanel = document.getElementById("selectedFile");
const fileNameLabel = document.getElementById("fileName");
const fileSizeLabel = document.getElementById("fileSize");
const fileIcon = document.getElementById("fileIcon");
const removeFileButton = document.getElementById("removeFile");
const compressionType = document.getElementById("compressionType");
const compressionLevel = document.getElementById("compressionLevel");
const compressButton = document.getElementById("compressButton");
const formError = document.getElementById("formError");
const progressArea = document.getElementById("progressArea");
const progressText = document.getElementById("progressText");
const progressPercent = document.getElementById("progressPercent");
const progressFill = document.getElementById("progressFill");
const resultArea = document.getElementById("resultArea");

let selectedFile = null;
let activeDownloadUrl = null;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function showError(message) {
  formError.textContent = message;
  formError.classList.remove("hidden");
}

function clearError() {
  formError.textContent = "";
  formError.classList.add("hidden");
}

function getDetectedType(file) {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|tiff?)$/.test(name)) return "image";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  return "other";
}

function setSelectedFile(file) {
  clearError();
  resultArea.classList.add("hidden");
  progressArea.classList.add("hidden");

  if (!file) return;
  if (file.size > MAX_FILE_SIZE) {
    showError("This file is larger than 100 MB. Please choose a smaller file.");
    return;
  }

  selectedFile = file;
  fileNameLabel.textContent = file.name;
  fileSizeLabel.textContent = formatBytes(file.size);
  const type = getDetectedType(file);
  fileIcon.textContent = type === "image" ? "IMG" : type === "pdf" ? "PDF" : "FILE";
  selectedFilePanel.classList.remove("hidden");
  dropZone.classList.add("has-file");
  compressButton.disabled = false;

  if (compressionType.value === "auto") {
    // Keep auto selected; backend will identify the file and use the matching handler.
  }
}

function resetSelection() {
  selectedFile = null;
  fileInput.value = "";
  selectedFilePanel.classList.add("hidden");
  dropZone.classList.remove("has-file");
  compressButton.disabled = true;
  progressArea.classList.add("hidden");
  resultArea.classList.add("hidden");
  clearError();
  if (activeDownloadUrl) {
    URL.revokeObjectURL(activeDownloadUrl);
    activeDownloadUrl = null;
  }
}

browseButton.addEventListener("click", (event) => {
  event.stopPropagation();
  fileInput.click();
});
dropZone.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  fileInput.click();
});
dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", () => setSelectedFile(fileInput.files[0]));
removeFileButton.addEventListener("click", resetSelection);

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
  });
});
dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file) setSelectedFile(file);
});

function setProgress(percent, message) {
  const safePercent = Math.max(0, Math.min(100, percent));
  progressFill.style.width = `${safePercent}%`;
  progressPercent.textContent = `${Math.round(safePercent)}%`;
  progressText.textContent = message;
}

function showResult(data) {
  const originalSize = Number(data.originalSize);
  const compressedSize = Number(data.compressedSize);
  const calculatedReduction = originalSize > 0
    ? ((originalSize - compressedSize) / originalSize) * 100
    : 0;
  const reduction = Number.isFinite(Number(data.reduction))
    ? Number(data.reduction)
    : calculatedReduction;

  document.getElementById("originalSize").textContent = formatBytes(originalSize);
  document.getElementById("compressedSize").textContent = formatBytes(compressedSize);
  document.getElementById("savedPercent").textContent = `${Math.max(0, reduction).toFixed(1)}%`;
  document.getElementById("savingsFill").style.width = `${Math.max(0, Math.min(100, reduction))}%`;

  const downloadButton = document.getElementById("downloadButton");
  // The backend may return a download URL or the response may be a direct file.
  downloadButton.href = data.downloadUrl;
  downloadButton.download = data.compressedName || "compressed-file";
  document.getElementById("resultDisclaimer").textContent =
    compressedSize >= originalSize
      ? "This file was already efficiently encoded, so compression did not reduce its size. The downloaded output is still available."
      : "Your compressed file is ready. Download it before the server's temporary file is cleaned up.";

  resultArea.classList.remove("hidden");
}

async function compressSelectedFile() {
  if (!selectedFile) return;
  clearError();

  const requestedType = compressionType.value;
  const detectedType = getDetectedType(selectedFile);
  if (requestedType === "image" && detectedType !== "image") {
    showError("Image compression requires an image file.");
    return;
  }
  if (requestedType === "pdf" && detectedType !== "pdf") {
    showError("PDF optimization requires a PDF file.");
    return;
  }
  if (requestedType === "auto" && detectedType === "other") {
    showError("Automatic detection supports images and PDFs. Choose 'Create ZIP archive' for other file types.");
    return;
  }

  const formData = new FormData();
  formData.append("file", selectedFile);
  formData.append("type", requestedType);
  formData.append("level", compressionLevel.value);

  compressButton.disabled = true;
  progressArea.classList.remove("hidden");
  resultArea.classList.add("hidden");
  setProgress(8, "Uploading your file…");

  try {
    // XMLHttpRequest is used to display upload progress.
    const data = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", API_URL);
      xhr.responseType = "json";
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const uploadPercent = (event.loaded / event.total) * 55;
          setProgress(uploadPercent, "Uploading your file…");
        }
      });
      xhr.upload.addEventListener("load", () => setProgress(65, "Compressing your file…"));
      xhr.addEventListener("load", () => {
        const response = xhr.response;
        if (xhr.status >= 200 && xhr.status < 300) {
          if (!response || response.success !== true || !response.downloadUrl) {
            reject(new Error("The server returned an unexpected response."));
            return;
          }
          resolve(response);
        } else {
          reject(new Error(response?.error || `Compression failed (HTTP ${xhr.status}).`));
        }
      });
      xhr.addEventListener("error", () => reject(new Error("Could not connect to the server. Make sure the backend is running.")));
      xhr.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));
      xhr.send(formData);
    });

    setProgress(100, "Compression complete!");
    showResult(data);
  } catch (error) {
    showError(error.message || "Something went wrong while compressing the file.");
    progressArea.classList.add("hidden");
  } finally {
    compressButton.disabled = !selectedFile;
  }
}

compressButton.addEventListener("click", compressSelectedFile);
document.getElementById("startAgain").addEventListener("click", resetSelection);

document.getElementById("mobileMenu").addEventListener("click", () => {
  document.querySelector(".nav-links").classList.toggle("open");
});

// Keep the file picker useful when the user changes the selected operation.
compressionType.addEventListener("change", () => {
  clearError();
  if (selectedFile) compressButton.disabled = false;
});
