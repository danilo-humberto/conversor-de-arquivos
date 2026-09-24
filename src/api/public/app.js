const form = document.querySelector("#conversion-form");
const fileInput = document.querySelector("#file");
const targetFormatInput = document.querySelector("#target-format");
const emailInput = document.querySelector("#notify-email");
const submitButton = document.querySelector("#submit-button");
const statusPanel = document.querySelector("#status-panel");
const statusLabel = document.querySelector("#status-label");
const statusMessage = document.querySelector("#status-message");
const downloadLink = document.querySelector("#download-link");
const jobIdElement = document.querySelector("#job-id");
const confirmationModal = document.querySelector("#conversion-accepted-modal");
const trackConversionButton = document.querySelector("#track-conversion-button");

const targetFormatBySourceFormat = {
  mp3: "wav",
  wav: "mp3",
  mp4: "webm",
  webm: "mp4",
};

const terminalStatuses = new Set(["CONCLUÍDO", "ERRO"]);
let pollingTimer;
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

function showStatus(label, message, isError = false, downloadUrl) {
  statusPanel.hidden = false;
  statusPanel.dataset.error = String(isError);
  statusLabel.textContent = label;
  statusMessage.textContent = message;
  downloadLink.hidden = typeof downloadUrl !== "string";
  downloadLink.href = typeof downloadUrl === "string" ? downloadUrl : "";
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

function stopPolling() {
  window.clearTimeout(pollingTimer);
  pollingTimer = undefined;
}

async function checkJobStatus(jobId) {
  try {
    const response = await fetch(`/jobs/${encodeURIComponent(jobId)}`);
    const job = await response.json();

    if (!response.ok) {
      throw new Error(job.error || job.message || "Não foi possível consultar o status.");
    }

    const status = String(job.status);
    const messages = {
      PENDENTE: "Seu arquivo está aguardando processamento.",
      PROCESSANDO: "Seu arquivo está sendo convertido.",
      CONCLUÍDO: "Conversão concluída. Você receberá a confirmação por e-mail.",
      ERRO: "Não foi possível concluir a conversão. Tente enviar o arquivo novamente.",
    };

    showStatus(
      `Status: ${status}`,
      status === "CONCLUÍDO" && job.downloadUrl
        ? "Conversão concluída. Baixe o arquivo convertido abaixo. Você também receberá a confirmação por e-mail."
        : messages[status] || "Atualizando status...",
      status === "ERRO",
      status === "CONCLUÍDO" ? job.downloadUrl : undefined,
    );

    if (terminalStatuses.has(status)) {
      stopPolling();
      setSubmissionState(false);
      return;
    }

    pollingTimer = window.setTimeout(() => checkJobStatus(jobId), 3000);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao consultar o status.";
    showStatus("Não foi possível atualizar o status", message, true);
    pollingTimer = window.setTimeout(() => checkJobStatus(jobId), 5000);
  }
}

fileInput.addEventListener("change", () => {
  configureFormats();
  const [file] = fileInput.files;

  if (file && !getSourceFormat(file)) {
    showStatus(
      "Arquivo não suportado",
      "Selecione um arquivo MP3, WAV, MP4 ou WebM.",
      true,
    );
  }
});

confirmationModal.addEventListener("cancel", (event) => {
  event.preventDefault();
});

trackConversionButton.addEventListener("click", () => {
  if (!acceptedJobId) return;

  confirmationModal.close();
  jobIdElement.textContent = `Código da conversão: ${acceptedJobId}`;
  jobIdElement.hidden = false;
  showStatus("Conversão criada", "Acompanhando o processamento do seu arquivo.");
  void checkJobStatus(acceptedJobId);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  stopPolling();
  jobIdElement.hidden = true;

  const [file] = fileInput.files;
  const sourceFormat = file && getSourceFormat(file);

  if (!file || !sourceFormat || !targetFormatInput.value || !emailInput.validity.valid) {
    form.reportValidity();
    showStatus("Revise o formulário", "Informe um arquivo válido, formato e e-mail.", true);
    return;
  }

  setSubmissionState(true);
  showStatus("Enviando arquivo", "Seu pedido de conversão está sendo criado.");

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
    statusPanel.hidden = true;
    confirmationModal.showModal();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao enviar o arquivo.";
    showStatus("Não foi possível enviar", message, true);
    setSubmissionState(false);
  }
});

configureFormats();
