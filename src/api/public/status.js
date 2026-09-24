const statusPanel = document.querySelector("#status-panel");
const statusLabel = document.querySelector("#status-label");
const statusMessage = document.querySelector("#status-message");
const downloadLink = document.querySelector("#download-link");
const jobIdElement = document.querySelector("#job-id");

const jobId = new URLSearchParams(window.location.search).get("jobId");
const terminalStatuses = new Set(["CONCLUÍDO", "ERRO"]);
let pollingTimer;

function showStatus(label, message, isError = false, downloadUrl) {
  statusPanel.dataset.error = String(isError);
  statusLabel.textContent = label;
  statusMessage.textContent = message;
  downloadLink.hidden = typeof downloadUrl !== "string";
  downloadLink.href = typeof downloadUrl === "string" ? downloadUrl : "";
}

function stopPolling() {
  window.clearTimeout(pollingTimer);
  pollingTimer = undefined;
}

async function checkJobStatus() {
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
      CONCLUÍDO: "Conversão concluída. Você também receberá a confirmação por e-mail.",
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
      return;
    }

    pollingTimer = window.setTimeout(checkJobStatus, 3000);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao consultar o status.";
    showStatus("Não foi possível atualizar o status", message, true);
    pollingTimer = window.setTimeout(checkJobStatus, 5000);
  }
}

if (!jobId) {
  jobIdElement.hidden = true;
  showStatus("Código ausente", "Abra esta página pelo botão de acompanhamento.", true);
} else {
  jobIdElement.textContent = `Código da conversão: ${jobId}`;
  void checkJobStatus();
}
