import multer from "multer";

import { env } from "../config/env.js";

function acceptsMediaFile(mimetype: string): boolean {
  return mimetype.startsWith("video/") || mimetype.startsWith("audio/");
}

export const upload = multer({
  dest: "tmp/uploads",
  limits: {
    fileSize: env.maxUploadSizeBytes,
  },

  fileFilter: (_req, file, callback) => {
    if (acceptsMediaFile(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(
      new Error("Invalid file type. Only audio and video files are allowed."),
    );
  },
});
