# Decisoes e limitacoes

## Decisoes implementadas

1. **Outbox transacional:** evita perder a solicitacao entre gravar o job e publicar no broker. O custo e um processo adicional de polling.
2. **Lease no PostgreSQL:** coordena replicas sem lock distribuido externo. O token impede que um worker antigo finalize um job cuja posse perdeu.
3. **Armazenamento de resultado deterministico por job:** facilita retomada apos uma queda entre upload e conclusao do banco.
4. **Retries por filas TTL:** explicita esperas de 5 e 30 segundos sem depender de `sleep` no worker.
5. **Separacao de conversao e notificacao:** indisponibilidade de SMTP nao bloqueia a conversao.

## Limitacoes conhecidas

- O contrato nao expoe cancelamento, autenticacao/autorizacao ou isolamento por usuario.
- A limpeza de objetos de resultado, DLQs e registros antigos nao possui politica automatica neste repositorio.
- O upload e anterior a transacao; existe tratamento para remover a origem se a transacao falhar, mas uma indisponibilidade do MinIO na limpeza exige intervencao operacional.
- A conversao depende de FFmpeg e dos codecs presentes na imagem do worker.
- O benchmark e local e ponta a ponta; nao representa capacidade de producao nem mede afinidade por replica.
- `minio:latest` esta presente na composicao, logo a reproducibilidade desse servico depende de fixar uma tag em trabalho futuro.
