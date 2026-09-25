# Roteiro de demonstração

## Preparação

1. Inicie Docker Desktop e execute `docker compose up --build --scale conversion-worker=2`.
2. Aguarde os health checks e abra o conversor em `http://localhost:3000`, RabbitMQ em `http://localhost:15672`, o Mailpit em `http://localhost:8025` e o MinIO em `http://localhost:9001`.
3. Tenha um arquivo MP3, WAV, MP4 ou WebM para a demonstração.

## Fluxo principal

1. Envie o arquivo, escolha um formato compatível e informe um e-mail.
2. Mostre a resposta de aceite e o `jobId`; explique que a API retorna antes da conversão.
3. Abra a página de status e observe `PENDENTE`, `PROCESSANDO` e `CONCLUÍDO`.
4. No RabbitMQ, mostre os consumidores de `conversion.jobs`; com duas réplicas, há dois consumidores.
5. No MinIO, mostre a origem em `uploads` durante o processamento e o resultado em `converted` ao final. A origem é removida após o resultado estar gravado.
6. No Mailpit, mostre o e-mail com o link do resultado; em seguida, baixe o arquivo pela URL assinada.

## Tolerância a falhas

1. Enquanto um arquivo maior estiver em processamento, interrompa uma réplica de conversão.
2. Mostre que o job permanece recuperável: após o lease expirar, outra réplica pode reivindicá-lo. Para uma falha de processamento, as filas de retry aguardam 5 ou 30 segundos.
3. Explique que três falhas de conversão levam o job a `ERRO` e a mensagem para `conversion.dlq`; três falhas de notificação levam a notificação a `FAILED` e `notification.dlq`.

## Benchmark

Execute `npm run benchmark:workers` com a composição ativa. O script cria dois lotes idênticos de oito WAVs deterministas de 30 segundos, testa uma e duas réplicas, valida consumidores, IDs/resultados distintos e uma tentativa por job. Compare com os números registrados em `benchmark-explicacao.md`; não trate uma nova execução como igual, pois ela depende da máquina local.
