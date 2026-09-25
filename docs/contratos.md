# Contratos e garantias

## HTTP

`POST /jobs` recebe `multipart/form-data` com `file`, `targetFormat` e `notifyEmail`. Aceita áudio ou vídeo, limita o tamanho pelo ambiente (100 MB por padrão) e retorna `202` com `{ "jobId": "uuid", "status": "PENDENTE" }`.

`GET /jobs/:jobId` retorna o status, formatos, datas, `resultAvailable` e, quando concluído, uma URL assinada de download. UUID inválido retorna `400`; job inexistente retorna `404`.

## Eventos RabbitMQ

| Evento | Destino | Campos relevantes |
| --- | --- | --- |
| `conversion.requested` | `conversion.jobs` | `eventId`, `jobId`, `sourceUrl` assinada, tipo, formatos, e-mail, data e tentativa. |
| `conversion.finished` | `notification.jobs` | `eventId`, `jobId`, e-mail, status, URL do resultado ou erro e data. |

Os parsers exigem conjunto exato de chaves, UUIDs, datas ISO-8601, e-mail válido e URL HTTP(S). A URL de origem também exige os parâmetros de assinatura MinIO.

## Garantias práticas

- **Durabilidade do pedido:** job e evento inicial ficam juntos na transação do PostgreSQL; o dispatcher recupera eventos pendentes ou leases expirados.
- **Entrega ao menos uma vez:** mensagens podem ser reenviadas. Consumidores devem tolerar duplicidade.
- **Exclusão mútua por job:** token e lease condicionam reivindicação, renovação, conclusão e falha.
- **Resultado idempotente:** se `converted/<jobId>/result.<formato>` já existir, o worker não baixa nem converte novamente; a exclusão da origem também é idempotente.
- **Notificação uma vez por estado final, na prática:** a tabela `notifications` impede duas reivindicações simultâneas. Ainda assim, uma queda após o SMTP aceitar o e-mail e antes de `SENT` pode permitir reenvio; portanto não há garantia absoluta de uma única entrega externa.
