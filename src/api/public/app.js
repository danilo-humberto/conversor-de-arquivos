const form = document.querySelector("#conversion-form");
const fileInput = document.querySelector("#file");
const targetFormatInput = document.querySelector("#target-format");
const emailInput = document.querySelector("#notify-email");
const submitButton = document.querySelector("#submit-button");
const statusPanel = document.querySelector("#status-panel");
const statusLabel = document.querySelector("#status-label");
const statusMessage = document.querySelector("#status-message");
const jobIdElement = document.querySelector("#job-id");

const formatsByMediaType = {
  audio: ["mp3", "wav"],
  video: ["mp4", "webm"],
};

const terminalStatuses = new Set(["CONCLUÍDO", "ERRO"]);
let pollingTimer;

function getMediaType(file) {
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

function showStatus(label, message, isError = false) {
  statusPanel.hidden = false;
  statusPanel.dataset.error = String(isError);
  statusLabel.textContent = label;
  statusMessage.textContent = message;
}

function setSubmissionState(isSubmitting) {
  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting
    ? "Enviando..."
    : "Enviar para conversão";
}

function configureFormats() {
  const [file] = fileInput.files;
  const mediaType = file && getMediaType(file);

  targetFormatInput.replaceChildren();

  if (!mediaType) {
    targetFormatInput.disabled = true;
    targetFormatInput.add(new Option("Escolha primeiro um arquivo", ""));
    return;
  }

  targetFormatInput.disabled = false;
  targetFormatInput.add(new Option("Selecione o formato", ""));

  for (const format of formatsByMediaType[mediaType]) {
    targetFormatInput.add(new Option(format.toUpperCase(), format));
  }
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
      messages[status] || "Atualizando status...",
      status === "ERRO",
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

  if (file && !getMediaType(file)) {
    showStatus("Arquivo não suportado", "Selecione um arquivo de áudio ou vídeo.", true);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  stopPolling();
  jobIdElement.hidden = true;

  const [file] = fileInput.files;
  const mediaType = file && getMediaType(file);

  if (!file || !mediaType || !targetFormatInput.value || !emailInput.validity.valid) {
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

    jobIdElement.textContent = `Código da conversão: ${job.jobId}`;
    jobIdElement.hidden = false;
    showStatus("Conversão criada", "Acompanhando o processamento do seu arquivo.");
    await checkJobStatus(job.jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao enviar o arquivo.";
    showStatus("Não foi possível enviar", message, true);
    setSubmissionState(false);
  }
});

configureFormats();
