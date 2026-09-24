# Roteiro de demonstracao

## Preparacao

1. Inicie Docker Desktop e execute `docker compose up --build --scale conversion-worker=2`.
2. Aguarde os health checks e abra o conversor em `http://localhost:3000`, RabbitMQ em `http://localhost:15672` e Mailpit em `http://localhost:8025`.
3. Tenha um arquivo MP3, WAV, MP4 ou WebM para a demonstracao.

## Fluxo principal

1. Envie o arquivo, escolha um formato compativel e informe um e-mail.
2. Mostre a resposta de aceite e o `jobId`; explique que a API retorna antes da conversao.
3. Abra a pagina de status e observe `PENDENTE`, `PROCESSANDO` e `CONCLUÍDO`.
4. No RabbitMQ, mostre os consumidores de `conversion.jobs`; com duas replicas, ha dois consumidores.
5. No MinIO, mostre a origem em `uploads` durante o processamento e o resultado em `converted` ao final. A origem e removida apos o resultado estar gravado.
6. No Mailpit, mostre o e-mail com o link do resultado; em seguida, baixe o arquivo pela URL assinada.

## Tolerancia a falhas

1. Enquanto um arquivo maior estiver em processamento, interrompa uma replica de conversao.
2. Mostre que o job permanece recuperavel: apos o lease expirar, outra replica pode reivindica-lo. Para uma falha de processamento, as filas de retry aguardam 5 ou 30 segundos.
3. Explique que tres falhas de conversao levam o job a `ERRO` e a mensagem para `conversion.dlq`; tres falhas de notificacao levam a notificacao a `FAILED` e `notification.dlq`.

## Benchmark

Execute `npm run benchmark:workers` com a composicao ativa. O script cria dois lotes identicos de oito WAVs deterministas de 30 segundos, testa uma e duas replicas, valida consumidores, IDs/resultados distintos e uma tentativa por job. Compare com os numeros registrados em `benchmark-explicacao.md`; nao trate uma nova execucao como igual, pois ela depende da maquina local.
