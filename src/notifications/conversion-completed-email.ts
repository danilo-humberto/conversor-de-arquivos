type ConversionCompletedEmailInput = {
  jobId: string;
  downloadUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createConversionCompletedEmail(
  input: ConversionCompletedEmailInput,
) {
  const safeDownloadUrl = escapeHtml(input.downloadUrl);

  return {
    subject: "Sua conversão foi concluída",
    text: [
      `A conversão do job ${input.jobId} foi concluída.`,
      "",
      "Baixe o arquivo convertido no link abaixo:",
      input.downloadUrl,
      "",
      "O link expira em 24 horas.",
    ].join("\n"),
    html: `
      <h1>Conversão concluída</h1>
      <p>O job <strong>${input.jobId}</strong> foi concluído.</p>
      <p>
        <a href="${safeDownloadUrl}">
          Baixar arquivo convertido
        </a>
      </p>
      <p>O link expira em 24 horas.</p>
    `,
  };
}
