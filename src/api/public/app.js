const form = document.querySelector("#conversion-form");
const fileInput = document.querySelector("#file");
const targetFormatInput = document.querySelector("#target-format");
const emailInput = document.querySelector("#notify-email");
const submitButton = document.querySelector("#submit-button");
const formFeedback = document.querySelector("#form-feedback");
const confirmationModal = document.querySelector("#conversion-accepted-modal");
const trackConversionButton = document.querySelector("#track-conversion-button");

const targetFormatBySourceFormat = {
  mp3: "wav",
  wav: "mp3",
  mp4: "webm",
  webm: "mp4",
};

let acceptedJobId;

function getSourceFormat(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension && extension in targetFormatBySourceFormat) {
    return extension;
  }

  const formatByMimeType = {
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };

  return formatByMimeType[file.type] ?? null;
}

function showFeedback(message) {
  formFeedback.hidden = false;
  formFeedback.textContent = message;
}

function setSubmissionState(isSubmitting) {
  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting
    ? "Enviando..."
    : "Enviar para conversão";
}

function configureFormats() {
  const [file] = fileInput.files;
  const sourceFormat = file && getSourceFormat(file);

  targetFormatInput.replaceChildren();

  if (!sourceFormat) {
    targetFormatInput.disabled = true;
    targetFormatInput.add(new Option("Selecione um arquivo MP3, WAV, MP4 ou WebM", ""));
    return;
  }

  targetFormatInput.disabled = false;
  const targetFormat = targetFormatBySourceFormat[sourceFormat];
  targetFormatInput.add(new Option(targetFormat.toUpperCase(), targetFormat));
}

fileInput.addEventListener("change", () => {
  configureFormats();
  const [file] = fileInput.files;

  if (file && !getSourceFormat(file)) {
    showFeedback("Selecione um arquivo MP3, WAV, MP4 ou WebM.");
  }
});

confirmationModal.addEventListener("cancel", (event) => {
  event.preventDefault();
});

trackConversionButton.addEventListener("click", () => {
  if (!acceptedJobId) return;

  const trackingUrl = `/status.html?jobId=${encodeURIComponent(acceptedJobId)}`;
  window.open(trackingUrl, "_blank", "noopener");
  confirmationModal.close();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formFeedback.hidden = true;

  const [file] = fileInput.files;
  const sourceFormat = file && getSourceFormat(file);

  if (!file || !sourceFormat || !targetFormatInput.value || !emailInput.validity.valid) {
    form.reportValidity();
    showFeedback("Informe um arquivo válido, formato e e-mail.");
    return;
  }

  setSubmissionState(true);

  try {
    const formData = new FormData(form);
    const response = await fetch("/jobs", {
      method: "POST",
      body: formData,
    });
    const job = await response.json();

    if (!response.ok || typeof job.jobId !== "string") {
      throw new Error(job.message || job.error || "Não foi possível criar a conversão.");
    }

    acceptedJobId = job.jobId;
    form.reset();
    configureFormats();
    setSubmissionState(false);
    confirmationModal.showModal();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao enviar o arquivo.";
    showFeedback(message);
    setSubmissionState(false);
  }
});

configureFormats();
