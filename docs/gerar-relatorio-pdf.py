from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Paragraph,
    PageBreak,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output" / "pdf" / "relatorio-entrega.pdf"


def paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text, style)


def header_footer(canvas, document):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#52606d"))
    canvas.drawString(2 * cm, 1.2 * cm, "Conversor de arquivos distribuidos")
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Pagina {document.page}")
    canvas.restoreState()


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "TitleReport", parent=styles["Title"], fontName="Helvetica-Bold",
        fontSize=22, leading=26, textColor=colors.HexColor("#12355b"), spaceAfter=10,
    )
    subtitle = ParagraphStyle(
        "Subtitle", parent=styles["Normal"], fontSize=10, leading=14,
        textColor=colors.HexColor("#52606d"), spaceAfter=18,
    )
    heading = ParagraphStyle(
        "Heading", parent=styles["Heading2"], fontName="Helvetica-Bold",
        fontSize=13, leading=16, textColor=colors.HexColor("#12355b"),
        spaceBefore=5, spaceAfter=3,
    )
    body = ParagraphStyle(
        "Body", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5,
        leading=11, spaceAfter=4,
    )
    small = ParagraphStyle(
        "Small", parent=body, fontSize=8, leading=10, spaceAfter=0,
    )

    story = [
        paragraph("Relatorio de entrega", title),
        paragraph("Conversor de arquivos distribuidos - arquitetura, confiabilidade e benchmark", subtitle),
        paragraph("Problema e solucao", heading),
        paragraph(
            "O sistema converte audio e video sem bloquear a requisicao HTTP. A API salva a origem no MinIO, grava o job e o evento inicial em uma transacao PostgreSQL; um dispatcher publica o evento no RabbitMQ. Workers independentes executam FFmpeg e um worker separado envia a notificacao por e-mail.",
            body,
        ),
        paragraph("Arquitetura", heading),
    ]

    architecture = [
        [paragraph("Componente", small), paragraph("Responsabilidade", small)],
        [paragraph("API Express", small), paragraph("Recebe upload, cria job e consulta status.", small)],
        [paragraph("PostgreSQL", small), paragraph("Fonte de verdade para jobs, outbox e notificacoes.", small)],
        [paragraph("MinIO", small), paragraph("Armazena origem em uploads e resultado em converted.", small)],
        [paragraph("RabbitMQ", small), paragraph("Entrega mensagens persistentes, retries e DLQs.", small)],
        [paragraph("Workers", small), paragraph("Convertem a midia e enviam a notificacao em processos separados.", small)],
    ]
    table = Table(architecture, colWidths=[4.1 * cm, 11.5 * cm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#12355b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#b8c4ce")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#f6f8fa")),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.extend([table, paragraph("Fluxo", heading)])
    story.append(paragraph(
        "Cliente -> API -> MinIO e PostgreSQL/outbox -> RabbitMQ -> worker de conversao -> MinIO e PostgreSQL/outbox -> RabbitMQ -> worker de notificacao -> SMTP. A consulta de status volta a API e entrega URL assinada apenas quando o job esta concluido.",
        body,
    ))
    story.extend([
        paragraph("Confiabilidade", heading),
        paragraph(
            "A outbox evita perder a solicitacao entre gravar o job e publicar a mensagem. O dispatcher reivindica eventos com lease, publica mensagens persistentes e espera confirmacao do broker. A entrega e ao menos uma vez: uma mensagem pode ser reenviada.",
            body,
        ),
        paragraph(
            "Cada job e reivindicado com token e lease de 120 segundos, renovado a cada 30 segundos. O token impede que um worker cuja posse expirou conclua o job. O resultado usa chave deterministica por job; numa reentrega, se ja existir, a conversao nao e repetida. Filas com TTL implementam esperas de 5 e 30 segundos; apos tres falhas, a mensagem segue para DLQ.",
            body,
        ),
        PageBreak(),
        paragraph("Benchmark real", heading),
        paragraph(
            "Foram enviados dois lotes identicos de oito WAVs deterministas de 30 segundos. O tempo vai do primeiro envio ate todos os jobs concluidos e inclui upload, fila, conversao e consulta de status.",
            body,
        ),
    ])
    benchmark = [
        [paragraph("Workers", small), paragraph("Tempo do lote", small), paragraph("Vazao", small), paragraph("Variacao", small)],
        [paragraph("1", small), paragraph("5,994 s", small), paragraph("1,335 jobs/s", small), paragraph("referencia", small)],
        [paragraph("2", small), paragraph("3,509 s", small), paragraph("2,280 jobs/s", small), paragraph("+71%", small)],
    ]
    bench_table = Table(benchmark, colWidths=[3 * cm, 4.2 * cm, 4.2 * cm, 4.2 * cm], repeatRows=1)
    bench_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f766e")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#b8c4ce")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#edf7f5")),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.extend([bench_table, Spacer(1, 8), paragraph(
        "Nos dois lotes, foram criados 16 jobs, com resultados distintos e uma tentativa por job. Havia um consumidor na primeira rodada e dois na segunda. O ganho nao chega a 100% porque banco, broker, armazenamento, upload e consulta tambem participam da medicao.",
        body,
    ), paragraph("Limites", heading), paragraph(
        "O ambiente e local e nao implementa autenticacao, cancelamento ou retencao automatica de objetos e DLQs. O benchmark nao representa capacidade de producao e nao identifica qual replica executou cada job. A configuracao de MinIO usa imagem latest, que deve ser fixada para maior reproducibilidade.",
        body,
    ), paragraph("Demonstracao", heading), paragraph(
        "Inicie docker compose up --build --scale conversion-worker=2; envie uma midia pela interface; acompanhe PENDENTE, PROCESSANDO e CONCLUÍDO; confira consumidores no RabbitMQ, objetos no MinIO e e-mail no Mailpit. O roteiro detalhado esta em docs/roteiro-demonstracao.md.",
        body,
    )])

    document = SimpleDocTemplate(
        str(OUTPUT), pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=1.2 * cm, bottomMargin=1.25 * cm,
        pageCompression=1,
        title="Relatorio de entrega - Conversor de arquivos distribuidos",
        author="Projeto Conversor de Arquivos",
    )
    document.build(story, onFirstPage=header_footer, onLaterPages=header_footer)


if __name__ == "__main__":
    main()
