# Decisões e limitações

## Decisões implementadas

1. **Outbox transacional:** evita perder a solicitação entre gravar o job e publicar no broker. O custo é um processo adicional de polling.
2. **Lease no PostgreSQL:** coordena réplicas sem lock distribuído externo. O token impede que um worker antigo finalize um job cuja posse perdeu.
3. **Armazenamento de resultado determinístico por job:** facilita retomada após uma queda entre upload e conclusão do banco.
4. **Retries por filas TTL:** explicita esperas de 5 e 30 segundos sem depender de `sleep` no worker.
5. **Separação de conversão e notificação:** indisponibilidade de SMTP não bloqueia a conversão.

## Limitações conhecidas

- O contrato não expõe cancelamento, autenticação/autorização ou isolamento por usuário.
- A limpeza de objetos de resultado, DLQs e registros antigos não possui política automática neste repositório.
- O upload é anterior à transação; existe tratamento para remover a origem se a transação falhar, mas uma indisponibilidade do MinIO na limpeza exige intervenção operacional.
- A conversão depende de FFmpeg e dos codecs presentes na imagem do worker.
- O benchmark é local e ponta a ponta; não representa capacidade de produção nem mede afinidade por réplica.
- `minio:latest` está presente na composição, logo a reprodutibilidade desse serviço depende de fixar uma tag em trabalho futuro.
