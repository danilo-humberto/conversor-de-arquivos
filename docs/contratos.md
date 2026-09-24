# Contratos e garantias

## HTTP

`POST /jobs` recebe `multipart/form-data` com `file`, `targetFormat` e `notifyEmail`. Aceita audio ou video, limita o tamanho pelo ambiente (100 MB por padrao) e retorna `202` com `{ "jobId": "uuid", "status": "PENDENTE" }`.

`GET /jobs/:jobId` retorna o status, formatos, datas, `resultAvailable` e, quando concluido, uma URL assinada de download. UUID invalido retorna `400`; job inexistente retorna `404`.

## Eventos RabbitMQ

| Evento | Destino | Campos relevantes |
| --- | --- | --- |
| `conversion.requested` | `conversion.jobs` | `eventId`, `jobId`, `sourceUrl` assinada, tipo, formatos, e-mail, data e tentativa. |
| `conversion.finished` | `notification.jobs` | `eventId`, `jobId`, e-mail, status, URL do resultado ou erro e data. |

Os parsers exigem conjunto exato de chaves, UUIDs, datas ISO-8601, e-mail valido e URL HTTP(S). A URL de origem tambem exige os parametros de assinatura MinIO.

## Garantias praticas

- **Durabilidade do pedido:** job e evento inicial ficam juntos na transacao do PostgreSQL; o dispatcher recupera eventos pendentes ou leases expirados.
- **Entrega ao menos uma vez:** mensagens podem ser reenviadas. Consumidores devem tolerar duplicidade.
- **Exclusao mutua por job:** token e lease condicionam reivindicacao, renovacao, conclusao e falha.
- **Resultado idempotente:** se `converted/<jobId>/result.<formato>` ja existir, o worker nao baixa nem converte novamente; a exclusao da origem tambem e idempotente.
- **Notificacao uma vez por estado final, na pratica:** a tabela `notifications` impede duas reivindicacoes simultaneas. Ainda assim, uma queda apos o SMTP aceitar o e-mail e antes de `SENT` pode permitir reenvio; portanto nao ha garantia absoluta de uma unica entrega externa.
