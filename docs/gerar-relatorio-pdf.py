from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    Image,
    Paragraph,
    PageBreak,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output" / "pdf" / "relatorio-entrega.pdf"
FLOW_IMAGE = ROOT / "docs" / "assets" / "fluxo-distribuido.png"


def paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text, style)


def flow_illustration() -> Image:
    source = ImageReader(str(FLOW_IMAGE))
    original_width, original_height = source.getSize()
    max_width = 16.0 * cm
    max_height = 6.6 * cm
    scale = min(max_width / original_width, max_height / original_height)
    return Image(str(FLOW_IMAGE), width=original_width * scale, height=original_height * scale)


def header_footer(canvas, document):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#52606d"))
    canvas.drawString(2 * cm, 1.2 * cm, "Conversor de arquivos distribuídos")
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Página {document.page}")
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
    caption = ParagraphStyle(
        "Caption", parent=body, fontSize=7.5, leading=9,
        textColor=colors.HexColor("#52606d"), alignment=1,
        spaceBefore=2, spaceAfter=4,
    )

    story = [
        paragraph("Relatório de entrega", title),
        paragraph("Conversor de arquivos distribuídos - arquitetura, confiabilidade e benchmark", subtitle),
        paragraph("Problema e solução", heading),
        paragraph(
            "Conversões de mídia podem demorar e falhar por indisponibilidades temporárias. Quando a própria requisição HTTP tenta executar todo o trabalho, a pessoa fica esperando, uma queda pode deixar o pedido sem resposta e reenvios podem causar processamento ou notificações duplicados.",
            body,
        ),
        paragraph(
            "A solução separa o recebimento do arquivo do processamento. A API salva a origem no MinIO, grava o job e o evento inicial em uma transação PostgreSQL; um dispatcher publica o evento no RabbitMQ. Workers independentes executam FFmpeg e um worker separado envia a notificação por e-mail.",
            body,
        ),
        paragraph("Arquitetura", heading),
    ]

    architecture = [
        [paragraph("Componente", small), paragraph("Responsabilidade", small)],
        [paragraph("API Express", small), paragraph("Recebe upload, cria job e consulta status.", small)],
        [paragraph("PostgreSQL", small), paragraph("Fonte de verdade para jobs, outbox e notificações.", small)],
        [paragraph("MinIO", small), paragraph("Armazena origem em uploads e resultado em converted.", small)],
        [paragraph("RabbitMQ", small), paragraph("Entrega mensagens persistentes, retries e DLQs.", small)],
        [paragraph("Workers", small), paragraph("Convertem a mídia e enviam a notificação em processos separados.", small)],
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
    story.extend([
        table,
        paragraph("Fluxo do processamento", heading),
        flow_illustration(),
        paragraph(
            "Figura 1 - O envio cria o job e publica uma mensagem; a conversão ocorre em segundo plano, salva o resultado e gera a notificação. A consulta libera o download somente ao final.",
            caption,
        ),
    ])
    story.extend([
        paragraph("Confiabilidade", heading),
        paragraph(
            "A outbox evita perder a solicitação entre gravar o job e publicar a mensagem. O dispatcher reivindica eventos com lease, publica mensagens persistentes e espera confirmação do broker. A entrega é ao menos uma vez: uma mensagem pode ser reenviada.",
            body,
        ),
        paragraph(
            "Cada job é reivindicado com token e lease de 120 segundos, renovado a cada 30 segundos. O token impede que um worker cuja posse expirou conclua o job. O resultado usa chave determinística por job; numa reentrega, se já existir, a conversão não é repetida. Filas com TTL implementam esperas de 5 e 30 segundos; após três falhas, a mensagem segue para DLQ.",
            body,
        ),
        PageBreak(),
        paragraph("Benchmark real", heading),
        paragraph(
            "Foram enviados dois lotes idênticos de oito WAVs deterministas de 30 segundos. O tempo vai do primeiro envio até todos os jobs concluídos e inclui upload, fila, conversão e consulta de status.",
            body,
        ),
    ])
    benchmark = [
        [paragraph("Workers", small), paragraph("Tempo do lote", small), paragraph("Vazão", small), paragraph("Variação", small)],
        [paragraph("1", small), paragraph("5,994 s", small), paragraph("1,335 jobs/s", small), paragraph("referência", small)],
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
        "Nos dois lotes, foram criados 16 jobs, com resultados distintos e uma tentativa por job. Havia um consumidor na primeira rodada e dois na segunda. O ganho não chega a 100% porque banco, broker, armazenamento, upload e consulta também participam da medição.",
        body,
    ), paragraph("Limites", heading), paragraph(
        "O ambiente é local e não implementa autenticação, cancelamento ou retenção automática de objetos e DLQs. O benchmark não representa capacidade de produção e não identifica qual réplica executou cada job. A configuração de MinIO usa imagem latest, que deve ser fixada para maior reprodutibilidade.",
        body,
    ), paragraph("Demonstração", heading), paragraph(
        "Inicie docker compose up --build --scale conversion-worker=2; envie uma mídia pela interface; acompanhe PENDENTE, PROCESSANDO e CONCLUÍDO; confira consumidores no RabbitMQ, objetos no MinIO e e-mail no Mailpit. O roteiro detalhado está em docs/roteiro-demonstracao.md.",
        body,
    )])

    document = SimpleDocTemplate(
        str(OUTPUT), pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=1.2 * cm, bottomMargin=1.25 * cm,
        pageCompression=1,
        title="Relatório de entrega - Conversor de arquivos distribuídos",
        author="Projeto Conversor de Arquivos",
    )
    document.build(story, onFirstPage=header_footer, onLaterPages=header_footer)


if __name__ == "__main__":
    main()
