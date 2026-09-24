import { spawn } from "node:child_process";

import { type ConversionSourceType } from "../contracts/conversion-events.js";

export type SupportedTargetFormat = "mp4" | "webm" | "mp3" | "wav";

type ConvertMediaInput = {
  inputPath: string;
  outputPath: string;
  sourceType: ConversionSourceType;
  targetFormat: string;
};

export class MediaConversionError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "MediaConversionError";
  }
}

const conversionArgumentsByTargetFormat: Record<
  SupportedTargetFormat,
  readonly string[]
> = {
  mp4: ["-c:v", "libx264", "-c:a", "aac"],
  webm: ["-c:v", "libvpx-vp9", "-c:a", "libopus"],
  mp3: ["-vn", "-c:a", "libmp3lame"],
  wav: ["-vn", "-c:a", "pcm_s16le"],
};

const targetFormatsBySourceType: Record<
  ConversionSourceType,
  readonly SupportedTargetFormat[]
> = {
  audio: ["mp3", "wav"],
  video: ["mp4", "webm"],
};

function isSupportedTargetFormat(
  targetFormat: string,
): targetFormat is SupportedTargetFormat {
  return targetFormat in conversionArgumentsByTargetFormat;
}

export async function convertMedia(input: ConvertMediaInput): Promise<void> {
  if (!isSupportedTargetFormat(input.targetFormat)) {
    throw new MediaConversionError(
      `Unsupported target format: ${input.targetFormat}`,
    );
  }

  if (!targetFormatsBySourceType[input.sourceType].includes(input.targetFormat)) {
    throw new MediaConversionError(
      `Unsupported target format for ${input.sourceType}: ${input.targetFormat}`,
    );
  }

  const conversionArguments =
    conversionArgumentsByTargetFormat[input.targetFormat];

  const argumentsList = [
    "-y",
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input.inputPath,
    ...conversionArguments,
    input.outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    let errorOutput = "";
    let settled = false;

    const ffmpegProcess = spawn("ffmpeg", argumentsList);

    const rejectOnce = (error: Error): void => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    ffmpegProcess.stderr.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });

    ffmpegProcess.on("error", (error: Error) => {
      rejectOnce(
        new MediaConversionError(`Could not start FFmpeg: ${error.message}`),
      );
    });

    ffmpegProcess.on("close", (code: number | null) => {
      if (settled) {
        return;
      }

      if (code === 0) {
        settled = true;
        resolve();
        return;
      }

      rejectOnce(
        new MediaConversionError(
          `FFmpeg exited with code ${code}. ${errorOutput.trim()}`,
        ),
      );
    });
  });
}
