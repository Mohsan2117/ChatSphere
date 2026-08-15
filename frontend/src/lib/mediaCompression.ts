import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";

export interface AppConfig {
  maxUploadSizeMb: number;
  imageOptimizeThresholdBytes: number;
  videoOptimizeThresholdBytes: number;
  imageMaxDimension: number;
  videoMaxDimension: number;
}

let ffmpegInstance: FFmpeg | null = null;

async function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  const ffmpeg = new FFmpeg();
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

function getVideoDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve({ width: video.videoWidth, height: video.videoHeight });
    };
    video.onerror = () => {
      resolve({ width: 0, height: 0 });
    };
  });
}

function compressImage(
  file: File,
  maxDimension: number,
  quality: number,
  onProgress: (msg: string) => void
): Promise<File> {
  return new Promise((resolve, reject) => {
    onProgress("Optimizing image...");

    const img = new Image();
    img.src = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(img.src);

      let width = img.naturalWidth;
      let height = img.naturalHeight;

      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return resolve(file);
      }

      ctx.drawImage(img, 0, 0, width, height);

      let mimeType = file.type;
      if (file.type === "image/png" || file.type === "image/webp") {
        mimeType = "image/webp";
      } else {
        mimeType = "image/jpeg";
      }

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            return resolve(file);
          }
          const extension = mimeType === "image/webp" ? ".webp" : ".jpg";
          const baseName = file.name.replace(/\.[^/.]+$/, "");
          const compressedFile = new File([blob], `${baseName}-optimized${extension}`, {
            type: mimeType,
            lastModified: Date.now()
          });
          resolve(compressedFile);
        },
        mimeType,
        quality
      );
    };

    img.onerror = () => {
      reject(new Error("Could not prepare image"));
    };
  });
}

async function compressVideo(
  file: File,
  targetWidth: number,
  targetHeight: number,
  crf: number,
  onProgress: (msg: string) => void
): Promise<File> {
  const ffmpeg = await loadFFmpeg();

  const progressHandler = ({ progress }: { progress: number }) => {
    const percent = Math.min(99, Math.round(progress * 100));
    onProgress(`Compressing video... ${percent}%`);
  };
  
  ffmpeg.on("progress", progressHandler);

  const inputName = "input.mp4";
  const outputName = "output.mp4";

  try {
    onProgress("Preparing video...");
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    const args = [
      "-i", inputName,
      "-vcodec", "libx264",
      "-crf", crf.toString(),
      "-preset", "ultrafast",
      "-vf", `scale=${targetWidth}:${targetHeight}`,
      "-acodec", "aac",
      "-b:a", "128k",
      outputName
    ];

    await ffmpeg.exec(args);

    const data = await ffmpeg.readFile(outputName);
    const baseName = file.name.replace(/\.[^/.]+$/, "");
    const u8data = typeof data === "string" ? new TextEncoder().encode(data) : (data as any);
    const compressedBlob = new Blob([u8data], { type: "video/mp4" });
    const compressedFile = new File([compressedBlob], `${baseName}-optimized.mp4`, {
      type: "video/mp4",
      lastModified: Date.now()
    });

    return compressedFile;
  } finally {
    ffmpeg.off("progress", progressHandler);
    try {
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch (e) {
      // Ignore
    }
  }
}

export async function handleImageCompressionLoop(
  file: File,
  config: AppConfig,
  onProgress: (msg: string) => void
): Promise<File> {
  let currentFile = file;
  let passes = 0;
  const maxPasses = 3;
  const maxUploadBytes = config.maxUploadSizeMb * 1024 * 1024;
  const safetyLimitBytes = maxUploadBytes - 1.5 * 1024 * 1024;

  if (file.size > config.imageOptimizeThresholdBytes || file.size > safetyLimitBytes) {
    let quality = 0.85;
    let maxDimension = config.imageMaxDimension;

    while (currentFile.size > safetyLimitBytes && passes < maxPasses) {
      passes++;
      onProgress(`Compressing image...`);
      
      currentFile = await compressImage(currentFile, maxDimension, quality, onProgress);
      
      quality -= 0.15;
      maxDimension = Math.round(maxDimension * 0.8);
    }
  }

  if (currentFile.size > safetyLimitBytes) {
    throw new Error("Image is still too large after compression. Please choose a smaller image.");
  }

  return currentFile;
}

export async function handleVideoCompressionLoop(
  file: File,
  config: AppConfig,
  onProgress: (msg: string) => void
): Promise<File> {
  let currentFile = file;
  let passes = 0;
  const maxPasses = 3;
  const maxUploadBytes = config.maxUploadSizeMb * 1024 * 1024;
  const safetyLimitBytes = maxUploadBytes - 1.5 * 1024 * 1024;

  if (file.size > config.videoOptimizeThresholdBytes || file.size > safetyLimitBytes) {
    onProgress("Preparing video...");
    const dimensions = await getVideoDimensions(file);
    const origWidth = dimensions.width || 640;
    const origHeight = dimensions.height || 480;

    let targetWidth = origWidth;
    let targetHeight = origHeight;
    let maxDim = config.videoMaxDimension;
    let crf = 28;

    while (currentFile.size > safetyLimitBytes && passes < maxPasses) {
      passes++;
      
      if (origWidth > maxDim || origHeight > maxDim) {
        if (origWidth >= origHeight) {
          targetHeight = Math.round((origHeight * maxDim) / origWidth);
          targetWidth = maxDim;
        } else {
          targetWidth = Math.round((origWidth * maxDim) / origHeight);
          targetHeight = maxDim;
        }
      }

      targetWidth = Math.round(targetWidth / 2) * 2;
      targetHeight = Math.round(targetHeight / 2) * 2;

      onProgress(`Compressing video... 0%`);
      
      currentFile = await compressVideo(currentFile, targetWidth, targetHeight, crf, onProgress);

      crf += 6;
      maxDim = Math.round(maxDim * 0.8);
    }
  }

  if (currentFile.size > safetyLimitBytes) {
    throw new Error("Video is still too large after compression. Please choose a shorter video.");
  }

  return currentFile;
}
