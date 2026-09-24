type ConversionFailedEmailInput = {
  jobId: string;
  error: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createConversionFailedEmail(input: ConversionFailedEmailInput) {
  const safeError = escapeHtml(input.error);

  return {
    subject: "Sua conversão não pôde ser concluída",
    text: [
      `A conversão do job ${input.jobId} não pôde ser concluída.`,
      "",
      `Motivo: ${input.error}`,
    ].join("\n"),
    html: `
      <h1>Conversão não concluída</h1>
      <p>O job <strong>${input.jobId}</strong> não pôde ser concluído.</p>
      <p>Motivo: ${safeError}</p>
    `,
  };
}
